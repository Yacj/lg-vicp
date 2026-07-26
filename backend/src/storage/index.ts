import type { Env } from "../config/env.js";
import { MinioStorage } from "./minio-storage.js";
import { OssStorage } from "./oss-storage.js";
import type { ObjectStorage } from "./storage.js";

export type { ObjectStorage, StoredObjectInfo, UploadUrlResult } from "./storage.js";

export function createObjectStorage(env: Env): ObjectStorage {
  return env.STORAGE_PROVIDER === "oss" ? new OssStorage(env) : new MinioStorage(env);
}
