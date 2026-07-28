import { describe, expect, it } from "vitest";
import { HuaweiObsApi } from "../src/obs-client.js";
import type { ResolvedBucket } from "../src/types.js";

const bucket: ResolvedBucket = {
  alias: "offline",
  name: "offline-example-bucket",
  endpoint: "https://obs.example.com",
  profileName: "offline",
  profile: {
    credentials: {
      source: "env",
      accessKeyIdEnv: "UNUSED_AK",
      secretAccessKeyEnv: "UNUSED_SK",
    },
    maxRetries: 1,
    timeoutSeconds: 1,
  },
  credentials: {
    accessKeyId: "offline-ak",
    secretAccessKey: "offline-sk",
  },
};

describe("Huawei OBS SDK adapter", () => {
  it("wraps callback-style resumable upload errors without making a request", async () => {
    const api = new HuaweiObsApi(bucket);
    try {
      await expect(
        api.uploadResumable({
          bucket: bucket.name,
          key: "missing.bin",
          file: "/path/that/does/not/exist",
          checkpointFile: "/tmp/unused-agent-obs-checkpoint",
          partSizeBytes: 9437184,
          concurrency: 1,
        }),
      ).rejects.toMatchObject({
        code: "OBS_TRANSFER_FAILED",
      });
    } finally {
      api.close();
    }
  });
});
