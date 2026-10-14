import { expect, it } from "vitest";
import type { Env } from "../config/env.js";
import { OssStorage } from "./oss-storage.js";

it("OSS默认使用HTTPS签名，预览inline与下载attachment分开，签名不需要网络写入", async () => {
  const storage = new OssStorage({ OSS_REGION: "oss-cn-beijing", STORAGE_ACCESS_KEY: "fixture-access",
    STORAGE_SECRET_KEY: "fixture-secret", STORAGE_BUCKET: "fixture-bucket", OSS_INTERNAL: false } as Env);
  const preview = new URL(await storage.createPreviewUrl("reports/fixture.pdf", 60));
  const download = new URL(await storage.createDownloadUrl("reports/fixture.pdf", "方案.pdf", 60));
  expect(preview.protocol).toBe("https:");
  expect(download.protocol).toBe("https:");
  expect(preview.searchParams.get("response-content-disposition")).toBe("inline");
  expect(download.searchParams.get("response-content-disposition")).toContain("attachment");
});
