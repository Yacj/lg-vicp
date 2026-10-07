import { fileTypeFromBuffer } from "file-type";
import path from "node:path";
import { AppError } from "../../shared/errors.js";
import {
  PAGE_IMAGE_MAX_BYTES,
  PAGE_IMAGE_MIME,
  ZIP_MANIFEST_MAX_BYTES,
  ZIP_MAX_IMAGE_ENTRIES,
  ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES
} from "../../shared/page-recognition.js";

export function normalizeZipEntryName(name: string): string {
  const slash = name.replace(/\\/g, "/");
  const normalized = path.posix.normalize(slash);
  if (!slash || slash.startsWith("/") || /^[A-Za-z]:/.test(slash)
    || normalized === ".." || normalized.startsWith("../")
    || slash.split("/").some((part) => part === "..")) {
    throw new AppError("INVALID_ZIP_PATH", "ZIP 内包含不安全的文件路径", 400);
  }
  return normalized.replace(/^\.\//, "");
}

function isAllowedPageImageName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg");
}

export async function detectPageImageMime(buffer: Buffer, fileName: string): Promise<string> {
  const detected = await fileTypeFromBuffer(buffer);
  const lower = fileName.toLowerCase();
  const extensionMime = lower.endsWith(".png") ? "image/png"
    : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : null;
  if (!detected || !PAGE_IMAGE_MIME.has(detected.mime) || detected.mime !== extensionMime) {
    throw new AppError("INVALID_PAGE_IMAGE", `${fileName} 内容与 PNG/JPG 扩展名不匹配`, 400);
  }
  return detected.mime;
}

type ZipDirectoryEntry = { name: string; uncompressedSize: number };

/** 在解压前读取 ZIP central directory，限制膨胀大小并拒绝危险路径/加密/ZIP64。 */
export function inspectZipCentralDirectory(buffer: Buffer): {
  entries: ZipDirectoryEntry[];
  imageCount: number;
  uncompressedBytes: number;
} {
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new AppError("INVALID_ZIP", "ZIP 文件缺少结束目录", 400);
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries
    || totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff
    || centralOffset + centralSize > eocd) {
    throw new AppError("INVALID_ZIP", "不支持分卷或 ZIP64 压缩包", 400);
  }
  const entries: ZipDirectoryEntry[] = [];
  let cursor = centralOffset;
  let uncompressedBytes = 0;
  let imageCount = 0;
  const seenNames = new Set<string>();
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > centralOffset + centralSize || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new AppError("INVALID_ZIP", "ZIP central directory 格式无效", 400);
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    if ((flags & 1) !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new AppError("INVALID_ZIP", "不支持加密或 ZIP64 文件", 400);
    }
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > centralOffset + centralSize) {
      throw new AppError("INVALID_ZIP", "ZIP central directory 长度无效", 400);
    }
    const rawName = new TextDecoder().decode(buffer.subarray(nameStart, nameEnd));
    const name = normalizeZipEntryName(rawName);
    if (seenNames.has(name)) throw new AppError("INVALID_ZIP", "ZIP 内存在重复文件路径", 400);
    seenNames.add(name);
    const isDirectory = name.endsWith("/");
    if (!isDirectory) {
      const basename = path.posix.basename(name).toLowerCase();
      if (basename !== "manifest.json" && !isAllowedPageImageName(name)) {
        throw new AppError("INVALID_ZIP_ENTRY", `ZIP 仅允许页面图片和 manifest.json：${basename}`, 400);
      }
      if (isAllowedPageImageName(name)) {
        imageCount += 1;
        if (uncompressedSize > PAGE_IMAGE_MAX_BYTES) {
          throw new AppError("PAGE_IMAGE_TOO_LARGE", `${basename} 超过 15MB`, 400);
        }
      }
      if (basename === "manifest.json" && uncompressedSize > ZIP_MANIFEST_MAX_BYTES) {
        throw new AppError("MANIFEST_TOO_LARGE", "manifest.json 不能超过 1MB", 400);
      }
      uncompressedBytes += uncompressedSize;
      if (uncompressedBytes > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new AppError("ZIP_EXPANDED_TOO_LARGE", "ZIP 解压后总大小不能超过 300MB", 400);
      }
      entries.push({ name, uncompressedSize });
    }
    cursor = nameEnd + extraLength + commentLength;
  }
  if (imageCount > ZIP_MAX_IMAGE_ENTRIES) {
    throw new AppError("ZIP_TOO_MANY_IMAGES", "ZIP 页面图片不能超过 200 张", 400);
  }
  return { entries, imageCount, uncompressedBytes };
}
