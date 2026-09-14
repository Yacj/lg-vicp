import { parentPort } from "node:worker_threads";
import type { PageLabelSource, PdfTextItemForLabel } from "../modules/knowledge/knowledge-page-label.js";

interface PdfTextRequest {
  data: Uint8Array;
}

export interface PdfExtractedTextItem extends PdfTextItemForLabel {
  hasEOL?: boolean;
}

/** 书签大纲条目（与 pdf-text-extractor.ts 的 PdfOutlineItem 保持同构） */
interface OutlineItem {
  title: string;
  level: number;
  pageNumber: number | null;
}

export interface PdfExtractedPage {
  pageNumber: number;
  text: string;
  items: PdfExtractedTextItem[];
  pageLabel: string | null;
  pageLabelSource: Extract<PageLabelSource, "PDF_PAGE_LABEL" | "FOOTER_TEXT"> | null;
  pageLabelConfidence: number | null;
  pageWidth?: number;
  pageHeight?: number;
  columnCount?: number;
}

type PdfTextMessage =
  | { type: "page"; pageNumber: number; totalPages: number; text: string; items: PdfExtractedTextItem[]; pageLabel: string | null; pageLabelSource: Extract<PageLabelSource, "PDF_PAGE_LABEL" | "FOOTER_TEXT"> | null; pageLabelConfidence: number | null; pageWidth?: number; pageHeight?: number; columnCount?: number }
  | { type: "done"; totalPages: number; outline?: OutlineItem[] }
  | { type: "error"; message: string };

const port = parentPort;
if (!port) throw new Error("PDF 文本提取线程缺少父线程端口");

/** pdfjs 大纲条目的最小结构（unpdf 内置 pdfjs fork，无官方类型） */
interface RawOutlineItem {
  title?: unknown;
  dest?: unknown;
  items?: unknown;
}

/**
 * 读取 PDF 书签大纲（TOC 第一优先级来源）：
 * 逐项解析 dest（命名目标或显式目标数组）→ getPageIndex 得到物理页序号（1-based）；
 * 单项解析失败仅置 null，不影响整体；任何异常都返回空数组，书签是增强信息不是必需品。
 */
async function readOutline(pdf: {
  getOutline: () => Promise<unknown>;
  getDestination: (name: string) => Promise<unknown>;
  getPageIndex: (ref: unknown) => Promise<number>;
}): Promise<OutlineItem[]> {
  let raw: unknown;
  try {
    raw = await pdf.getOutline();
  } catch {
    return [];
  }
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const output: OutlineItem[] = [];
  const resolvePageNumber = async (dest: unknown): Promise<number | null> => {
    try {
      const resolved = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      if (Array.isArray(resolved) && resolved.length > 0) {
        const index = await pdf.getPageIndex(resolved[0]);
        if (Number.isFinite(index)) return index + 1;
      }
    } catch {
      // 目标不可解析（转曲/外部链接/损坏 dest）→ 仅缺页码
    }
    return null;
  };
  const walk = async (items: RawOutlineItem[], level: number): Promise<void> => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const title = typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 255) : null;
      if (title) {
        output.push({ title, level, pageNumber: await resolvePageNumber(item.dest) });
      }
      if (Array.isArray(item.items) && item.items.length > 0 && level < 6) {
        await walk(item.items as RawOutlineItem[], level + 1);
      }
    }
  };
  await walk(raw as RawOutlineItem[], 1);
  return output;
}

async function readPdfPageLabels(pdf: unknown): Promise<Array<string | null>> {
  const getPageLabels = (pdf as { getPageLabels?: () => Promise<unknown> }).getPageLabels;
  if (typeof getPageLabels !== "function") return [];
  try {
    const labels = await getPageLabels.call(pdf);
    return Array.isArray(labels)
      ? labels.map((label) => typeof label === "string" && label.trim() ? label.trim().slice(0, 32) : null)
      : [];
  } catch {
    return [];
  }
}

function toTextItem(item: unknown): PdfExtractedTextItem | null {
  if (!item || typeof item !== "object") return null;
  const value = item as Record<string, unknown>;
  if (typeof value.str !== "string" || !value.str) return null;
  const transform = Array.isArray(value.transform) ? value.transform : [];
  const numberAt = (index: number, fallback = 0): number => {
    const result = transform[index];
    return typeof result === "number" && Number.isFinite(result) ? result : fallback;
  };
  return {
    text: value.str,
    x: numberAt(4),
    y: numberAt(5),
    width: typeof value.width === "number" && Number.isFinite(value.width) ? value.width : 0,
    height: typeof value.height === "number" && Number.isFinite(value.height) ? value.height : 0,
    fontSize: Math.abs(numberAt(0)) || Math.abs(numberAt(3)) || (typeof value.height === "number" ? value.height : 0),
    hasEOL: value.hasEOL === true
  };
}

/**
 * 逐页提取并立即释放页面资源。
 * 不使用 unpdf 的 extractText：该实现用 Promise.all 并发解析全部页且从不调用 page.cleanup()，
 * 会让整份文档的字体与文本中间态同时驻留，数百页文档足以耗尽容器内存。
 */
async function extractPagesSequentially(
  data: Uint8Array,
  emit: (message: PdfTextMessage) => void
): Promise<{ totalPages: number; outline: OutlineItem[] }> {
  const runtimeCompatSpecifier = `../shared/runtime-compat.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`;
  const pageLabelSpecifier = `../modules/knowledge/knowledge-page-label.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`;
  const layoutSpecifier = `../modules/knowledge/pdf-layout-text.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`;
  const { installPdfRuntimeCompat } = await import(runtimeCompatSpecifier);
  const { detectPrintedPageLabel } = await import(pageLabelSpecifier);
  const { reconstructPageText } = await import(layoutSpecifier);
  installPdfRuntimeCompat();
  const { getDocumentProxy } = await import("unpdf");

  const pdf = await getDocumentProxy(data);
  try {
    const totalPages = pdf.numPages;
    const pageLabels = await readPdfPageLabels(pdf);
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const items = content.items
          .map(toTextItem)
          .filter((item): item is PdfExtractedTextItem => item !== null);
        const viewport = page.getViewport({ scale: 1 });
        const pageWidth = viewport.width;
        const pageHeight = viewport.height;
        const pdfPageLabel = pageLabels[pageNumber - 1] ?? null;
        const printed = pdfPageLabel ? null : detectPrintedPageLabel(items, pageHeight);
        const layout = reconstructPageText(items, pageWidth, pageHeight);
        emit({
          type: "page",
          pageNumber,
          totalPages,
          text: layout.text,
          items,
          pageLabel: pdfPageLabel ?? printed?.pageLabel ?? null,
          pageLabelSource: pdfPageLabel ? "PDF_PAGE_LABEL" : printed ? "FOOTER_TEXT" : null,
          pageLabelConfidence: pdfPageLabel ? 1 : printed?.confidence ?? null,
          pageWidth,
          pageHeight,
          columnCount: layout.columnCount
        });
      } finally {
        page.cleanup();
      }
    }
    const outline = await readOutline(pdf as never);
    return { totalPages, outline };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

port.once("message", async (request: PdfTextRequest) => {
  try {
    if (!(request.data instanceof Uint8Array)) throw new Error("PDF 文本提取参数无效");
    const { totalPages, outline } = await extractPagesSequentially(request.data, (message) => port.postMessage(message));
    port.postMessage({ type: "done", totalPages, outline } satisfies PdfTextMessage);
  } catch (error) {
    port.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "PDF 文本提取失败"
    } satisfies PdfTextMessage);
  }
});