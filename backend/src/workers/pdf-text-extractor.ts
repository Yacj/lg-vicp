import { Worker } from "node:worker_threads";

const PDF_EXTRACTION_TIMEOUT_MS = 15 * 60 * 1000;

type PdfTextResponse =
  | { ok: true; pages: string[] }
  | { ok: false; error: string };

type PdfWorkerEvent = "message" | "error" | "exit";
type PdfWorkerListener = (...args: any[]) => void;

export interface PdfTextWorker {
  once(event: PdfWorkerEvent, listener: PdfWorkerListener): unknown;
  postMessage(value: unknown, transferList?: readonly ArrayBuffer[]): void;
  terminate(): Promise<number>;
}

export interface PdfTextExtractionOptions {
  createWorker: () => PdfTextWorker;
  timeoutMs?: number;
}

function isPdfTextResponse(value: unknown): value is PdfTextResponse {
  if (!value || typeof value !== "object" || !("ok" in value)) return false;
  if (value.ok === true) {
    return "pages" in value && Array.isArray(value.pages) && value.pages.every((page) => typeof page === "string");
  }
  return value.ok === false && "error" in value && typeof value.error === "string";
}

function createPdfTextWorker(): PdfTextWorker {
  const isTypeScriptSource = import.meta.url.endsWith(".ts");
  const workerUrl = new URL(
    isTypeScriptSource ? "./pdf-text.worker.ts" : "./pdf-text.worker.js",
    import.meta.url
  );
  return new Worker(workerUrl, {
    name: "pdf-text-extractor",
    ...(isTypeScriptSource ? { execArgv: ["--import", "tsx"] } : {})
  });
}

export function extractPdfText(
  data: Buffer,
  { createWorker, timeoutMs = PDF_EXTRACTION_TIMEOUT_MS }: PdfTextExtractionOptions
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;

    const finish = (result: { pages: string[] } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate().catch(() => undefined);
      if ("pages" in result) resolve(result.pages);
      else reject(result.error);
    };

    const timeout = setTimeout(() => {
      finish({ error: new Error(`PDF 文本提取超过 ${Math.ceil(timeoutMs / 60_000)} 分钟，任务已终止`) });
    }, timeoutMs);
    timeout.unref();

    worker.once("message", (message: unknown) => {
      if (!isPdfTextResponse(message)) {
        finish({ error: new Error("PDF 文本提取线程返回无效结果") });
      } else if (message.ok) {
        finish({ pages: message.pages });
      } else {
        finish({ error: new Error(message.error) });
      }
    });
    worker.once("error", (error: Error) => finish({ error }));
    worker.once("exit", (code: number) => {
      if (code !== 0) finish({ error: new Error(`PDF 文本提取线程异常退出，退出码 ${code}`) });
    });

    const bytes = Uint8Array.from(data);
    try {
      worker.postMessage({ data: bytes }, [bytes.buffer]);
    } catch (error) {
      finish({ error: error instanceof Error ? error : new Error("无法向 PDF 文本提取线程发送任务") });
    }
  });
}

export function extractPdfTextInWorker(data: Buffer): Promise<string[]> {
  return extractPdfText(data, { createWorker: createPdfTextWorker });
}