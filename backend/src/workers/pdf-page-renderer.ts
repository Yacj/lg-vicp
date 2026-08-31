import { Worker } from "node:worker_threads";

/**
 * PDF 页面预览渲染编排器（P0-4）：
 * 请求-应答协议保证同一时刻只渲染一页（渲染 → 回传 → 上传 OSS → 下一页），
 * 单页失败尽力而为跳过，不中断整份文档；禁止把全部页面渲染结果常驻内存。
 */
const PDF_PAGE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const PDF_RENDER_TIMEOUT_MS = 30 * 60 * 1000;
const PDF_WORKER_MAX_OLD_SPACE_MB = 512;

type PdfRenderMessage =
  | { type: "ready"; totalPages: number }
  | { type: "page"; pageNumber: number; data: ArrayBuffer }
  | { type: "pageError"; pageNumber: number; message: string }
  | { type: "error"; message: string };

type PdfWorkerEvent = "message" | "error" | "exit";
type PdfWorkerListener = (...args: any[]) => void;

export interface PdfRenderWorker {
  on(event: PdfWorkerEvent, listener: PdfWorkerListener): unknown;
  once(event: PdfWorkerEvent, listener: PdfWorkerListener): unknown;
  postMessage(value: unknown, transferList?: readonly ArrayBuffer[]): void;
  terminate(): Promise<number>;
}

export interface PdfPageRendered {
  pageNumber: number;
  data: Buffer;
}

export interface PdfRenderOptions {
  createWorker: () => PdfRenderWorker;
  dpi?: number;
  format?: "png" | "webp";
  /** 逐页回调（上传 OSS 由调用方完成）；返回 Promise，串行等待 */
  onPageRendered: (page: PdfPageRendered) => Promise<void>;
  /** 跳过已渲染页（幂等重跑） */
  shouldSkip?: (pageNumber: number) => boolean;
}

function toTransferableBytes(data: Buffer): { bytes: Uint8Array; buffer: ArrayBuffer } {
  const ownsWholeBuffer = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
  const buffer = (ownsWholeBuffer
    ? data.buffer
    : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) as ArrayBuffer;
  return { bytes: new Uint8Array(buffer), buffer };
}

function createPdfRenderWorker(): PdfRenderWorker {
  const isTypeScriptSource = import.meta.url.endsWith(".ts");
  const workerUrl = new URL(
    isTypeScriptSource ? "./pdf-render.worker.ts" : "./pdf-render.worker.js",
    import.meta.url
  );
  return new Worker(workerUrl, {
    name: "pdf-page-renderer",
    resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_MAX_OLD_SPACE_MB },
    ...(isTypeScriptSource ? { execArgv: ["--import", "tsx"] } : {})
  });
}

function isPdfRenderMessage(value: unknown): value is PdfRenderMessage {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type === "ready") return typeof message.totalPages === "number";
  if (message.type === "page") {
    return typeof message.pageNumber === "number" && message.data instanceof ArrayBuffer;
  }
  if (message.type === "pageError") {
    return typeof message.pageNumber === "number" && typeof message.message === "string";
  }
  return message.type === "error" && typeof message.message === "string";
}

export interface PdfRenderOutcome {
  totalPages: number;
  rendered: number[];
  failed: Array<{ pageNumber: number; message: string }>;
}

/** 渲染整份 PDF 的每一页（调用方逐页上传）；返回渲染成功/失败清单 */
export function renderPdfPages(data: Buffer, options: PdfRenderOptions): Promise<PdfRenderOutcome> {
  const { createWorker, dpi = 130, format = "png", onPageRendered, shouldSkip } = options;
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const rendered: number[] = [];
    const failed: PdfRenderOutcome["failed"] = [];
    let totalPages = 0;
    let next = 1;
    let settled = false;
    let idleTimer: NodeJS.Timeout | undefined;
    let totalTimer: NodeJS.Timeout | undefined;

    const finish = (result: { result: PdfRenderOutcome } | { error: Error }) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
      void worker.terminate().catch(() => undefined);
      if ("result" in result) resolve(result.result);
      else reject(result.error);
    };

    const armIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        finish({ error: new Error("PDF 页面渲染连续 5 分钟无进展，任务已终止") });
      }, PDF_PAGE_IDLE_TIMEOUT_MS);
      idleTimer.unref();
    };
    totalTimer = setTimeout(() => {
      finish({ error: new Error("PDF 页面渲染超过 30 分钟，任务已终止") });
    }, PDF_RENDER_TIMEOUT_MS);
    totalTimer.unref();

    const pump = async () => {
      while (next <= totalPages) {
        const pageNumber = next;
        if (shouldSkip?.(pageNumber)) {
          next += 1;
          continue;
        }
        armIdleTimer();
        worker.postMessage({ type: "render", pageNumber });
        next += 1;
        return; // 等待该页回传后再继续（concurrency = 1）
      }
      finish({ result: { totalPages, rendered, failed } });
    };

    worker.on("message", (message: unknown) => {
      if (settled) return;
      if (!isPdfRenderMessage(message)) {
        finish({ error: new Error("PDF 页面渲染线程返回无效结果") });
        return;
      }
      if (message.type === "ready") {
        totalPages = message.totalPages;
        armIdleTimer();
        void pump();
        return;
      }
      if (message.type === "page") {
        armIdleTimer();
        void onPageRendered({ pageNumber: message.pageNumber, data: Buffer.from(message.data) })
          .then(() => {
            rendered.push(message.pageNumber);
            void pump();
          })
          .catch((error: unknown) => {
            // 上传失败也按尽力而为处理：记为该页失败，继续后续页
            failed.push({
              pageNumber: message.pageNumber,
              message: error instanceof Error ? error.message : "页面预览上传失败"
            });
            void pump();
          });
        return;
      }
      if (message.type === "pageError") {
        failed.push({ pageNumber: message.pageNumber, message: message.message });
        void pump();
        return;
      }
      finish({ error: new Error(message.message) });
    });
    worker.once("error", (error: Error) => finish({ error }));
    worker.once("exit", (code: number) => {
      if (code !== 0) finish({ error: new Error(`PDF 页面渲染线程异常退出，退出码 ${code}`) });
    });

    const { bytes, buffer } = toTransferableBytes(data);
    try {
      worker.postMessage({ type: "load", data: bytes, dpi, format }, [buffer]);
    } catch (error) {
      finish({ error: error instanceof Error ? error : new Error("无法向 PDF 渲染线程发送任务") });
    }
  });
}

/** 接管 `data` 的所有权：字节会被转移到渲染线程，调用方在此之后不得再读取该 Buffer。 */
export function renderPdfPagesInWorker(
  data: Buffer,
  options: Omit<PdfRenderOptions, "createWorker">
): Promise<PdfRenderOutcome> {
  return renderPdfPages(data, { ...options, createWorker: createPdfRenderWorker });
}
