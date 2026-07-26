import { Client } from "minio";
import type { Env } from "../config/env.js";
import type { ObjectStorage, StoredObjectInfo, UploadUrlResult } from "./storage.js";

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class MinioStorage implements ObjectStorage {
  readonly provider = "minio" as const;
  readonly bucket: string;
  private readonly client: Client;
  private readonly signingClient: Client;

  constructor(private readonly env: Env) {
    this.bucket = env.STORAGE_BUCKET;
    this.client = new Client({
      endPoint: env.STORAGE_ENDPOINT,
      port: env.STORAGE_PORT,
      useSSL: env.STORAGE_USE_SSL,
      accessKey: env.STORAGE_ACCESS_KEY,
      secretKey: env.STORAGE_SECRET_KEY
    });
    this.signingClient = new Client({
      endPoint: env.STORAGE_PUBLIC_ENDPOINT,
      port: env.STORAGE_PUBLIC_PORT,
      useSSL: env.STORAGE_PUBLIC_USE_SSL,
      accessKey: env.STORAGE_ACCESS_KEY,
      secretKey: env.STORAGE_SECRET_KEY
    });
  }

  async ensureBucket(): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket, "");
    }
  }

  async createUploadUrl(objectKey: string, contentType: string, expiresSeconds: number): Promise<UploadUrlResult> {
    const url = await this.signingClient.presignedPutObject(this.bucket, objectKey, expiresSeconds);
    return {
      url,
      headers: { "content-type": contentType },
      expiresAt: new Date(Date.now() + expiresSeconds * 1000)
    };
  }

  async createDownloadUrl(objectKey: string, fileName: string, expiresSeconds: number): Promise<string> {
    return this.signingClient.presignedGetObject(this.bucket, objectKey, expiresSeconds, {
      "response-content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
    });
  }

  async statObject(objectKey: string): Promise<StoredObjectInfo | null> {
    try {
      const stat = await this.client.statObject(this.bucket, objectKey);
      return {
        size: stat.size,
        contentType: stat.metaData?.["content-type"],
        etag: stat.etag
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "NotFound" || code === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  async getObject(objectKey: string): Promise<Buffer> {
    return streamToBuffer(await this.client.getObject(this.bucket, objectKey));
  }

  async putObject(objectKey: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, objectKey, data, data.length, { "Content-Type": contentType });
  }

  async removeObject(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey);
  }

  async healthCheck(): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) {
      throw new Error("MinIO 存储桶不存在");
    }
  }
}
