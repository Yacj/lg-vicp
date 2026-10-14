import { afterEach, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
// @ts-expect-error 部署纯JS模块，独立于业务服务。
import { assertInstallPlatform, downloadHostsFor, ensureReportRuntime, pickBrowser, safeDownloadHost } from "../deploy/report-runtime.mjs";
const require = createRequire(import.meta.url);
const { resolveReportChromium } = require("../deploy/report-runtime-config.cjs");
const directories: string[] = [];
async function temporary() { const dir = await mkdtemp(path.join(os.tmpdir(), "lg-report-deploy-test-")); directories.push(dir); return dir; }
afterEach(async () => { for (const dir of directories.splice(0)) {
  if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("测试清理路径越界");
  await rm(dir, { recursive: true, force: true });
} });
const readyOptions = () => ({ browser: "/existing/chromium", installEnabled: false, platform: "linux", arch: "x64", release: { ID: "debian", VERSION_ID: "12" }, uid: 0,
  runSmoke: vi.fn(async () => true), install: vi.fn(async () => "/cache/chromium"), save: vi.fn(async () => {}) });
it("已有中文PDF环境只检查复用，不重复安装；即使开启安装选项也不安装", async () => {
  const options = readyOptions(); options.installEnabled = true;
  expect(await ensureReportRuntime(options)).toMatchObject({ reused: true }); expect(options.install).not.toHaveBeenCalled(); expect(options.save).toHaveBeenCalledWith("/existing/chromium");
});
it("默认缺浏览器/字体拒绝，不安装、不保存未核验路径", async () => {
  const options = readyOptions(); options.runSmoke.mockResolvedValue(false);
  await expect(ensureReportRuntime(options)).rejects.toMatchObject({ code: "REPORT_RUNTIME_NOT_READY" });
  expect(options.install).not.toHaveBeenCalled(); expect(options.save).not.toHaveBeenCalled();
});
it("显式安装成功后再次真实自检；自检失败或下载失败不保存路径", async () => {
  const options = readyOptions(); options.installEnabled = true; options.browser = "";
  expect(await ensureReportRuntime(options)).toMatchObject({ reused: false, executablePath: "/cache/chromium" });
  expect(options.runSmoke).toHaveBeenCalledWith("/cache/chromium");
  options.save.mockClear(); options.runSmoke.mockResolvedValue(false);
  await expect(ensureReportRuntime(options)).rejects.toMatchObject({ code: "REPORT_RUNTIME_NOT_READY" }); expect(options.save).not.toHaveBeenCalled();
  options.install.mockRejectedValue(new Error("模拟下载失败")); await expect(ensureReportRuntime(options)).rejects.toThrow("模拟下载失败"); expect(options.save).not.toHaveBeenCalled();
});
it.each(["12", "13"])("Debian %s自动安装可用；Ubuntu版本和架构封闭校验", version => {
  expect(() => assertInstallPlatform("linux", "x64", { ID: "debian", VERSION_ID: version }, 0)).not.toThrow();
  expect(() => assertInstallPlatform("linux", "arm64", { ID: "ubuntu", VERSION_ID: "24.04" }, 0)).not.toThrow();
});
it("CentOS7/未知系统/权限不足不能自动安装；可复用已验证现有浏览器", async () => {
  expect(() => assertInstallPlatform("linux", "x64", { ID: "centos", VERSION_ID: "7" }, 0)).toThrow("自动安装仅支持");
  expect(() => assertInstallPlatform("linux", "x64", { ID: "debian", VERSION_ID: "12" }, 1000)).toThrow("需要root");
  const options = readyOptions(); options.release = { ID: "centos", VERSION_ID: "7" };
  expect(await ensureReportRuntime(options)).toMatchObject({ reused: true }); expect(options.install).not.toHaveBeenCalled();
});
it("显式无效路径不静默替换；无显式配置可使用匹配缓存或系统浏览器", () => {
  expect(() => pickBrowser({ executablePath: "/missing", explicit: true }, "/managed", [], () => false)).toThrow("不会自动替换");
  expect(pickBrowser({ executablePath: "", explicit: false }, "/managed", ["/system"], p => p === "/system")).toBe("/system");
});
it.each(["http://mirror.example", "https://user:password@mirror.example", "https://mirror.example?token=secret", "invalid"])("镜像配置拒绝凭据/非HTTPS：%s", host => {
  expect(() => safeDownloadHost(host)).toThrow("下载源必须为HTTPS");
});
it("PM2与部署共享显式配置优先级，不读取或覆盖业务配置", async () => {
  const root = await temporary(); await mkdir(path.join(root, ".cache"));
  await writeFile(path.join(root, ".cache/report-runtime.json"), JSON.stringify({ schemaVersion: 1, executablePath: "/verified/chromium" }));
  expect(resolveReportChromium(root, {}, {})).toEqual({ executablePath: "/verified/chromium", explicit: false });
  expect(resolveReportChromium(root, { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "'/explicit/chromium'" }, {})).toEqual({ executablePath: "/explicit/chromium", explicit: true });
  expect(resolveReportChromium(root, {}, { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/process/chromium" })).toMatchObject({ executablePath: "/process/chromium" });
});
it("国内镜像保留当前CLI的builds/cft与builds/chromium目录，可显式覆盖", () => {
  expect(downloadHostsFor({}).chromium).toBe("https://cdn.npmmirror.com/binaries/playwright");
  expect(downloadHostsFor({}).other).toBe("https://cdn.npmmirror.com/binaries/playwright");
  expect(downloadHostsFor({ DEPLOY_REPORT_CHROMIUM_DOWNLOAD_HOST: "https://mirror.example" }).chromium).toBe("https://mirror.example");
});
const gitBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" ? gitBash : "/bin/bash";
const posix = (p: string) => process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`) : p;
it.skipIf(!existsSync(bash))("服务器脚本自检失败必在迁移/seed/PM2之前退出并恢复dist（临时目录+所有命令桩）", async () => {
  const root = await temporary();
  for (const dir of ["deploy", "dist/db", "drizzle", ".bak/dist", "bin"]) await mkdir(path.join(root, dir), { recursive: true });
  const script = (await readFile(path.resolve("deploy/remote-apply.sh"), "utf8")).replace(/\r\n/g, "\n");
  await writeFile(path.join(root, "deploy/remote-apply.sh"), script);
  for (const file of ["dist/server.js", "dist/worker.js", "dist/db/migrate.js", "package.json", "pnpm-lock.yaml"]) await writeFile(path.join(root, file), "fixture");
  await writeFile(path.join(root, ".bak/dist/old-version"), "previous");
  const config = `JWT_SECRET=fixture-jwt\nAI_CONFIG_ENCRYPTION_KEY=${"a".repeat(32)}\nBOOTSTRAP_ADMIN_PASSWORD=fixture-password\nDATABASE_URL=postgresql://fixture.invalid/test\n`;
  await writeFile(path.join(root, ".env"), config);
  await writeFile(path.join(root, "bin/node"), '#!/usr/bin/env bash\ncase "$1" in -p) echo 22;; -e) exit 0;; deploy/report-runtime.mjs) echo runtime-check >> "$TEST_LOG"; exit 1;; *) echo forbidden-node >> "$TEST_LOG"; exit 99;; esac\n', { mode: 0o755 });
  for (const command of ["npm", "pnpm", "pm2"]) await writeFile(path.join(root, `bin/${command}`), `#!/usr/bin/env bash\necho ${command} >> "$TEST_LOG"\nexit 0\n`, { mode: 0o755 });
  const log = path.join(root, "calls");
  const result = spawnSync(bash, ["-c", 'export PATH="$1:$PATH"; bash "$2"', "--", posix(path.join(root, "bin")), posix(path.join(root, "deploy/remote-apply.sh"))],
    { env: { ...process.env, TEST_LOG: posix(log) }, encoding: "utf8", timeout: 30_000 });
  expect(result.status, result.stderr).toBe(1); expect(result.stdout + result.stderr).toContain("未执行数据库步骤，PM2未重载");
  const calls = await readFile(log, "utf8"); expect(calls).toContain("runtime-check"); expect(calls).not.toContain("forbidden-node"); expect(calls).not.toContain("pm2");
  expect(await readFile(path.join(root, ".env"), "utf8")).toBe(config); expect(await readFile(path.join(root, "dist/old-version"), "utf8")).toBe("previous");
});
