import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findBucketAlias,
  loadConfig,
  resolveBucket,
} from "../src/config.js";
import { CliError } from "../src/errors.js";
import type { AppConfig } from "../src/types.js";

const envKeys = ["TEST_OBS_AK", "TEST_OBS_SK", "TEST_OBS_TOKEN"];

afterEach(() => {
  for (const key of envKeys) {
    delete process.env[key];
  }
});

function baseConfig(): Record<string, unknown> {
  return {
    profiles: {
      prod: {
        credentials: {
          source: "env",
          accessKeyIdEnv: "TEST_OBS_AK",
          secretAccessKeyEnv: "TEST_OBS_SK",
        },
      },
    },
    buckets: {
      assets: {
        name: "real-assets-bucket",
        profile: "prod",
        endpoint: "https://obs.cn-north-4.myhuaweicloud.com",
      },
    },
  };
}

describe("configuration", () => {
  it("resolves an alias and a unique real bucket name", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-obs-config-"));
    const configPath = path.join(directory, "config.json");
    await writeFile(configPath, JSON.stringify(baseConfig()));
    process.env.TEST_OBS_AK = "example-ak";
    process.env.TEST_OBS_SK = "example-sk";

    const byAlias = await resolveBucket("assets", configPath);
    const byName = await resolveBucket("real-assets-bucket", configPath);

    expect(byAlias.bucket.alias).toBe("assets");
    expect(byName.bucket.alias).toBe("assets");
    expect(byAlias.bucket.credentials.secretAccessKey).toBe("example-sk");
  });

  it("rejects an ambiguous real bucket name", () => {
    const config = {
      profiles: {},
      buckets: {
        first: {
          name: "same-bucket",
          profile: "one",
          endpoint: "https://example.com",
        },
        second: {
          name: "same-bucket",
          profile: "two",
          endpoint: "https://example.com",
        },
      },
      defaults: { concurrency: 4, partSizeBytes: 9437184 },
    } as AppConfig;
    expect(() => findBucketAlias(config, "same-bucket")).toThrowError(
      /多个配置/,
    );
  });

  it("migrates local plaintext credentials to encrypted refs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-obs-local-"));
    const configPath = path.join(directory, "config.json");
    const local = baseConfig();
    (
      local.profiles as Record<string, Record<string, unknown>>
    ).prod!.credentials = {
      source: "local",
      accessKeyId: "local-ak",
      secretAccessKey: "local-sk",
      securityToken: "local-token",
    };
    await writeFile(configPath, JSON.stringify(local));

    const resolved = await resolveBucket("assets", configPath);
    const rewritten = await readFile(configPath, "utf8");
    const secrets = await readFile(path.join(directory, "secrets.json"), "utf8");

    expect(resolved.bucket.credentials).toEqual({
      accessKeyId: "local-ak",
      secretAccessKey: "local-sk",
      securityToken: "local-token",
    });
    expect(rewritten).not.toContain("local-sk");
    expect(rewritten).toContain("secretAccessKeyRef");
    expect(secrets).not.toContain("local-sk");
  });

  it("requires configured credential environment variables", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-obs-env-"));
    const configPath = path.join(directory, "config.json");
    await writeFile(configPath, JSON.stringify(baseConfig()));

    await expect(resolveBucket("assets", configPath)).rejects.toMatchObject({
      code: "CREDENTIAL_ENV_MISSING",
    } satisfies Partial<CliError>);
  });

  it("rejects insecure endpoints", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-obs-http-"));
    const configPath = path.join(directory, "config.json");
    const config = baseConfig();
    (
      config.buckets as Record<string, Record<string, unknown>>
    ).assets!.endpoint = "http://obs.example.com";
    await writeFile(configPath, JSON.stringify(config));

    await expect(loadConfig(configPath)).rejects.toThrow(/https/);
  });
});
