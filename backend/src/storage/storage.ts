export interface StoredObjectInfo {
  size: number;
  contentType?: string;
  etag?: string;
}

export interface UploadUrlResult {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectStorage {
  readonly provider: "minio" | "oss";
  readonly bucket: string;
  ensureBucket(): Promise<void>;
  createUploadUrl(objectKey: string, contentType: string, expiresSeconds: number): Promise<UploadUrlResult>;
  createDownloadUrl(objectKey: string, fileName: string, expiresSeconds: number): Promise<string>;
  statObject(objectKey: string): Promise<StoredObjectInfo | null>;
  getObject(objectKey: string): Promise<Buffer>;
  putObject(objectKey: string, data: Buffer, contentType: string): Promise<void>;
  removeObject(objectKey: string): Promise<void>;
  healthCheck(): Promise<void>;
}
