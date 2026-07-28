import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { CliError } from "./errors.js";
import { decryptSecret, encryptSecret } from "./secrets.js";
import type {
  AppConfig,
  LocalCredentialsConfig,
  ResolvedBucket,
  ResolvedCredentials,
} from "./types.js";

export const CONFIG_ENV = "AGENT_OBS_CLI_CONFIG";
const DEFAULT_PART_SIZE = 9 * 1024 * 1024;
const SECRET_FIELDS = [
  ["accessKeyId", "accessKeyIdRef"],
  ["secretAccessKey", "secretAccessKeyRef"],
  ["securityToken", "securityTokenRef"],
] as const;

const envCredentialsSchema = z.object({
  source: z.literal("env"),
  accessKeyIdEnv: z.string().trim().min(1),
  secretAccessKeyEnv: z.string().trim().min(1),
  securityTokenEnv: z.string().trim().min(1).optional(),
});

const localCredentialsSchema = z
  .object({
    source: z.literal("local"),
    accessKeyId: z.string().trim().min(1).optional(),
    secretAccessKey: z.string().trim().min(1).optional(),
    securityToken: z.string().trim().min(1).optional(),
    accessKeyIdRef: z.string().trim().min(1).optional(),
    secretAccessKeyRef: z.string().trim().min(1).optional(),
    securityTokenRef: z.string().trim().min(1).optional(),
  })
  .superRefine((value, context) => {
    for (const [plain, ref] of SECRET_FIELDS.slice(0, 2)) {
      if (!value[plain] && !value[ref]) {
        context.addIssue({
          code: "custom",
          message: `${plain} 或 ${ref} 必须提供一个`,
        });
      }
    }
  });

const profileSchema = z.object({
  credentials: z.discriminatedUnion("source", [
    envCredentialsSchema,
    localCredentialsSchema,
  ]),
  maxRetries: z.number().int().min(1).max(5).default(3),
  timeoutSeconds: z.number().int().positive().default(60),
});

const bucketSchema = z.object({
  name: z.string().trim().min(3).max(63),
  profile: z.string().trim().min(1),
  endpoint: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:", {
      message: "endpoint 必须使用 https://",
    })
    .refine((value) => {
      const hostname = new URL(value).hostname;
      return hostname.length > 0 && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
    }, "endpoint 必须使用域名，不能使用 IP 地址"),
});

const appConfigSchema = z
  .object({
    profiles: z.record(z.string(), profileSchema),
    buckets: z.record(z.string(), bucketSchema),
    defaults: z
      .object({
        concurrency: z.number().int().min(1).max(32).default(4),
        partSizeBytes: z
          .number()
          .int()
          .min(100 * 1024)
          .default(DEFAULT_PART_SIZE),
      })
      .default({ concurrency: 4, partSizeBytes: DEFAULT_PART_SIZE }),
  })
  .superRefine((value, context) => {
    for (const [alias, bucket] of Object.entries(value.buckets)) {
      if (!value.profiles[bucket.profile]) {
        context.addIssue({
          code: "custom",
          path: ["buckets", alias, "profile"],
          message: `引用了不存在的 profile: ${bucket.profile}`,
        });
      }
    }
  });

export function resolveConfigPath(): string {
  const configured = process.env[CONFIG_ENV];
  return configured
    ? path.resolve(configured)
    : path.join(os.homedir(), ".agent-obs-cli", "config.json");
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
    .join("; ");
}

async function writeConfigAtomically(
  configPath: string,
  root: unknown,
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(root, null, 2)}\n`, "utf8");
  await rename(temporary, configPath);
}

async function migratePlainLocalSecrets(
  configPath: string,
  root: unknown,
): Promise<boolean> {
  if (!root || typeof root !== "object" || !("profiles" in root)) {
    return false;
  }
  const profiles = (root as { profiles?: unknown }).profiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    return false;
  }
  let migrated = false;
  for (const [profileName, rawProfile] of Object.entries(profiles)) {
    if (!rawProfile || typeof rawProfile !== "object") {
      continue;
    }
    const credentials = (
      rawProfile as { credentials?: Record<string, unknown> }
    ).credentials;
    if (!credentials || credentials.source !== "local") {
      continue;
    }
    for (const [plainField, refField] of SECRET_FIELDS) {
      const plaintext = credentials[plainField];
      if (typeof plaintext !== "string" || plaintext.trim() === "") {
        continue;
      }
      const existingRef = credentials[refField];
      const secretRef =
        typeof existingRef === "string" && existingRef.trim()
          ? existingRef
          : `agentobscli:${profileName}:${plainField}`;
      await encryptSecret(configPath, secretRef, plaintext);
      delete credentials[plainField];
      credentials[refField] = secretRef;
      migrated = true;
    }
  }
  return migrated;
}

export async function loadConfig(
  configPath = resolveConfigPath(),
): Promise<AppConfig> {
  let root: unknown;
  try {
    root = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new CliError(
        "CONFIG_NOT_FOUND",
        `配置文件不存在: ${configPath}`,
      );
    }
    throw new CliError(
      "INVALID_CONFIG",
      `配置文件不是合法 JSON: ${configPath}`,
      { cause: error },
    );
  }

  if (await migratePlainLocalSecrets(configPath, root)) {
    await writeConfigAtomically(configPath, root);
  }

  const parsed = appConfigSchema.safeParse(root);
  if (!parsed.success) {
    throw new CliError("INVALID_CONFIG", formatZodError(parsed.error));
  }
  return parsed.data as AppConfig;
}

export async function loadConfigForList(
  configPath = resolveConfigPath(),
): Promise<AppConfig | null> {
  try {
    return await loadConfig(configPath);
  } catch (error) {
    if (error instanceof CliError && error.code === "CONFIG_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new CliError(
      "CREDENTIAL_ENV_MISSING",
      `凭据环境变量未设置: ${name}`,
    );
  }
  return value;
}

async function resolveCredentials(
  configPath: string,
  credentials: AppConfig["profiles"][string]["credentials"],
): Promise<ResolvedCredentials> {
  if (credentials.source === "env") {
    const securityToken = credentials.securityTokenEnv
      ? requireEnvironment(credentials.securityTokenEnv)
      : undefined;
    return {
      accessKeyId: requireEnvironment(credentials.accessKeyIdEnv),
      secretAccessKey: requireEnvironment(credentials.secretAccessKeyEnv),
      ...(securityToken ? { securityToken } : {}),
    };
  }

  const local = credentials as LocalCredentialsConfig;
  if (!local.accessKeyIdRef || !local.secretAccessKeyRef) {
    throw new CliError(
      "INVALID_CONFIG",
      "本地凭据迁移后缺少 accessKeyIdRef 或 secretAccessKeyRef",
    );
  }
  const securityToken = local.securityTokenRef
    ? await decryptSecret(configPath, local.securityTokenRef)
    : undefined;
  return {
    accessKeyId: await decryptSecret(configPath, local.accessKeyIdRef),
    secretAccessKey: await decryptSecret(configPath, local.secretAccessKeyRef),
    ...(securityToken ? { securityToken } : {}),
  };
}

export function findBucketAlias(config: AppConfig, identifier: string): string {
  if (config.buckets[identifier]) {
    return identifier;
  }
  const matches = Object.entries(config.buckets)
    .filter(([, bucket]) => bucket.name === identifier)
    .map(([alias]) => alias);
  if (matches.length === 0) {
    throw new CliError(
      "BUCKET_NOT_CONFIGURED",
      `未找到桶配置: ${identifier}；可用桶: ${Object.keys(config.buckets).join(", ") || "(无)"}`,
    );
  }
  if (matches.length > 1) {
    throw new CliError(
      "AMBIGUOUS_BUCKET",
      `真实桶名 ${identifier} 对应多个配置，请使用别名: ${matches.join(", ")}`,
    );
  }
  return matches[0]!;
}

export async function resolveBucket(
  identifier: string,
  configPath = resolveConfigPath(),
): Promise<{ config: AppConfig; bucket: ResolvedBucket }> {
  const config = await loadConfig(configPath);
  const alias = findBucketAlias(config, identifier);
  const bucketConfig = config.buckets[alias]!;
  const profile = config.profiles[bucketConfig.profile]!;
  return {
    config,
    bucket: {
      alias,
      name: bucketConfig.name,
      endpoint: bucketConfig.endpoint,
      profileName: bucketConfig.profile,
      profile,
      credentials: await resolveCredentials(
        configPath,
        profile.credentials,
      ),
    },
  };
}

export function configDirectory(configPath = resolveConfigPath()): string {
  return path.dirname(path.resolve(configPath));
}
