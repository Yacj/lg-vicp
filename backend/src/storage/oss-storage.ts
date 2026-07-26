import OSS from "ali-oss";
import type { Env } from "../config/env.js";
import type { ObjectStorage, StoredObjectInfo, UploadUrlResult } from "./storage.js";

export class OssStorage implements ObjectStorage {
  readonly provider = "oss" as const;
  readonly bucket: string;
  private readonly client: OSS;

  constructor(private readonly env: Env) {
    this.bucket = env.STORAGE_BUCKET;
    this.client = new OSS({
      region: env.OSS_REGION,
      accessKeyId: env.STORAGE_ACCESS_KEY,
      accessKeySecret: env.STORAGE_SECRET_KEY,
      bucket: env.STORAGE_BUCKET,
      endpoint: env.OSS_ENDPOINT,
      internal: env.OSS_INTERNAL
    });
  }

  async ensureBucket(): Promise<void> {
    await this.client.getBucketInfo(this.bucket);
  }

  async createUploadUrl(objectKey: string, contentType: string, expiresSeconds: number): Promise<UploadUrlResult> {
    const url = this.client.signatureUrl(objectKey, {
      method: "PUT",
      expires: expiresSeconds,
      "Content-Type": contentType
    });
    return {
      url,
      headers: { "content-type": contentType },
      expiresAt: new Date(Date.now() + expiresSeconds * 1000)
    };
  }

  async createDownloadUrl(objectKey: string, fileName: string, expiresSeconds: number): Promise<string> {
    return this.client.signatureUrl(objectKey, {
      expires: expiresSeconds,
      response: {
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
      }
    });
  }

  async statObject(objectKey: string): Promise<StoredObjectInfo | null> {
    try {
      const result = await this.client.head(objectKey);
      const headers = result.res.headers as Record<string, string | undefined>;
      return {
        size: Number(headers["content-length"] ?? 0),
        contentType: headers["content-type"],
        etag: headers.etag
      };
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getObject(objectKey: string): Promise<Buffer> {
    const result = await this.client.get(objectKey);
    return Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content);
  }

  async putObject(objectKey: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.put(objectKey, data, { headers: { "Content-Type": contentType } });
  }

  async removeObject(objectKey: string): Promise<void> {
    await this.client.delete(objectKey);
  }

  async healthCheck(): Promise<void> {
    await this.client.getBucketInfo(this.bucket);
  }
}
