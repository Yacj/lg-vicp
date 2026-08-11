import { parentPort } from "node:worker_threads";

interface PdfTextRequest {
  data: Uint8Array;
}

type PdfTextResponse =
  | { ok: true; pages: string[] }
  | { ok: false; error: string };

const port = parentPort;
if (!port) throw new Error("PDF 文本提取线程缺少父线程端口");

port.once("message", async (request: PdfTextRequest) => {
  let response: PdfTextResponse;
  try {
    if (!(request.data instanceof Uint8Array)) throw new Error("PDF 文本提取参数无效");
    const runtimeCompatSpecifier = `../shared/runtime-compat.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`;
    const { installPdfRuntimeCompat } = await import(runtimeCompatSpecifier);
    installPdfRuntimeCompat();
    const { extractText } = await import("unpdf");
    const result = await extractText(request.data, { mergePages: false });
    response = { ok: true, pages: result.text };
  } catch (error) {
    response = {
      ok: false,
      error: error instanceof Error ? error.message : "PDF 文本提取失败"
    };
  }
  port.postMessage(response);
});