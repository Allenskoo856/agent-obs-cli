export type OutputFormat = "json" | "table";

export interface EnvCredentialsConfig {
  source: "env";
  accessKeyIdEnv: string;
  secretAccessKeyEnv: string;
  securityTokenEnv?: string;
}

export interface LocalCredentialsConfig {
  source: "local";
  accessKeyId?: string;
  secretAccessKey?: string;
  securityToken?: string;
  accessKeyIdRef?: string;
  secretAccessKeyRef?: string;
  securityTokenRef?: string;
}

export type CredentialsConfig = EnvCredentialsConfig | LocalCredentialsConfig;

export interface ProfileConfig {
  credentials: CredentialsConfig;
  maxRetries: number;
  timeoutSeconds: number;
}

export interface BucketConfig {
  name: string;
  profile: string;
  endpoint: string;
}

export interface AppConfig {
  profiles: Record<string, ProfileConfig>;
  buckets: Record<string, BucketConfig>;
  defaults: {
    concurrency: number;
    partSizeBytes: number;
  };
}

export interface ResolvedCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  securityToken?: string;
}

export interface ResolvedBucket {
  alias: string;
  name: string;
  endpoint: string;
  profileName: string;
  profile: ProfileConfig;
  credentials: ResolvedCredentials;
}

export interface ObsObject {
  key: string;
  size: number;
  etag?: string;
  lastModified?: string;
  storageClass?: string;
}

export interface ListObjectsPage {
  bucket: string;
  prefix?: string;
  delimiter?: string;
  objects: ObsObject[];
  commonPrefixes: string[];
  count: number;
  isTruncated: boolean;
  nextMarker?: string;
}

export interface ObjectMetadata {
  key: string;
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  storageClass?: string;
  metadata: Record<string, string>;
}

export interface TransferResult {
  bucket: string;
  key: string;
  path: string;
  size?: number;
  etag?: string;
  requestId?: string;
  mode: "simple" | "resumable";
}

export type BatchItemStatus = "planned" | "uploaded" | "skipped" | "failed";

export interface BatchItemResult {
  file: string;
  key: string;
  status: BatchItemStatus;
  reason?: string;
}

export interface BatchUploadResult {
  bucket: string;
  source: string;
  prefix: string;
  dryRun: boolean;
  total: number;
  uploaded: number;
  planned: number;
  skipped: number;
  failed: number;
  items: BatchItemResult[];
}

export interface ObsApi {
  close(): void;
  getBucketInfo(bucket: string): Promise<Record<string, unknown>>;
  headObject(bucket: string, key: string): Promise<ObjectMetadata | null>;
  listObjectsPage(input: {
    bucket: string;
    prefix?: string;
    delimiter?: string;
    marker?: string;
    maxKeys: number;
  }): Promise<ListObjectsPage>;
  uploadSimple(input: {
    bucket: string;
    key: string;
    file: string;
  }): Promise<Omit<TransferResult, "bucket" | "key" | "path" | "mode">>;
  uploadResumable(input: {
    bucket: string;
    key: string;
    file: string;
    checkpointFile: string;
    partSizeBytes: number;
    concurrency: number;
  }): Promise<Omit<TransferResult, "bucket" | "key" | "path" | "mode">>;
  downloadResumable(input: {
    bucket: string;
    key: string;
    output: string;
    checkpointFile: string;
    partSizeBytes: number;
    concurrency: number;
  }): Promise<Omit<TransferResult, "bucket" | "key" | "path" | "mode">>;
}
