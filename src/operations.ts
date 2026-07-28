import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { configDirectory } from "./config.js";
import { CliError, maskSensitiveText } from "./errors.js";
import type {
  BatchItemResult,
  BatchUploadResult,
  ListObjectsPage,
  ObsApi,
  ResolvedBucket,
  TransferResult,
} from "./types.js";

const RESUMABLE_UPLOAD_MINIMUM = 100 * 1024;

function validateKey(key: string): void {
  if (!key || key.includes("\0")) {
    throw new CliError("INVALID_OBJECT_KEY", "对象 key 不能为空或包含 NUL 字符");
  }
}

export function normalizePrefix(prefix = ""): string {
  const normalized = prefix
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .join("/");
  return normalized ? `${normalized}/` : "";
}

export function objectKeyForFile(
  root: string,
  file: string,
  prefix = "",
): string {
  const relative = path.relative(root, file);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new CliError(
      "FILE_OUTSIDE_SOURCE",
      `文件不在批量上传根目录内: ${file}`,
    );
  }
  return `${normalizePrefix(prefix)}${relative.split(path.sep).join("/")}`;
}

export async function walkRegularFiles(root: string): Promise<string[]> {
  const rootStat = await stat(root).catch((error: unknown) => {
    throw new CliError("SOURCE_NOT_FOUND", `批量上传目录不存在: ${root}`, {
      cause: error,
    });
  });
  if (!rootStat.isDirectory()) {
    throw new CliError("SOURCE_NOT_DIRECTORY", `批量上传源不是目录: ${root}`);
  }

  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  await walk(root);
  return files;
}

function checkpointPath(
  configPath: string,
  direction: "upload" | "download",
  bucket: string,
  key: string,
  localPath: string,
): string {
  const digest = createHash("sha256")
    .update(`${direction}\0${bucket}\0${key}\0${path.resolve(localPath)}`)
    .digest("hex");
  return path.join(
    configDirectory(configPath),
    "checkpoints",
    `${direction}-${digest}.json`,
  );
}

export async function listObjects(
  api: ObsApi,
  input: {
    bucket: string;
    prefix?: string;
    delimiter?: string;
    marker?: string;
    limit: number;
    all: boolean;
  },
): Promise<ListObjectsPage> {
  const objects: ListObjectsPage["objects"] = [];
  const commonPrefixes = new Set<string>();
  let marker = input.marker;
  let lastPage: ListObjectsPage | undefined;
  const target = input.all ? Number.POSITIVE_INFINITY : input.limit;

  let shouldContinue = true;
  while (shouldContinue) {
    const remaining = Number.isFinite(target)
      ? Math.max(1, Math.min(1000, target - objects.length))
      : 1000;
    const page = await api.listObjectsPage({
      bucket: input.bucket,
      maxKeys: remaining,
      ...(input.prefix ? { prefix: input.prefix } : {}),
      ...(input.delimiter ? { delimiter: input.delimiter } : {}),
      ...(marker ? { marker } : {}),
    });
    lastPage = page;
    objects.push(...page.objects);
    page.commonPrefixes.forEach((prefix) => commonPrefixes.add(prefix));
    if (!page.isTruncated || objects.length >= target) {
      break;
    }
    if (!page.nextMarker || page.nextMarker === marker) {
      throw new CliError(
        "INVALID_PAGINATION",
        "OBS 返回了截断结果但没有可用的下一页 marker",
      );
    }
    marker = page.nextMarker;
    shouldContinue = page.isTruncated;
  }

  return {
    bucket: input.bucket,
    ...(input.prefix ? { prefix: input.prefix } : {}),
    ...(input.delimiter ? { delimiter: input.delimiter } : {}),
    objects,
    commonPrefixes: [...commonPrefixes],
    count: objects.length,
    isTruncated: lastPage?.isTruncated === true,
    ...(lastPage?.nextMarker ? { nextMarker: lastPage.nextMarker } : {}),
  };
}

async function ensureRegularFile(file: string): Promise<number> {
  const details = await stat(file).catch((error: unknown) => {
    throw new CliError("FILE_NOT_FOUND", `本地文件不存在: ${file}`, {
      cause: error,
    });
  });
  if (!details.isFile()) {
    throw new CliError("NOT_A_FILE", `路径不是普通文件: ${file}`);
  }
  return details.size;
}

export async function uploadFile(
  api: ObsApi,
  bucket: ResolvedBucket,
  configPath: string,
  input: {
    file: string;
    key: string;
    overwrite: boolean;
    concurrency: number;
    partSizeBytes: number;
    skipExistenceCheck?: boolean;
  },
): Promise<TransferResult> {
  validateKey(input.key);
  const absoluteFile = path.resolve(input.file);
  const size = await ensureRegularFile(absoluteFile);
  if (!input.overwrite && !input.skipExistenceCheck) {
    const existing = await api.headObject(bucket.name, input.key);
    if (existing) {
      throw new CliError(
        "OBJECT_EXISTS",
        `对象已存在，若要覆盖请添加 --overwrite: ${input.key}`,
      );
    }
  }

  if (size < RESUMABLE_UPLOAD_MINIMUM) {
    const result = await api.uploadSimple({
      bucket: bucket.name,
      key: input.key,
      file: absoluteFile,
    });
    return {
      bucket: bucket.name,
      key: input.key,
      path: absoluteFile,
      size,
      mode: "simple",
      ...result,
    };
  }

  const checkpointFile = checkpointPath(
    configPath,
    "upload",
    bucket.name,
    input.key,
    absoluteFile,
  );
  await mkdir(path.dirname(checkpointFile), { recursive: true });
  const result = await api.uploadResumable({
    bucket: bucket.name,
    key: input.key,
    file: absoluteFile,
    checkpointFile,
    partSizeBytes: input.partSizeBytes,
    concurrency: input.concurrency,
  });
  return {
    bucket: bucket.name,
    key: input.key,
    path: absoluteFile,
    size,
    mode: "resumable",
    ...result,
  };
}

export async function downloadFile(
  api: ObsApi,
  bucket: ResolvedBucket,
  configPath: string,
  input: {
    key: string;
    output: string;
    overwrite: boolean;
    concurrency: number;
    partSizeBytes: number;
  },
): Promise<TransferResult> {
  validateKey(input.key);
  const output = path.resolve(input.output);
  const existing = await stat(output).catch(() => null);
  if (existing && !input.overwrite) {
    throw new CliError(
      "LOCAL_FILE_EXISTS",
      `本地目标已存在，若要覆盖请添加 --overwrite: ${output}`,
    );
  }
  if (existing?.isDirectory()) {
    throw new CliError("OUTPUT_IS_DIRECTORY", `下载目标是目录: ${output}`);
  }

  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.agent-obs-cli.part`;
  const checkpointFile = checkpointPath(
    configPath,
    "download",
    bucket.name,
    input.key,
    output,
  );
  await mkdir(path.dirname(checkpointFile), { recursive: true });
  const result = await api.downloadResumable({
    bucket: bucket.name,
    key: input.key,
    output: temporary,
    checkpointFile,
    partSizeBytes: input.partSizeBytes,
    concurrency: input.concurrency,
  });
  if (input.overwrite) {
    await rm(output, { force: true });
  }
  await rename(temporary, output);
  const size = (await stat(output)).size;
  return {
    bucket: bucket.name,
    key: input.key,
    path: output,
    size,
    mode: "resumable",
    ...result,
  };
}

export async function uploadBatch(
  api: ObsApi,
  bucket: ResolvedBucket,
  configPath: string,
  input: {
    source: string;
    prefix: string;
    overwrite: boolean;
    dryRun: boolean;
    concurrency: number;
    partSizeBytes: number;
  },
): Promise<BatchUploadResult> {
  const source = path.resolve(input.source);
  const files = await walkRegularFiles(source);
  const limiter = pLimit(input.concurrency);

  const items = await Promise.all(
    files.map((file) =>
      limiter(async (): Promise<BatchItemResult> => {
        const key = objectKeyForFile(source, file, input.prefix);
        try {
          const existing = input.overwrite
            ? null
            : await api.headObject(bucket.name, key);
          if (existing) {
            return {
              file,
              key,
              status: "skipped",
              reason: "对象已存在；未指定 --overwrite",
            };
          }
          if (input.dryRun) {
            return { file, key, status: "planned" };
          }
          await uploadFile(api, bucket, configPath, {
            file,
            key,
            overwrite: input.overwrite,
            concurrency: input.concurrency,
            partSizeBytes: input.partSizeBytes,
            skipExistenceCheck: true,
          });
          return { file, key, status: "uploaded" };
        } catch (error) {
          return {
            file,
            key,
            status: "failed",
            reason: maskSensitiveText(error),
          };
        }
      }),
    ),
  );

  const count = (status: BatchItemResult["status"]): number =>
    items.filter((item) => item.status === status).length;
  return {
    bucket: bucket.name,
    source,
    prefix: normalizePrefix(input.prefix),
    dryRun: input.dryRun,
    total: items.length,
    uploaded: count("uploaded"),
    planned: count("planned"),
    skipped: count("skipped"),
    failed: count("failed"),
    items,
  };
}
