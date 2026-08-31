import { parentPort } from "node:worker_threads";

interface PdfRenderRequest {
  data: Uint8Array;
  dpi: number;
  format: "png" | "webp";
}

type PdfRenderMessage =
  | { type: "ready"; totalPages: number }
  | { type: "page"; pageNumber: number; data: ArrayBuffer }
  | { type: "pageError"; pageNumber: number; message: string }
  | { type: "error"; message: string };

const port = parentPort;
if (!port) throw new Error("PDF 页面渲染线程缺少父线程端口");

let pdf: Awaited<ReturnType<typeof loadDocument>> | null = null;
let format: "png" | "webp" = "png";

async function loadDocument(data: Uint8Array) {
  const runtimeCompatSpecifier = `../shared/runtime-compat.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`;
  const { installPdfRuntimeCompat } = await import(runtimeCompatSpecifier);
  installPdfRuntimeCompat();
  const { getDocumentProxy } = await import("unpdf");
  return getDocumentProxy(data);
}

/**
 * 渲染单页：物理页序号 1-based → PNG/WebP Buffer。
 * 先铺白底（PDF 透明背景直接渲染会变黑），逐页渲染后立即释放页面资源；
 * 同一时刻只处理一页（请求-应答协议），禁止全量页常驻内存。
 */
async function renderPage(pageNumber: number, dpi: number): Promise<ArrayBuffer> {
  if (!pdf) throw new Error("PDF 文档尚未加载");
  const page = await pdf.getPage(pageNumber);
  try {
    const scale = dpi / 72;
    const viewport = page.getViewport({ scale });
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport } as never).promise;
    // @napi-rs/canvas：encode() 仅支持 webp/jpeg，PNG 走 toBuffer
    const bytes = format === "webp" ? await canvas.encode("webp") : canvas.toBuffer("image/png");
    // 复制到独立 ArrayBuffer 以便零拷贝转移（canvas 内部缓冲区不可转移）
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
  } finally {
    page.cleanup();
  }
}

port.on("message", async (request: { type: string; pageNumber?: number } & Partial<PdfRenderRequest>) => {
  try {
    if (request.type === "load") {
      const req = request as unknown as PdfRenderRequest;
      if (!(req.data instanceof Uint8Array)) throw new Error("PDF 渲染参数无效");
      format = req.format === "webp" ? "webp" : "png";
      pdf = await loadDocument(req.data);
      port.postMessage({ type: "ready", totalPages: pdf.numPages } satisfies PdfRenderMessage);
      return;
    }
    if (request.type === "render") {
      const pageNumber = request.pageNumber!;
      try {
        const data = await renderPage(pageNumber, request.dpi ?? 130);
        port.postMessage({ type: "page", pageNumber, data } satisfies PdfRenderMessage, [data]);
      } catch (error) {
        // 单页渲染失败尽力而为：跳过该页继续，不中断整份文档
        port.postMessage({
          type: "pageError",
          pageNumber,
          message: error instanceof Error ? error.message : "页面渲染失败"
        } satisfies PdfRenderMessage);
      }
      return;
    }
  } catch (error) {
    port.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "PDF 页面渲染失败"
    } satisfies PdfRenderMessage);
  }
});
