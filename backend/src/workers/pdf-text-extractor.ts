import { Worker } from "node:worker_threads";

/**
 * 单页长时间无进展判定线程卡死；整体上限兜底，防止超大文档无限占用文档队列。
 * 整体上限必须小于 docker-compose 中 worker 的 stop_grace_period，
 * 否则部署停机会在任务自行超时前强杀容器，重新制造 stalled。
 */
const PDF_PAGE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const PDF_EXTRACTION_TIMEOUT_MS = 20 * 60 * 1000;

type PdfTextMessage =
  | { type: "page"; pageNumber: number; totalPages: number; text: string }
  | { type: "done"; totalPages: number }
  | { type: "error"; message: string };

type PdfWorkerEvent = "message" | "error" | "exit";
type PdfWorkerListener = (...args: any[]) => void;

export interface PdfTextWorker {
  on(event: PdfWorkerEvent, listener: PdfWorkerListener): unknown;
  once(event: PdfWorkerEvent, listener: PdfWorkerListener): unknown;
  postMessage(value: unknown, transferList?: readonly ArrayBuffer[]): void;
  terminate(): Promise<number>;
}

export interface PdfPageProgress {
  pageNumber: number;
  totalPages: number;
}

export interface PdfTextExtractionOptions {
  createWorker: () => PdfTextWorker;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  onPage?: (progress: PdfPageProgress) => void;
}

function isPdfTextMessage(value: unknown): value is PdfTextMessage {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type === "page") {
    return typeof message.pageNumber === "number"
      && typeof message.totalPages === "number"
      && typeof message.text === "string";
  }
  if (message.type === "done") return typeof message.totalPages === "number";
  return message.type === "error" && typeof message.message === "string";
}

/**
 * 构造可转移的字节视图及其底层 ArrayBuffer。
 * 大 Buffer 由 Buffer.concat 独占底层内存，可直接零拷贝转移；
 * 小 Buffer 可能落在 Node 共享内存池上，必须先复制，否则转移会连带废掉池中其他 Buffer。
 */
function toTransferableBytes(data: Buffer): { bytes: Uint8Array; buffer: ArrayBuffer } {
  const ownsWholeBuffer = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
  // 对象存储读出的 Buffer 始终基于普通 ArrayBuffer，不会是 SharedArrayBuffer
  const buffer = (ownsWholeBuffer
    ? data.buffer
    : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) as ArrayBuffer;
  return { bytes: new Uint8Array(buffer), buffer };
}

/**
 * 解析线程的独立堆上限。worker_threads 有自己的 V8 隔离堆，不受主进程 --max-old-space-size 约束，
 * 必须单独限制；超限时线程抛出 ERR_WORKER_OUT_OF_MEMORY，经 error 事件转为当前任务失败，
 * 不会波及主线程与其他队列。
 */
const PDF_WORKER_MAX_OLD_SPACE_MB = 512;

function createPdfTextWorker(): PdfTextWorker {
  const isTypeScriptSource = import.meta.url.endsWith(".ts");
  const workerUrl = new URL(
    isTypeScriptSource ? "./pdf-text.worker.ts" : "./pdf-text.worker.js",
    import.meta.url
  );
  return new Worker(workerUrl, {
    name: "pdf-text-extractor",
    resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_MAX_OLD_SPACE_MB },
    ...(isTypeScriptSource ? { execArgv: ["--import", "tsx"] } : {})
  });
}

/**
 * 在独立线程中逐页提取 PDF 文本。线程每完成一页就回传该页文本并释放页面资源，
 * 主线程只按页累积字符串，不持有 PDF 解析中间态。
 */
export function extractPdfText(
  data: Buffer,
  {
    createWorker,
    idleTimeoutMs = PDF_PAGE_IDLE_TIMEOUT_MS,
    totalTimeoutMs = PDF_EXTRACTION_TIMEOUT_MS,
    onPage
  }: PdfTextExtractionOptions
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const pages: string[] = [];
    let settled = false;

    const finish = (result: { pages: string[] } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      void worker.terminate().catch(() => undefined);
      if ("pages" in result) resolve(result.pages);
      else reject(result.error);
    };

    const minutes = (ms: number) => Math.ceil(ms / 60_000);
    const startIdleTimer = () => {
      const timer = setTimeout(() => {
        finish({ error: new Error(`PDF 文本提取已连续 ${minutes(idleTimeoutMs)} 分钟无新页面进展，任务已终止`) });
      }, idleTimeoutMs);
      timer.unref();
      return timer;
    };

    let idleTimer = startIdleTimer();
    const totalTimer = setTimeout(() => {
      finish({ error: new Error(`PDF 文本提取超过 ${minutes(totalTimeoutMs)} 分钟，任务已终止`) });
    }, totalTimeoutMs);
    totalTimer.unref();

    worker.on("message", (message: unknown) => {
      if (settled) return;
      if (!isPdfTextMessage(message)) {
        finish({ error: new Error("PDF 文本提取线程返回无效结果") });
        return;
      }
      if (message.type === "page") {
        clearTimeout(idleTimer);
        idleTimer = startIdleTimer();
        pages[message.pageNumber - 1] = message.text;
        onPage?.({ pageNumber: message.pageNumber, totalPages: message.totalPages });
        return;
      }
      if (message.type === "done") {
        for (let index = 0; index < message.totalPages; index++) {
          pages[index] ??= "";
        }
        finish({ pages });
        return;
      }
      finish({ error: new Error(message.message) });
    });
    worker.once("error", (error: Error) => finish({ error }));
    worker.once("exit", (code: number) => {
      if (code !== 0) finish({ error: new Error(`PDF 文本提取线程异常退出，退出码 ${code}`) });
    });

    const { bytes, buffer } = toTransferableBytes(data);
    try {
      worker.postMessage({ data: bytes }, [buffer]);
    } catch (error) {
      finish({ error: error instanceof Error ? error : new Error("无法向 PDF 文本提取线程发送任务") });
    }
  });
}

/**
 * 接管 `data` 的所有权：字节会被转移到解析线程，调用方在此之后不得再读取该 Buffer。
 */
export function extractPdfTextInWorker(data: Buffer, onPage?: (progress: PdfPageProgress) => void): Promise<string[]> {
  return extractPdfText(data, { createWorker: createPdfTextWorker, onPage });
}