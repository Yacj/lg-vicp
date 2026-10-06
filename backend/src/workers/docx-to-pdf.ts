import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "../config/env.js";
import { DocxRenderError } from "../shared/docx-render-errors.js";

const TEMP_ROOT = join(tmpdir(), "vicp-docx-render");

export interface DocxToPdfInput {
  /** DOCX 二进制；与 temp path 二选一，优先 buffer */
  buffer?: Buffer;
  /** 已落盘的 DOCX 路径（测试或调用方自管文件时用） */
  inputPath?: string;
  /** 任务隔离目录名，建议用 parsingJobId / UUID */
  jobId: string;
  /** 覆盖默认超时（毫秒） */
  timeoutMs?: number;
  /** 覆盖 soffice 路径 */
  sofficePath?: string;
  /** 可注入 spawn（单测 mock） */
  spawnFn?: typeof spawn;
  documentId?: string;
  versionId?: string;
}

/**
 * 转换成功返回落盘路径；调用方必须两次独立 readFile(pdfPath) 再 transfer 给 Worker，
 * 并在 finally 中 cleanupTempDir(tempDir)。本函数成功路径不删除临时目录。
 */
export interface DocxToPdfResult {
  pdfPath: string;
  tempDir: string;
  durationMs: number;
  sofficePath: string;
}

export interface SofficeProbeResult {
  available: boolean;
  path: string | null;
  version: string | null;
  reason?: string;
}

function resolveSofficePath(override?: string): string {
  const configured = (override ?? env.SOFFICE_PATH ?? "soffice").trim();
  return configured.length > 0 ? configured : "soffice";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** 启动时轻量探测：不可用只告警，不阻断 API/Worker 启动 */
export async function probeSoffice(sofficePath?: string): Promise<SofficeProbeResult> {
  const path = resolveSofficePath(sofficePath);
  if (path.includes("/") || path.includes("\\")) {
    if (!(await pathExists(path))) {
      return { available: false, path, version: null, reason: "SOFFICE_NOT_FOUND" };
    }
  }
  return await new Promise((resolve) => {
    const child = spawn(path, ["--version"], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ available: false, path, version: null, reason: "DOCX_RENDER_TIMEOUT" });
    }, 8000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        available: false,
        path,
        version: null,
        reason: error.message.includes("ENOENT") ? "SOFFICE_NOT_FOUND" : error.message
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = `${stdout}\n${stderr}`.trim();
      if (code === 0 && text) {
        resolve({ available: true, path, version: text.split(/\r?\n/)[0]!.trim() });
        return;
      }
      resolve({
        available: false,
        path,
        version: null,
        reason: code === 0 ? "empty version output" : `exit ${code}`
      });
    });
  });
}

export async function logDocxRendererAvailability(): Promise<void> {
  if (!env.DOCX_RENDER_ENABLED) {
    console.info("DOCX renderer: disabled (DOCX_RENDER_ENABLED=false)");
    return;
  }
  try {
    const probe = await probeSoffice();
    if (probe.available) {
      console.info("DOCX renderer: available", {
        sofficePath: probe.path,
        libreOfficeVersion: probe.version
      });
    } else {
      console.warn("DOCX renderer: unavailable", {
        sofficePath: probe.path,
        reason: probe.reason
      });
    }
  } catch (error) {
    console.warn("DOCX renderer: unavailable", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * DOCX → 临时 PDF（LibreOffice Headless）。
 * - 每个 job 独立目录：/tmp/vicp-docx-render/<jobId>-xxxx/
 * - 成功：保留 tempDir/pdfPath，由编排层两次 readFile 后 finally 清理
 * - 失败：本函数清理 tempDir 再抛错
 */
export async function convertDocxToPdf(input: DocxToPdfInput): Promise<DocxToPdfResult> {
  if (!env.DOCX_RENDER_ENABLED) {
    throw new DocxRenderError("DOCX_RENDER_DISABLED");
  }

  const sofficePath = resolveSofficePath(input.sofficePath);
  const timeoutMs = input.timeoutMs ?? env.DOCX_RENDER_TIMEOUT_MS;
  const spawnFn = input.spawnFn ?? spawn;
  const startedAt = Date.now();

  await mkdir(TEMP_ROOT, { recursive: true });
  const safeJobId = input.jobId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "job";
  const tempDir = await mkdtemp(join(TEMP_ROOT, `${safeJobId}-`));
  const inputDocxPath = join(tempDir, "input.docx");
  const expectedPdfPath = join(tempDir, "input.pdf");

  const logContext = {
    documentId: input.documentId,
    versionId: input.versionId,
    jobId: input.jobId,
    tempDir
  };

  try {
    if (input.buffer) {
      await writeFile(inputDocxPath, input.buffer);
    } else if (input.inputPath) {
      const source = await readFile(input.inputPath);
      await writeFile(inputDocxPath, source);
    } else {
      throw new DocxRenderError("DOCX_RENDER_FAILED", "缺少 DOCX 输入（buffer 或 inputPath）", logContext);
    }

    console.info("DOCX render start", { ...logContext, sofficePath, timeoutMs });

    const { exitCode, stderr } = await runSofficeConvert({
      spawnFn,
      sofficePath,
      inputDocxPath,
      outDir: tempDir,
      expectedPdfPath,
      timeoutMs,
      logContext
    });

    if (!(await pathExists(expectedPdfPath))) {
      throw new DocxRenderError("DOCX_RENDER_OUTPUT_MISSING", undefined, {
        ...logContext,
        exitCode,
        stderr: truncate(stderr),
        durationMs: Date.now() - startedAt
      });
    }

    const durationMs = Date.now() - startedAt;
    console.info("LibreOffice convert complete", {
      ...logContext,
      exitCode,
      durationMs,
      pdfPath: expectedPdfPath
    });

    // 成功：不删 tempDir，供编排层两次独立 readFile（文本 Worker / 页图 Worker 各自 transfer）
    return {
      pdfPath: expectedPdfPath,
      tempDir,
      durationMs,
      sofficePath
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    await cleanupTempDir(tempDir);
    if (error instanceof DocxRenderError) {
      console.warn("DOCX render failed", {
        ...logContext,
        code: error.code,
        message: error.message,
        durationMs,
        ...error.details
      });
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT") || /spawn .* ENOENT/i.test(message)) {
      const wrapped = new DocxRenderError("SOFFICE_NOT_FOUND", undefined, {
        ...logContext,
        durationMs,
        sofficePath
      });
      console.warn("DOCX render failed", { ...logContext, code: wrapped.code, durationMs, sofficePath });
      throw wrapped;
    }
    throw new DocxRenderError("DOCX_RENDER_FAILED", message, { ...logContext, durationMs });
  }
}

async function runSofficeConvert(input: {
  spawnFn: typeof spawn;
  sofficePath: string;
  inputDocxPath: string;
  outDir: string;
  expectedPdfPath: string;
  timeoutMs: number;
  logContext: Record<string, unknown>;
}): Promise<{ exitCode: number | null; stderr: string }> {
  return await new Promise((resolve, reject) => {
    // 独立 UserInstallation：避免无头环境写 ~/.config 冲突/锁死
    const profileDir = join(input.outDir, "lo-profile");
    const profileUri = `file://${profileDir.replace(/\\/g, "/")}`;
    const args = [
      "--headless",
      "--nologo",
      "--nolockcheck",
      "--nodefault",
      "--nofirststartwizard",
      "--norestore",
      `-env:UserInstallation=${profileUri}`,
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      input.outDir,
      input.inputDocxPath
    ];
    const child = input.spawnFn(input.sofficePath, args, {
      windowsHide: true,
      // 单独进程组，超时时可整组 SIGKILL（soffice 会拉起子进程）
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        HOME: input.outDir,
        SAL_USE_VCLPLUGIN: "svp"
      }
    });

    let stderr = "";
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let lastPdfSize = -1;
    let stableHits = 0;

    const killTree = () => {
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    };

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pollTimer) clearInterval(pollTimer);
      action();
    };

    // soffice 常在写出 PDF 后迟迟不退出；PDF 落盘且大小稳定即视为成功
    pollTimer = setInterval(() => {
      void (async () => {
        if (settled) return;
        try {
          const { stat } = await import("node:fs/promises");
          const info = await stat(input.expectedPdfPath);
          if (!info.isFile() || info.size <= 0) {
            lastPdfSize = -1;
            stableHits = 0;
            return;
          }
          if (info.size === lastPdfSize) {
            stableHits += 1;
          } else {
            lastPdfSize = info.size;
            stableHits = 0;
          }
          // 连续约 1.5s 大小不变 → 转换完成
          if (stableHits >= 3) {
            finish(() => {
              killTree();
              resolve({ exitCode: 0, stderr });
            });
          }
        } catch {
          lastPdfSize = -1;
          stableHits = 0;
        }
      })();
    }, 500);

    const timer = setTimeout(() => {
      void (async () => {
        if (settled) return;
        // 超时兜底：若 PDF 已存在仍算成功（低配机 soffice 退出慢是常态）
        if (await pathExists(input.expectedPdfPath)) {
          finish(() => {
            killTree();
            resolve({ exitCode: 0, stderr });
          });
          return;
        }
        finish(() => {
          killTree();
          reject(new DocxRenderError("DOCX_RENDER_TIMEOUT", undefined, {
            ...input.logContext,
            timeoutMs: input.timeoutMs,
            stderr: truncate(stderr)
          }));
        });
      })();
    }, input.timeoutMs);

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        // 进程异常退出时，若 PDF 已写出仍接受（与超时兜底一致）
        void pathExists(input.expectedPdfPath).then((exists) => {
          if (exists) {
            finish(() => resolve({ exitCode: 0, stderr }));
          } else {
            finish(() => reject(new DocxRenderError("DOCX_RENDER_FAILED", undefined, {
              ...input.logContext,
              exitCode: code,
              stderr: truncate(stderr)
            })));
          }
        });
        return;
      }
      finish(() => resolve({ exitCode: code, stderr }));
    });
  });
}

export async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    console.warn("DOCX 临时目录清理失败", {
      tempDir,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function truncate(text: string, max = 2000): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}
