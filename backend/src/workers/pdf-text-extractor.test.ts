import { describe, expect, it, vi } from "vitest";
import { extractPdfText, extractPdfTextInWorker, type PdfTextWorker } from "./pdf-text-extractor.js";

type WorkerEvent = "message" | "error" | "exit";

class FakePdfWorker implements PdfTextWorker {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn(async () => 0);
  private readonly listeners = new Map<WorkerEvent, Array<(...args: any[]) => void>>();

  on(event: WorkerEvent, listener: (...args: any[]) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  once(event: WorkerEvent, listener: (...args: any[]) => void): void {
    this.on(event, listener);
  }

  emit(event: WorkerEvent, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

function createPdfWithPages(texts: readonly string[]): Buffer {
  const fontId = 3 + texts.length * 2;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${texts.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${texts.length} >>`
  ];
  for (const [index, text] of texts.entries()) {
    const content = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`
    );
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

describe("PDF 文本提取线程", () => {
  it("在独立线程中逐页提取真实 PDF 文本", async () => {
    const progress: number[] = [];
    const pages = await extractPdfTextInWorker(
      createPdfWithPages(["worker isolation", "second page"]),
      ({ pageNumber }) => progress.push(pageNumber)
    );

    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("worker isolation");
    expect(pages[1]).toContain("second page");
    expect(progress).toEqual([1, 2]);
  });

  it("按页号归位增量页面并在收到完成消息后返回", async () => {
    const worker = new FakePdfWorker();
    const result = extractPdfText(Buffer.from("pdf"), { createWorker: () => worker });

    worker.emit("message", { type: "page", pageNumber: 2, totalPages: 2, text: "第二页" });
    worker.emit("message", { type: "page", pageNumber: 1, totalPages: 2, text: "第一页" });
    worker.emit("message", { type: "done", totalPages: 2 });

    await expect(result).resolves.toMatchObject({ pages: ["第一页", "第二页"], outline: [] });
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("把缺页补为空文本，避免页码错位", async () => {
    const worker = new FakePdfWorker();
    const result = extractPdfText(Buffer.from("pdf"), { createWorker: () => worker });

    worker.emit("message", { type: "page", pageNumber: 3, totalPages: 3, text: "第三页" });
    worker.emit("message", { type: "done", totalPages: 3 });

    await expect(result).resolves.toMatchObject({ pages: ["", "", "第三页"], outline: [] });
  });

  it("将线程内的解析错误传递给任务处理器", async () => {
    const worker = new FakePdfWorker();
    const result = extractPdfText(Buffer.from("pdf"), { createWorker: () => worker });
    const assertion = expect(result).rejects.toThrow("PDF 引擎加载失败");

    worker.emit("message", { type: "error", message: "PDF 引擎加载失败" });

    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("将线程异常传递给任务处理器", async () => {
    const worker = new FakePdfWorker();
    const result = extractPdfText(Buffer.from("pdf"), { createWorker: () => worker });
    const assertion = expect(result).rejects.toThrow("线程崩溃");

    worker.emit("error", new Error("线程崩溃"));

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

  it("在长时间没有新页面时判定线程卡死", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakePdfWorker();
      const result = extractPdfText(Buffer.from("pdf"), {
        createWorker: () => worker,
        idleTimeoutMs: 10,
        totalTimeoutMs: 100_000
      });

      const assertion = expect(result).rejects.toThrow("无新页面进展");
      await vi.advanceTimersByTimeAsync(10);

      await assertion;
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("每收到一页就重置无进展计时", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakePdfWorker();
      const result = extractPdfText(Buffer.from("pdf"), {
        createWorker: () => worker,
        idleTimeoutMs: 100,
        totalTimeoutMs: 100_000
      });

      await vi.advanceTimersByTimeAsync(80);
      worker.emit("message", { type: "page", pageNumber: 1, totalPages: 1, text: "仍在推进" });
      await vi.advanceTimersByTimeAsync(80);
      worker.emit("message", { type: "done", totalPages: 1 });

      await expect(result).resolves.toMatchObject({ pages: ["仍在推进"], outline: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("在超过整体上限时终止线程", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakePdfWorker();
      const result = extractPdfText(Buffer.from("pdf"), {
        createWorker: () => worker,
        idleTimeoutMs: 100_000,
        totalTimeoutMs: 10
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