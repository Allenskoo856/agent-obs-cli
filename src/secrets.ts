import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.js";

interface SecretItem {
  iv: string;
  tag: string;
  ciphertext: string;
}

interface SecretsFile {
  version: 1;
  items: Record<string, SecretItem>;
}

const KEY_FILE = "secret.key";
const SECRETS_FILE = "secrets.json";

function configDirectory(configPath: string): string {
  return path.dirname(path.resolve(configPath));
}

async function writePrivateFile(filePath: string, data: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, data, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") {
    await chmod(temporary, 0o600);
  }
  await rename(temporary, filePath);
}

async function loadOrCreateKey(configPath: string): Promise<Buffer> {
  const keyPath = path.join(configDirectory(configPath), KEY_FILE);
  try {
    const encoded = await readFile(keyPath, "utf8");
    const key = Buffer.from(encoded.trim(), "base64");
    if (key.length !== 32) {
      throw new CliError("INVALID_SECRET_KEY", "本地 secret.key 长度非法");
    }
    return key;
  } catch (error) {
    if (
      error instanceof CliError ||
      !(
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
    ) {
      throw error;
    }
  }

  const key = randomBytes(32);
  await writePrivateFile(keyPath, key.toString("base64"));
  return key;
}

async function loadExistingKey(configPath: string): Promise<Buffer> {
  const keyPath = path.join(configDirectory(configPath), KEY_FILE);
  try {
    const key = Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64");
    if (key.length !== 32) {
      throw new CliError("INVALID_SECRET_KEY", "本地 secret.key 长度非法");
    }
    return key;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      "SECRET_KEY_NOT_FOUND",
      `无法读取本地密钥: ${keyPath}`,
      { cause: error },
    );
  }
}

async function loadSecrets(configPath: string): Promise<SecretsFile> {
  const secretsPath = path.join(configDirectory(configPath), SECRETS_FILE);
  try {
    const parsed = JSON.parse(await readFile(secretsPath, "utf8")) as SecretsFile;
    if (parsed.version !== 1 || typeof parsed.items !== "object") {
      throw new CliError("INVALID_SECRETS_FILE", "secrets.json 格式或版本不支持");
    }
    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { version: 1, items: {} };
    }
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError("INVALID_SECRETS_FILE", "secrets.json 解析失败", {
      cause: error,
    });
  }
}

export async function encryptSecret(
  configPath: string,
  secretRef: string,
  plaintext: string,
): Promise<void> {
  const key = await loadOrCreateKey(configPath);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const secrets = await loadSecrets(configPath);
  secrets.items[secretRef] = {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  await writePrivateFile(
    path.join(configDirectory(configPath), SECRETS_FILE),
    `${JSON.stringify(secrets, null, 2)}\n`,
  );
}

export async function decryptSecret(
  configPath: string,
  secretRef: string,
): Promise<string> {
  const key = await loadExistingKey(configPath);
  const secrets = await loadSecrets(configPath);
  const item = secrets.items[secretRef];
  if (!item) {
    throw new CliError(
      "SECRET_NOT_FOUND",
      `未找到 secretRef 对应的本地凭据: ${secretRef}`,
    );
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(item.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(item.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(item.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new CliError(
      "SECRET_DECRYPT_FAILED",
      `解密本地凭据失败: ${secretRef}`,
      { cause: error },
    );
  }
}
