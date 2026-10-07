import path from "node:path";

/** 让临时签名下载名与正式页图对象扩展名一致。 */
export function getPageImageDownloadName(objectKey: string, pageNumber: number): string {
  const extension = path.extname(objectKey).toLowerCase();
  const safeExtension = extension === ".jpg" || extension === ".jpeg" ? extension : ".png";
  return `page-${pageNumber}${safeExtension}`;
}
