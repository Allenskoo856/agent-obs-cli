import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  listObjects,
  normalizePrefix,
  objectKeyForFile,
  uploadBatch,
  uploadFile,
  walkRegularFiles,
} from "../src/operations.js";
import type {
  ObjectMetadata,
  ObsApi,
  ResolvedBucket,
} from "../src/types.js";

function fakeApi(overrides: Partial<ObsApi> = {}): ObsApi {
  return {
    close: vi.fn(),
    getBucketInfo: vi.fn(),
    headObject: vi.fn(async () => null),
    listObjectsPage: vi.fn(),
    uploadSimple: vi.fn(async () => ({})),
    uploadResumable: vi.fn(async () => ({})),
    downloadResumable: vi.fn(async () => ({})),
    ...overrides,
  } as ObsApi;
}

const bucket: ResolvedBucket = {
  alias: "assets",
  name: "real-assets-bucket",
  endpoint: "https://obs.example.com",
  profileName: "prod",
  profile: {
    credentials: {
      source: "env",
      accessKeyIdEnv: "AK",
      secretAccessKeyEnv: "SK",
    },
    maxRetries: 3,
    timeoutSeconds: 60,
  },
  credentials: {
    accessKeyId: "ak",
    secretAccessKey: "sk",
  },
};

describe("object path mapping", () => {
  it("normalizes a batch prefix and relative path", () => {
    expect(normalizePrefix("/assets\\images/")).toBe("assets/images/");
    expect(
      objectKeyForFile(
        path.join(path.sep, "tmp", "source"),
        path.join(path.sep, "tmp", "source", "icons", "a.svg"),
        "release/",
      ),
    ).toBe("release/icons/a.svg");
  });

  it("walks regular files and skips symlinks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-obs-walk-"));
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "a.txt"), "a");
    await writeFile(path.join(root, "nested", "b.txt"), "b");
    await symlink(path.join(root, "a.txt"), path.join(root, "linked.txt"));

    const files = await walkRegularFiles(root);
    expect(files.map((file) => path.relative(root, file))).toEqual([
      "a.txt",
      path.join("nested", "b.txt"),
    ]);
  });
});

describe("OBS operations", () => {
  it("paginates object listings", async () => {
    const listObjectsPage = vi
      .fn()
      .mockResolvedValueOnce({
        bucket: bucket.name,
        objects: [{ key: "a", size: 1 }],
        commonPrefixes: [],
        count: 1,
        isTruncated: true,
        nextMarker: "a",
      })
      .mockResolvedValueOnce({
        bucket: bucket.name,
        objects: [{ key: "b", size: 2 }],
        commonPrefixes: [],
        count: 1,
        isTruncated: false,
      });
    const result = await listObjects(fakeApi({ listObjectsPage }), {
      bucket: bucket.name,
      limit: 10,
      all: false,
    });

    expect(result.objects.map((item) => item.key)).toEqual(["a", "b"]);
    expect(listObjectsPage).toHaveBeenCalledTimes(2);
    expect(listObjectsPage.mock.calls[1]![0]).toMatchObject({ marker: "a" });
  });

  it("refuses to overwrite an existing object", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-obs-put-"));
    const file = path.join(directory, "a.txt");
    await writeFile(file, "hello");
    const existing: ObjectMetadata = { key: "a.txt", metadata: {} };
    const api = fakeApi({ headObject: vi.fn(async () => existing) });

    await expect(
      uploadFile(api, bucket, path.join(directory, "config.json"), {
        file,
        key: "a.txt",
        overwrite: false,
        concurrency: 4,
        partSizeBytes: 9437184,
      }),
    ).rejects.toThrow(/--overwrite/);
  });

  it("uses simple upload below 100 KiB", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-obs-small-"));
    const file = path.join(directory, "a.txt");
    await writeFile(file, "hello");
    const uploadSimple = vi.fn(async () => ({ etag: "etag" }));
    const api = fakeApi({ uploadSimple });

    const result = await uploadFile(
      api,
      bucket,
      path.join(directory, "config.json"),
      {
        file,
        key: "a.txt",
        overwrite: false,
        concurrency: 4,
        partSizeBytes: 9437184,
      },
    );

    expect(result.mode).toBe("simple");
    expect(uploadSimple).toHaveBeenCalledOnce();
  });

  it("dry-runs a recursive batch and reports conflicts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-obs-batch-"));
    await writeFile(path.join(directory, "a.txt"), "a");
    await writeFile(path.join(directory, "b.txt"), "b");
    const api = fakeApi({
      headObject: vi.fn(async (_bucket, key) =>
        key === "prefix/a.txt" ? { key, metadata: {} } : null,
      ),
    });

    const result = await uploadBatch(
      api,
      bucket,
      path.join(directory, "config.json"),
      {
        source: directory,
        prefix: "prefix",
        overwrite: false,
        dryRun: true,
        concurrency: 2,
        partSizeBytes: 9437184,
      },
    );

    expect(result).toMatchObject({
      total: 2,
      planned: 1,
      skipped: 1,
      uploaded: 0,
      failed: 0,
    });
  });
});
