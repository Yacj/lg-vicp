import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderPdfPagesInWorker } from "../../workers/pdf-page-renderer.js";
import type { VisualPageMatch } from "./knowledge-page-mapping.js";

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;
const VISUAL_DPI = 36;

/** 对低分辨率页面缩略图计算 dHash；只用于缩小双源映射候选范围。 */
export async function calculateDHash(imageData: Buffer): Promise<string> {
  const image = await loadImage(imageData);
  const canvas = createCanvas(HASH_WIDTH, HASH_HEIGHT);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, HASH_WIDTH, HASH_HEIGHT);
  context.drawImage(image, 0, 0, HASH_WIDTH, HASH_HEIGHT);
  const pixels = context.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT).data;
  let hash = "";
  for (let row = 0; row < HASH_HEIGHT; row++) {
    for (let column = 0; column < HASH_WIDTH - 1; column++) {
      const left = row * HASH_WIDTH + column;
      const right = left + 1;
      const leftGray = pixels[left * 4]! * 0.299 + pixels[left * 4 + 1]! * 0.587 + pixels[left * 4 + 2]! * 0.114;
      const rightGray = pixels[right * 4]! * 0.299 + pixels[right * 4 + 1]! * 0.587 + pixels[right * 4 + 2]! * 0.114;
      hash += leftGray > rightGray ? "1" : "0";
    }
  }
  return BigInt(`0b${hash}`).toString(16).padStart(16, "0");
}

export function hammingDistance(left: string, right: string): number {
  const a = BigInt(`0x${left}`);
  const b = BigInt(`0x${right}`);
  let value = a ^ b;
  let distance = 0;
  while (value > 0n) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}

async function renderHashes(data: Buffer): Promise<Map<number, string>> {
  const hashes = new Map<number, string>();
  await renderPdfPagesInWorker(data, {
    dpi: VISUAL_DPI,
    format: "png",
    onPageRendered: async ({ pageNumber, data: image }) => {
      hashes.set(pageNumber, await calculateDHash(image));
    }
  });
  return hashes;
}

/**
 * 渲染两份 PDF 的低分辨率缩略图并为每个 Search 页面选择唯一最佳 Original 页面。
 * 置信度不足时不返回候选，防止视觉近似被误当成正式定位。
 */
export async function findVisualPageMatches(
  originalData: Buffer,
  searchData: Buffer,
  minimumConfidence = 0.7
): Promise<VisualPageMatch[]> {
  const originalHashes = await renderHashes(originalData);
  const searchHashes = await renderHashes(searchData);
  const usedOriginalPages = new Set<number>();
  const matches: VisualPageMatch[] = [];
  for (const [searchPhysicalPageNumber, searchHash] of searchHashes) {
    let best: { originalPhysicalPageNumber: number; distance: number } | null = null;
    for (const [originalPhysicalPageNumber, originalHash] of originalHashes) {
      if (usedOriginalPages.has(originalPhysicalPageNumber)) continue;
      const distance = hammingDistance(searchHash, originalHash);
      if (!best || distance < best.distance) best = { originalPhysicalPageNumber, distance };
    }
    if (!best) continue;
    const confidence = 1 - best.distance / 64;
    if (confidence < minimumConfidence) continue;
    usedOriginalPages.add(best.originalPhysicalPageNumber);
    matches.push({ searchPhysicalPageNumber, originalPhysicalPageNumber: best.originalPhysicalPageNumber, confidence });
  }
  return matches.sort((a, b) => a.searchPhysicalPageNumber - b.searchPhysicalPageNumber);
}
