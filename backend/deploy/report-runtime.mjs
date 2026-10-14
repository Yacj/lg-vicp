import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { resolveReportChromium } from "./report-runtime-config.cjs";

// 当前锁文件版本使用builds/cft/...；npmmirror的playwright镜像保留这一目录结构。
export const DEFAULT_DOWNLOAD_HOSTS = { chromium: "https://cdn.npmmirror.com/binaries/playwright", other: "https://cdn.npmmirror.com/binaries/playwright" };
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export function safeDownloadHost(value) {
  try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error(); return url.href.replace(/\/$/, ""); }
  catch { fail("REPORT_DOWNLOAD_HOST_INVALID", "下载源必须为HTTPS地址，不能包含凭据、查询参数或片段。"); }
}
export function downloadHostsFor(env) {
  return { chromium: safeDownloadHost(env.DEPLOY_REPORT_CHROMIUM_DOWNLOAD_HOST || DEFAULT_DOWNLOAD_HOSTS.chromium),
    other: safeDownloadHost(env.DEPLOY_REPORT_DOWNLOAD_HOST || DEFAULT_DOWNLOAD_HOSTS.other) };
}
export function assertInstallPlatform(platform, arch, release, uid) {
  const alinux3 = release.ID === "alinux" && release.VERSION_ID === "3" && arch === "x64";
  if (platform !== "linux" || !["x64", "arm64"].includes(arch)
    || !(release.ID === "debian" && ["12", "13"].includes(release.VERSION_ID)
      || release.ID === "ubuntu" && ["22.04", "24.04"].includes(release.VERSION_ID) || alinux3))
    fail("REPORT_RUNTIME_OS_UNSUPPORTED", "自动安装支持Debian 12/13、Ubuntu 22.04/24.04（x64/arm64）及Alibaba Cloud Linux 3（x64）；其他系统请先配置可用Chromium和中文字体。");
  if (uid !== 0) fail("REPORT_RUNTIME_INSTALL_PERMISSION", "安装系统运行库/字体需要root；请由管理员预装，再用PM2运行账号执行检查。");
}
export function pickBrowser(configured, managedPath, candidates, executable) {
  if (configured.explicit && !executable(configured.executablePath)) fail("REPORT_CHROMIUM_PATH_INVALID", "已配置浏览器路径不存在或不可执行，请修正配置；不会自动替换显式路径。");
  return [configured.executablePath, managedPath, ...candidates].find(value => value && executable(value)) || "";
}

/** run/check/save可注入用于模拟测试；默认检查不安装任何软件。 */
export async function ensureReportRuntime(options) {
  const { runSmoke, install, save } = options;
  let browser = options.browser;
  if (browser && await runSmoke(browser)) { await save(browser); return { reused: true, executablePath: browser }; }
  if (!options.installEnabled) fail("REPORT_RUNTIME_NOT_READY", "Chromium/中文字体/PDF自检未通过；请预装运行环境，或首次部署显式增加 --install-report-runtime。");
  assertInstallPlatform(options.platform, options.arch, options.release, options.uid);
  browser = await install(browser);
  if (!browser || !await runSmoke(browser)) fail("REPORT_RUNTIME_NOT_READY", "安装后中文PDF自检仍失败，PM2不能重载；请检查系统运行库、字体及浏览器路径。");
  await save(browser); return { reused: false, executablePath: browser };
}

export async function main(appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const fileEnv = existsSync(path.join(appRoot, ".env")) ? parse(readFileSync(path.join(appRoot, ".env"))) : {};
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(appRoot, ".cache/report-browsers") };
  const require = createRequire(path.join(appRoot, "package.json"));
  const cli = path.join(path.dirname(require.resolve("playwright-core/package.json")), "cli.js");
  // 必须先设置固定缓存目录，再加载当前锁文件版本的浏览器注册表。
  process.env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH;
  const { chromium } = await import("playwright-core");
  const executable = value => { try { accessSync(value, constants.X_OK); return true; } catch { return false; } };
  const managedPath = chromium.executablePath();
  const browser = pickBrowser(resolveReportChromium(appRoot, fileEnv), managedPath,
    ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/opt/google/chrome/chrome"], executable);
  const installEnabled = process.argv.includes("--install-report-runtime") || process.env.DEPLOY_REPORT_RUNTIME_INSTALL === "1";
  const release = existsSync("/etc/os-release") ? parse(readFileSync("/etc/os-release")) : {};
  const command = (cmd, args, commandEnv = env, timeout = 600_000) => spawnSync(cmd, args, { cwd: appRoot, env: commandEnv, encoding: "utf8", timeout, maxBuffer: 2 * 1024 * 1024 });
  const mustRun = (cmd, args, commandEnv, errorCode) => {
    const result = command(cmd, args, commandEnv);
    // 原始下载/系统异常可能带私有地址；仅打印步骤和错误码。
    if (result.status !== 0) fail(errorCode, "报告运行依赖安装失败，请检查下载源、系统源和网络；PM2未重载。");
  };
  const smoke = async executablePath => {
    const result = command(process.execPath, [path.join(appRoot, "deploy/report-runtime-smoke.mjs"), executablePath], env, 120_000);
    if (result.status !== 0) {
      const code = (result.stderr || "").match(/"code":"(REPORT_[A-Z_]+)"/)?.[1] || "REPORT_RUNTIME_SMOKE_FAILED";
      console.log(`[报告环境] ${code}`); return false;
    }
    console.log("[报告环境] 中文字体/真实PDF自检通过。"); return true;
  };
  const result = await ensureReportRuntime({ browser, installEnabled, platform: process.platform, arch: process.arch, release, uid: process.getuid?.(), runSmoke: smoke,
    install: async existing => {
      const hosts = downloadHostsFor(process.env);
      const installEnv = { ...env, DEBIAN_FRONTEND: "noninteractive",
        PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: hosts.chromium,
        PLAYWRIGHT_DOWNLOAD_HOST: hosts.other };
      const aptSource = process.env.DEPLOY_REPORT_APT_SOURCE_FILE;
      const temp = await mkdtemp(path.join(os.tmpdir(), "lg-report-runtime-"));
      try {
        if (release.ID === "alinux") {
          if (aptSource) fail("REPORT_APT_SOURCE_INVALID", "Alibaba Cloud Linux使用已有DNF仓库，不能应用APT源配置。");
          const packages = ["nss", "nspr", "atk", "at-spi2-atk", "cups-libs", "libX11", "libXcomposite", "libXdamage", "libXext", "libXfixes", "libXrandr", "libxcb", "libxkbcommon", "mesa-libgbm", "libdrm", "alsa-lib", "pango", "cairo", "gtk3", "dbus-libs", "fontconfig", "google-noto-sans-cjk-ttc-fonts", "ca-certificates"];
          const missing = packages.filter(name => command("rpm", ["-q", name], installEnv, 30_000).status !== 0);
          if (missing.length) {
            console.log(`[报告环境] Alibaba Cloud Linux 3补装缺失运行库：${missing.join("、")}（保留已安装包和现有仓库）。`);
            mustRun("dnf", ["install", "-y", "--setopt=install_weak_deps=False", ...missing], installEnv, "REPORT_SYSTEM_DEPS_INSTALL_FAILED");
          } else console.log("[报告环境] Alibaba Cloud Linux运行库/中文字体已齐备。");
        } else {
        if (aptSource) {
          if (!path.isAbsolute(aptSource) || !existsSync(aptSource)) fail("REPORT_APT_SOURCE_INVALID", "国内系统源文件必须为服务器上已存在的绝对路径。");
          installEnv.APT_CONFIG = path.join(temp, "apt.conf");
          await writeFile(installEnv.APT_CONFIG, `Dir::Etc::sourcelist ${JSON.stringify(aptSource)};\nDir::Etc::sourceparts "-";\n`);
        }
        console.log("[报告环境] 安装系统运行库及中文字体（不覆盖系统软件源）。");
        mustRun("apt-get", ["update"], installEnv, "REPORT_SYSTEM_DEPS_INSTALL_FAILED");
        mustRun("apt-get", ["install", "-y", "--no-install-recommends", "fonts-noto-cjk", "fontconfig", "ca-certificates"], installEnv, "REPORT_SYSTEM_DEPS_INSTALL_FAILED");
        mustRun(process.execPath, [cli, "install-deps", "chromium"], installEnv, "REPORT_SYSTEM_DEPS_INSTALL_FAILED");
        }
        if (!existing) {
          console.log("[报告环境] 从指定镜像安装锁文件匹配的Chromium，缓存供后续部署复用。");
          mustRun(process.execPath, [cli, "install", "chromium", "--no-shell", "--no-progress"], installEnv, "REPORT_BROWSER_DOWNLOAD_FAILED");
        }
        return existing || managedPath;
      } finally { await rm(temp, { recursive: true, force: true }); }
    }, save: async executablePath => {
      const cache = path.join(appRoot, ".cache"); await mkdir(cache, { recursive: true });
      const target = path.join(cache, "report-runtime.json"); const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, executablePath })); await rename(temporary, target);
    } });
  console.log(`[报告环境] ${result.reused ? "复用已有运行环境" : "运行环境安装完成"}；不改写.env。`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(`[报告环境] ${error.code || "REPORT_RUNTIME_CHECK_FAILED"}：${error.code ? error.message : "环境检查失败，未完成部署。"}`); process.exitCode = 1;
});
