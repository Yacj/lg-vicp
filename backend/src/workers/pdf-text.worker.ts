import { parentPort } from "node:worker_threads";

interface PdfTextRequest {
  data: Uint8Array;
}

type PdfTextMessage =
  | { type: "page"; pageNumber: number; totalPages: number; text: string }
  | { type: "done"; totalPages: number }
  | { type: "error"; message: string };

const port = parentPort;
if (!port) throw new Error("PDF 文本提取线程缺少父线程端口");

/**
 * 逐页提取并立即释放页面资源。
 * 不使用 unpdf 的 extractText：该实现用 Promise.all 并发解析全部页且从不调用 page.cleanup()，
 * 会让整份文档的字体与文本中间态同时驻留，数百页文档足以耗尽容器内存。
 */
async function extractPagesSequentially(data: Uint8Array, emit: (message: PdfTextMessage) => void): Promise<number> {
  const runtimeCompatSpecifier = `../shared/runtime-compat.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`;
  const { installPdfRuntimeCompat } = await import(runtimeCompatSpecifier);
  installPdfRuntimeCompat();
  const { getDocumentProxy } = await import("unpdf");

  const pdf = await getDocumentProxy(data);
  try {
    const totalPages = pdf.numPages;
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .filter((item): item is Extract<typeof item, { str: string }> => "str" in item && item.str != null)
          .map((item) => item.str + (item.hasEOL ? "\n" : ""))
          .join("");
        emit({ type: "page", pageNumber, totalPages, text });
      } finally {
        page.cleanup();
      }
    }
    return totalPages;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

port.once("message", async (request: PdfTextRequest) => {
  try {
    if (!(request.data instanceof Uint8Array)) throw new Error("PDF 文本提取参数无效");
    const totalPages = await extractPagesSequentially(request.data, (message) => port.postMessage(message));
    port.postMessage({ type: "done", totalPages } satisfies PdfTextMessage);
  } catch (error) {
    port.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "PDF 文本提取失败"
    } satisfies PdfTextMessage);
  }
});