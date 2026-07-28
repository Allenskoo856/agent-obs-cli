import { createRequire } from "node:module";
import { CliError, maskSensitiveText } from "./errors.js";
import type {
  ListObjectsPage,
  ObjectMetadata,
  ObsApi,
  ResolvedBucket,
} from "./types.js";

const require = createRequire(import.meta.url);
const ObsClient = require("esdk-obs-nodejs") as new (
  options: Record<string, unknown>,
) => {
  close(): void;
  [method: string]: unknown;
};

interface ObsResult {
  CommonMsg?: {
    Status?: number;
    Code?: string;
    Message?: string;
    RequestId?: string;
  };
  InterfaceResult?: Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

export class HuaweiObsApi implements ObsApi {
  private readonly client: InstanceType<typeof ObsClient>;
  private readonly secrets: string[];

  constructor(bucket: ResolvedBucket) {
    this.secrets = [
      bucket.credentials.accessKeyId,
      bucket.credentials.secretAccessKey,
      bucket.credentials.securityToken ?? "",
    ];
    this.client = new ObsClient({
      access_key_id: bucket.credentials.accessKeyId,
      secret_access_key: bucket.credentials.secretAccessKey,
      ...(bucket.credentials.securityToken
        ? { security_token: bucket.credentials.securityToken }
        : {}),
      server: bucket.endpoint,
      max_retry_count: bucket.profile.maxRetries,
      timeout: bucket.profile.timeoutSeconds,
    });
  }

  close(): void {
    this.client.close();
  }

  private validateResult(
    result: ObsResult,
    options: { allowNotFound?: boolean } = {},
  ): ObsResult | null {
    const status = result.CommonMsg?.Status ?? 0;
    if (status >= 200 && status < 300) {
      return result;
    }
    if (status === 404 && options.allowNotFound) {
      return null;
    }
    const code = result.CommonMsg?.Code || "OBS_REQUEST_FAILED";
    const message =
      result.CommonMsg?.Message || `OBS 请求失败，HTTP 状态码 ${status || "未知"}`;
    const requestId = result.CommonMsg?.RequestId;
    throw new CliError(
      String(code),
      maskSensitiveText(message, this.secrets),
      requestId ? { requestId } : {},
    );
  }

  private async call(
    method: string,
    params: Record<string, unknown>,
    options: { allowNotFound?: boolean } = {},
  ): Promise<ObsResult | null> {
    const callable = this.client[method];
    if (typeof callable !== "function") {
      throw new CliError(
        "SDK_METHOD_UNAVAILABLE",
        `当前 OBS SDK 不支持方法: ${method}`,
      );
    }
    let result: ObsResult;
    try {
      result = (await callable.call(this.client, params)) as ObsResult;
    } catch (error) {
      throw new CliError(
        "OBS_NETWORK_ERROR",
        maskSensitiveText(error, this.secrets),
        { cause: error },
      );
    }
    return this.validateResult(result, options);
  }

  private async callTransfer(
    method: "uploadFile" | "downloadFile",
    params: Record<string, unknown>,
  ): Promise<ObsResult> {
    const callable = this.client[method];
    if (typeof callable !== "function") {
      throw new CliError(
        "SDK_METHOD_UNAVAILABLE",
        `当前 OBS SDK 不支持方法: ${method}`,
      );
    }
    const result = await new Promise<ObsResult>((resolve, reject) => {
      const callback = (error: unknown, value?: ObsResult): void => {
        if (error) {
          if (value?.CommonMsg) {
            try {
              resolve(this.validateResult(value) as ObsResult);
            } catch (validationError) {
              reject(validationError);
            }
            return;
          }
          reject(
            new CliError(
              "OBS_TRANSFER_FAILED",
              maskSensitiveText(error, this.secrets),
              { cause: error },
            ),
          );
          return;
        }
        if (!value) {
          reject(
            new CliError(
              "OBS_TRANSFER_FAILED",
              `OBS SDK ${method} 未返回结果`,
            ),
          );
          return;
        }
        try {
          resolve(this.validateResult(value) as ObsResult);
        } catch (validationError) {
          reject(validationError);
        }
      };
      try {
        callable.call(this.client, params, callback);
      } catch (error) {
        reject(
          new CliError(
            "OBS_TRANSFER_FAILED",
            maskSensitiveText(error, this.secrets),
            { cause: error },
          ),
        );
      }
    });
    return result;
  }

  async getBucketInfo(bucket: string): Promise<Record<string, unknown>> {
    const result = await this.call("getBucketMetadata", { Bucket: bucket });
    const data = result?.InterfaceResult ?? {};
    return compactObject({
      bucket,
      storageClass: data.StorageClass,
      location: data.Location,
      availableZone: data.AvailableZone,
      obsVersion: data.ObsVersion,
      fsStatus: data.FSStatus,
      requestId:
        data.RequestId ??
        result?.CommonMsg?.RequestId,
    });
  }

  async headObject(
    bucket: string,
    key: string,
  ): Promise<ObjectMetadata | null> {
    const result = await this.call(
      "getObjectMetadata",
      { Bucket: bucket, Key: key },
      { allowNotFound: true },
    );
    if (!result) {
      return null;
    }
    const data = result.InterfaceResult ?? {};
    const rawMetadata = data.Metadata;
    const metadata: Record<string, string> = {};
    if (rawMetadata && typeof rawMetadata === "object") {
      for (const [name, value] of Object.entries(rawMetadata)) {
        if (typeof value === "string") {
          metadata[name] = value;
        }
      }
    }
    const contentLength = asNumber(data.ContentLength);
    const contentType = asString(data.ContentType);
    const etag = asString(data.ETag);
    const lastModified = asString(data.LastModified);
    const storageClass = asString(data.StorageClass);
    return {
      key,
      ...(contentLength !== undefined ? { contentLength } : {}),
      ...(contentType ? { contentType } : {}),
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
      ...(storageClass ? { storageClass } : {}),
      metadata,
    };
  }

  async listObjectsPage(input: {
    bucket: string;
    prefix?: string;
    delimiter?: string;
    marker?: string;
    maxKeys: number;
  }): Promise<ListObjectsPage> {
    const result = await this.call("listObjects", {
      Bucket: input.bucket,
      MaxKeys: input.maxKeys,
      ...(input.prefix ? { Prefix: input.prefix } : {}),
      ...(input.delimiter ? { Delimiter: input.delimiter } : {}),
      ...(input.marker ? { Marker: input.marker } : {}),
    });
    const data = result?.InterfaceResult ?? {};
    const contents = Array.isArray(data.Contents) ? data.Contents : [];
    const prefixes = Array.isArray(data.CommonPrefixes)
      ? data.CommonPrefixes
      : [];
    const objects = contents.flatMap((raw) => {
      if (!raw || typeof raw !== "object") {
        return [];
      }
      const item = raw as Record<string, unknown>;
      const key = asString(item.Key);
      if (!key) {
        return [];
      }
      const etag = asString(item.ETag);
      const lastModified = asString(item.LastModified);
      const storageClass = asString(item.StorageClass);
      return [
        {
          key,
          size: asNumber(item.Size) ?? 0,
          ...(etag ? { etag } : {}),
          ...(lastModified ? { lastModified } : {}),
          ...(storageClass ? { storageClass } : {}),
        },
      ];
    });
    const commonPrefixes = prefixes.flatMap((raw) => {
      if (typeof raw === "string") {
        return [raw];
      }
      if (raw && typeof raw === "object") {
        const prefix = asString((raw as Record<string, unknown>).Prefix);
        return prefix ? [prefix] : [];
      }
      return [];
    });
    const nextMarker =
      asString(data.NextMarker) ??
      (objects.length > 0 ? objects.at(-1)?.key : undefined);
    return {
      bucket: input.bucket,
      ...(input.prefix ? { prefix: input.prefix } : {}),
      ...(input.delimiter ? { delimiter: input.delimiter } : {}),
      objects,
      commonPrefixes,
      count: objects.length,
      isTruncated: data.IsTruncated === true,
      ...(nextMarker ? { nextMarker } : {}),
    };
  }

  async uploadSimple(input: {
    bucket: string;
    key: string;
    file: string;
  }): Promise<{ etag?: string; requestId?: string; size?: number }> {
    const result = await this.call("putObject", {
      Bucket: input.bucket,
      Key: input.key,
      SourceFile: input.file,
    });
    const data = result?.InterfaceResult ?? {};
    const etag = asString(data.ETag);
    const requestId = asString(data.RequestId ?? result?.CommonMsg?.RequestId);
    return {
      ...(etag ? { etag } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }

  async uploadResumable(input: {
    bucket: string;
    key: string;
    file: string;
    checkpointFile: string;
    partSizeBytes: number;
    concurrency: number;
  }): Promise<{ etag?: string; requestId?: string; size?: number }> {
    const result = await this.callTransfer("uploadFile", {
      Bucket: input.bucket,
      Key: input.key,
      UploadFile: input.file,
      PartSize: input.partSizeBytes,
      TaskNum: input.concurrency,
      EnableCheckpoint: true,
      CheckpointFile: input.checkpointFile,
    });
    const data = result?.InterfaceResult ?? {};
    const etag = asString(data.ETag);
    const requestId = asString(data.RequestId ?? result?.CommonMsg?.RequestId);
    return {
      ...(etag ? { etag } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }

  async downloadResumable(input: {
    bucket: string;
    key: string;
    output: string;
    checkpointFile: string;
    partSizeBytes: number;
    concurrency: number;
  }): Promise<{ etag?: string; requestId?: string; size?: number }> {
    const result = await this.callTransfer("downloadFile", {
      Bucket: input.bucket,
      Key: input.key,
      DownloadFile: input.output,
      PartSize: input.partSizeBytes,
      TaskNum: input.concurrency,
      EnableCheckpoint: true,
      CheckpointFile: input.checkpointFile,
    });
    const data = result?.InterfaceResult ?? {};
    const etag = asString(data.ETag);
    const requestId = asString(data.RequestId ?? result?.CommonMsg?.RequestId);
    return {
      ...(etag ? { etag } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }
}
