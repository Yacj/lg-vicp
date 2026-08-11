import { describe, expect, it, vi } from "vitest";
import { extractPdfText, extractPdfTextInWorker, type PdfTextWorker } from "./pdf-text-extractor.js";

type WorkerEvent = "message" | "error" | "exit";

class FakePdfWorker implements PdfTextWorker {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn(async () => 0);
  private readonly listeners = new Map<WorkerEvent, (...args: any[]) => void>();

  once(event: WorkerEvent, listener: (...args: any[]) => void): void {
    this.listeners.set(event, listener);
  }

  emit(event: WorkerEvent, ...args: any[]): void {
    this.listeners.get(event)?.(...args);
  }
}

function createPdfWithText(text: string): Buffer {
  const content = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

describe("PDF 文本提取线程", () => {
  it("在独立线程中加载 unpdf 并提取真实 PDF 文本", async () => {
    const pages = await extractPdfTextInWorker(createPdfWithText("worker isolation"));

    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("worker isolation");
  });

  it("接收有效页面并终止线程", async () => {
    const worker = new FakePdfWorker();
    const result = extractPdfText(Buffer.from("pdf"), { createWorker: () => worker });

    worker.emit("message", { ok: true, pages: ["第一页", "第二页"] });

    await expect(result).resolves.toEqual(["第一页", "第二页"]);
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("将线程错误传递给任务处理器", async () => {
    const worker = new FakePdfWorker();
    const result = extractPdfText(Buffer.from("pdf"), { createWorker: () => worker });
    const assertion = expect(result).rejects.toThrow("PDF 引擎加载失败");

    worker.emit("error", new Error("PDF 引擎加载失败"));

    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("在线程非零退出时失败", async () => {
    const worker = new FakePdfWorker();
    const result = extractPdfText(Buffer.from("pdf"), { createWorker: () => worker });
    const assertion = expect(result).rejects.toThrow("退出码 1");

    worker.emit("exit", 1);

    await assertion;
  });

  it("超时时终止线程", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakePdfWorker();
      const result = extractPdfText(Buffer.from("pdf"), {
        createWorker: () => worker,
        timeoutMs: 10
      });

      const assertion = expect(result).rejects.toThrow("超过 1 分钟");
      await vi.advanceTimersByTimeAsync(10);

      await assertion;
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});