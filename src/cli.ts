#!/usr/bin/env node

import { Command, Option } from "commander";
import path from "node:path";
import {
  loadConfigForList,
  resolveBucket,
  resolveConfigPath,
} from "./config.js";
import { CliError, toCliError } from "./errors.js";
import { HuaweiObsApi } from "./obs-client.js";
import {
  downloadFile,
  listObjects,
  uploadBatch,
  uploadFile,
} from "./operations.js";
import { writeError, writeOutput } from "./output.js";
import { installSkill } from "./skill-install.js";
import type { OutputFormat, ResolvedBucket } from "./types.js";

const program = new Command();

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError("INVALID_ARGUMENT", `必须是正整数: ${value}`, {
      exitCode: 2,
    });
  }
  return parsed;
}

function currentOptions(): {
  format: OutputFormat;
  configPath: string;
} {
  const options = program.opts<{ format: OutputFormat; config?: string }>();
  return {
    format: options.format,
    configPath: options.config
      ? path.resolve(options.config)
      : resolveConfigPath(),
  };
}

async function withBucket<T>(
  identifier: string,
  action: (
    bucket: ResolvedBucket,
    api: HuaweiObsApi,
    config: Awaited<ReturnType<typeof resolveBucket>>["config"],
    configPath: string,
  ) => Promise<T>,
): Promise<T> {
  const { configPath } = currentOptions();
  const resolved = await resolveBucket(identifier, configPath);
  const api = new HuaweiObsApi(resolved.bucket);
  try {
    return await action(resolved.bucket, api, resolved.config, configPath);
  } finally {
    api.close();
  }
}

async function runAction(action: () => Promise<unknown>): Promise<void> {
  const result = await action();
  writeOutput(result, currentOptions().format);
}

program
  .name("agent-obs-cli")
  .description("面向 Agent 的华为云 OBS 安全操作 CLI")
  .version("0.1.0")
  .addOption(
    new Option("--format <format>", "输出格式")
      .choices(["json", "table"])
      .default("json"),
  )
  .option("--config <path>", "配置文件路径，覆盖 AGENT_OBS_CLI_CONFIG")
  .showHelpAfterError();

program
  .command("list")
  .description("列出本地配置的 OBS profiles 和 buckets")
  .action(async () => {
    await runAction(async () => {
      const { configPath } = currentOptions();
      const config = await loadConfigForList(configPath);
      return {
        configPath,
        profiles: config
          ? Object.entries(config.profiles).map(([name, profile]) => ({
              name,
              credentialSource: profile.credentials.source,
              maxRetries: profile.maxRetries,
              timeoutSeconds: profile.timeoutSeconds,
            }))
          : [],
        buckets: config
          ? Object.entries(config.buckets).map(([alias, bucket]) => ({
              alias,
              name: bucket.name,
              profile: bucket.profile,
              endpoint: bucket.endpoint,
            }))
          : [],
      };
    });
  });

program
  .command("test")
  .description("测试指定桶的配置、认证和连通性")
  .requiredOption("--bucket <name>", "桶别名或真实桶名")
  .action(async (options: { bucket: string }) => {
    await runAction(() =>
      withBucket(options.bucket, async (bucket, api) => ({
        ok: true,
        alias: bucket.alias,
        ...(await api.getBucketInfo(bucket.name)),
      })),
    );
  });

program
  .command("bucket-info")
  .description("查询桶元数据")
  .requiredOption("--bucket <name>", "桶别名或真实桶名")
  .action(async (options: { bucket: string }) => {
    await runAction(() =>
      withBucket(options.bucket, async (bucket, api) => ({
        alias: bucket.alias,
        profile: bucket.profileName,
        endpoint: bucket.endpoint,
        ...(await api.getBucketInfo(bucket.name)),
      })),
    );
  });

program
  .command("list-objects")
  .description("列举桶内对象")
  .requiredOption("--bucket <name>", "桶别名或真实桶名")
  .option("--prefix <prefix>", "对象名前缀")
  .option("--delimiter <delimiter>", "目录分隔符，例如 /")
  .option("--marker <marker>", "起始对象 marker")
  .option("--limit <count>", "最多返回多少个对象", positiveInteger, 1000)
  .option("--all", "自动翻页并返回全部匹配对象", false)
  .action(
    async (options: {
      bucket: string;
      prefix?: string;
      delimiter?: string;
      marker?: string;
      limit: number;
      all: boolean;
    }) => {
      await runAction(() =>
        withBucket(options.bucket, async (bucket, api) =>
          listObjects(api, {
            bucket: bucket.name,
            limit: options.limit,
            all: options.all,
            ...(options.prefix ? { prefix: options.prefix } : {}),
            ...(options.delimiter ? { delimiter: options.delimiter } : {}),
            ...(options.marker ? { marker: options.marker } : {}),
          }),
        ),
      );
    },
  );

program
  .command("object-info")
  .description("查询对象元数据")
  .requiredOption("--bucket <name>", "桶别名或真实桶名")
  .requiredOption("--key <key>", "对象 key")
  .action(async (options: { bucket: string; key: string }) => {
    await runAction(() =>
      withBucket(options.bucket, async (bucket, api) => {
        const metadata = await api.headObject(bucket.name, options.key);
        if (!metadata) {
          throw new CliError(
            "OBJECT_NOT_FOUND",
            `对象不存在: ${options.key}`,
          );
        }
        return { bucket: bucket.name, ...metadata };
      }),
    );
  });

program
  .command("upload")
  .description("上传单个本地文件")
  .requiredOption("--bucket <name>", "桶别名或真实桶名")
  .requiredOption("--file <path>", "本地文件")
  .requiredOption("--key <key>", "目标对象 key")
  .option("--overwrite", "允许覆盖已存在的对象", false)
  .action(
    async (options: {
      bucket: string;
      file: string;
      key: string;
      overwrite: boolean;
    }) => {
      await runAction(() =>
        withBucket(
          options.bucket,
          async (bucket, api, config, configPath) =>
            uploadFile(api, bucket, configPath, {
              file: options.file,
              key: options.key,
              overwrite: options.overwrite,
              concurrency: config.defaults.concurrency,
              partSizeBytes: config.defaults.partSizeBytes,
            }),
        ),
      );
    },
  );

program
  .command("download")
  .description("断点续传下载对象到本地")
  .requiredOption("--bucket <name>", "桶别名或真实桶名")
  .requiredOption("--key <key>", "对象 key")
  .requiredOption("--output <path>", "本地输出文件")
  .option("--overwrite", "允许覆盖已存在的本地文件", false)
  .action(
    async (options: {
      bucket: string;
      key: string;
      output: string;
      overwrite: boolean;
    }) => {
      await runAction(() =>
        withBucket(
          options.bucket,
          async (bucket, api, config, configPath) =>
            downloadFile(api, bucket, configPath, {
              key: options.key,
              output: options.output,
              overwrite: options.overwrite,
              concurrency: config.defaults.concurrency,
              partSizeBytes: config.defaults.partSizeBytes,
            }),
        ),
      );
    },
  );

program
  .command("upload-batch")
  .description("递归批量上传目录中的普通文件")
  .requiredOption("--bucket <name>", "桶别名或真实桶名")
  .requiredOption("--source <directory>", "本地源目录")
  .option("--prefix <prefix>", "目标对象 key 前缀", "")
  .option(
    "--concurrency <count>",
    "并发上传数量，默认使用配置值",
    positiveInteger,
  )
  .option("--overwrite", "允许覆盖已存在的对象", false)
  .option("--dry-run", "只检查并输出上传计划", false)
  .action(
    async (options: {
      bucket: string;
      source: string;
      prefix: string;
      concurrency?: number;
      overwrite: boolean;
      dryRun: boolean;
    }) => {
      const result = await withBucket(
        options.bucket,
        async (bucket, api, config, configPath) =>
          uploadBatch(api, bucket, configPath, {
            source: options.source,
            prefix: options.prefix,
            overwrite: options.overwrite,
            dryRun: options.dryRun,
            concurrency: options.concurrency ?? config.defaults.concurrency,
            partSizeBytes: config.defaults.partSizeBytes,
          }),
      );
      writeOutput(result, currentOptions().format);
      if (result.failed > 0) {
        process.exitCode = 1;
      }
    },
  );

program
  .command("install-skill")
  .description("安装或更新内置 Agent skill")
  .option("--dry-run", "只输出安装计划，不写文件", false)
  .option("--yes", "跳过交互确认", false)
  .action(async (options: { dryRun: boolean; yes: boolean }) => {
    await runAction(() => installSkill(options));
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const cliError = toCliError(error);
  let format: OutputFormat = "json";
  try {
    format = currentOptions().format;
  } catch {
    // Commander may fail before global options are available.
  }
  writeError(cliError, format);
  process.exitCode = cliError.exitCode;
}
