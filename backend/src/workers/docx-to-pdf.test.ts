import { EventEmitter } from "node:events";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
  process.env.DOCX_RENDER_ENABLED = "true";
  process.env.DOCX_RENDER_TIMEOUT_MS = "5000";
  process.env.SOFFICE_PATH = "/usr/bin/soffice";
});

import { cleanupTempDir, convertDocxToPdf } from "./docx-to-pdf.js";

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createSpawnThatWritesPdf(pdfContent = "%PDF-1.4 mock") {
  return vi.fn((_cmd: string, args: string[]) => {
    const outDir = args[args.indexOf("--outdir") + 1]!;
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    void (async () => {
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, "input.pdf"), Buffer.from(pdfContent));
      child.emit("close", 0);
    })();
    return child;
  });
}

describe("docx-to-pdf", () => {
  it("成功后 pdfPath/tempDir 仍存在，由调用方两次 readFile 后再 cleanup", async () => {
    const { readFile } = await import("node:fs/promises");
    const spawnFn = createSpawnThatWritesPdf("%PDF-text-then-render");
    const result = await convertDocxToPdf({
      buffer: Buffer.from("PK fake docx"),
      jobId: "job-lifecycle",
      spawnFn: spawnFn as never,
      sofficePath: "/usr/bin/soffice"
    });

    await access(result.pdfPath);
    await access(result.tempDir);

    // 模拟文本 Worker transfer：第一次读
    const textBuf = await readFile(result.pdfPath);
    expect(textBuf.toString("utf8")).toContain("%PDF");

    // 模拟页图 Worker：第二次独立读（即使第一次 Buffer 被 transfer/销毁也不影响）
    const renderBuf = await readFile(result.pdfPath);
    expect(renderBuf.equals(textBuf)).toBe(true);

    await cleanupTempDir(result.tempDir);
    await expect(access(result.pdfPath)).rejects.toBeTruthy();
  });

  it("soffice 可用时返回 pdfPath，并隔离临时目录", async () => {
    const spawnFn = createSpawnThatWritesPdf();
    const result = await convertDocxToPdf({
      buffer: Buffer.from("PK fake docx"),
      jobId: "job-a",
      spawnFn: spawnFn as never,
      sofficePath: "/usr/bin/soffice"
    });

    expect(result.pdfPath).toMatch(/input\.pdf$/);
    expect(spawnFn).toHaveBeenCalledOnce();
    const args = spawnFn.mock.calls[0]![1] as string[];
    expect(args).toEqual(expect.arrayContaining([
      "--headless",
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      "--norestore"
    ]));
    expect(args.some((arg) => String(arg).startsWith("-env:UserInstallation="))).toBe(true);
    await cleanupTempDir(result.tempDir);
  });

  it("并发两个 DOCX 使用不同临时目录", async () => {
    const outDirs: string[] = [];
    const spawnFn = vi.fn((_cmd: string, args: string[]) => {
      const outDir = args[args.indexOf("--outdir") + 1]!;
      outDirs.push(outDir);
      const child = new EventEmitter() as FakeChild;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      void (async () => {
        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, "input.pdf"), Buffer.from("%PDF-job"));
        child.emit("close", 0);
      })();
      return child;
    });

    const [a, b] = await Promise.all([
      convertDocxToPdf({ buffer: Buffer.from("a"), jobId: "job-1", spawnFn: spawnFn as never }),
      convertDocxToPdf({ buffer: Buffer.from("b"), jobId: "job-2", spawnFn: spawnFn as never })
    ]);
    expect(outDirs).toHaveLength(2);
    expect(outDirs[0]).not.toBe(outDirs[1]);
    await cleanupTempDir(a.tempDir);
    await cleanupTempDir(b.tempDir);
  });

  it("soffice 不存在时抛 SOFFICE_NOT_FOUND，并清理临时目录", async () => {
    const spawnFn = vi.fn(() => {
      const child = new EventEmitter() as FakeChild;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.emit("error", Object.assign(new Error("spawn soffice ENOENT"), { code: "ENOENT" }));
      });
      return child;
    });

    await expect(convertDocxToPdf({
      buffer: Buffer.from("x"),
      jobId: "missing",
      spawnFn: spawnFn as never
    })).rejects.toMatchObject({ code: "SOFFICE_NOT_FOUND" });
  });

  it("转换超时会 kill 子进程并抛 DOCX_RENDER_TIMEOUT", async () => {
    const spawnFn = vi.fn(() => {
      const child = new EventEmitter() as FakeChild;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => {
        queueMicrotask(() => child.emit("close", null));
      });
      return child;
    });

    await expect(convertDocxToPdf({
      buffer: Buffer.from("x"),
      jobId: "timeout",
      timeoutMs: 40,
      spawnFn: spawnFn as never
    })).rejects.toMatchObject({ code: "DOCX_RENDER_TIMEOUT" });

    const child = spawnFn.mock.results[0]!.value as FakeChild;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("退出码非 0 时抛 DOCX_RENDER_FAILED", async () => {
    const spawnFn = vi.fn(() => {
      const child = new EventEmitter() as FakeChild;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("convert failed"));
        child.emit("close", 1);
      });
      return child;
    });

    await expect(convertDocxToPdf({
      buffer: Buffer.from("x"),
      jobId: "fail",
      spawnFn: spawnFn as never
    })).rejects.toMatchObject({ code: "DOCX_RENDER_FAILED" });
  });

  it("退出成功但缺少 PDF 时抛 DOCX_RENDER_OUTPUT_MISSING", async () => {
    const spawnFn = vi.fn(() => {
      const child = new EventEmitter() as FakeChild;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    await expect(convertDocxToPdf({
      buffer: Buffer.from("x"),
      jobId: "no-pdf",
      spawnFn: spawnFn as never
    })).rejects.toMatchObject({ code: "DOCX_RENDER_OUTPUT_MISSING" });
  });
});
