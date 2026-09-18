#!/usr/bin/env node
// ============================================================
// 蓝格 VICP 后端一键部署（本地执行，Windows/Linux/macOS）
//
// 流程：本地 pnpm build -> 打包 dist/drizzle/锁文件
//       -> SSH 上传（支持密码）-> 服务器解压（不覆盖 .env）
//       -> 迁移前备份库 -> drizzle migrate -> PM2 重载
//
// 不走 git，不上传本地 .env，不在服务器执行 tsc。
//
// 配置文件：deploy/.env.deploy（不入库；未创建时回落 backend/.env 的 DEPLOY_*）
// ============================================================
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ssh2 from "ssh2";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ENV_PATH = path.join(__dirname, ".env.deploy");
const ENV_PATH = path.join(BACKEND_ROOT, ".env");
const isWin = process.platform === "win32";

const fail = (msg) => {
  console.error(`[失败] ${msg}`);
  process.exit(1);
};
const info = (msg) => console.log(`[部署] ${msg}`);

const Client = ssh2.Client ?? ssh2.default?.Client;
if (!Client) fail("无法加载 ssh2.Client，请在 backend 目录执行 pnpm install");

const bashQuote = (value) => `'${String(value).replace(/'/g, `'\"'\"'`)}'`;

const unquote = (value) => {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

const readEnvFile = (filePath) => {
  if (!existsSync(filePath)) return null;
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), unquote(line.slice(i + 1).trim())];
      })
  );
};

let env = readEnvFile(DEPLOY_ENV_PATH);
let envSource = DEPLOY_ENV_PATH;
if (env === null) {
  if (!existsSync(ENV_PATH)) {
    fail(`未找到 ${DEPLOY_ENV_PATH}，请复制 deploy/.env.deploy.example 为 deploy/.env.deploy 并填写`);
  }
  env = readEnvFile(ENV_PATH);
  envSource = ENV_PATH;
}
info(`读取部署配置：${envSource}`);

const host = env.DEPLOY_SSH_HOST;
if (!host) fail("缺少 DEPLOY_SSH_HOST（服务器 IP 或域名）");
const sshUser = env.DEPLOY_SSH_USER || "root";
const sshPort = Number(env.DEPLOY_SSH_PORT || "22");
const remoteDir = env.DEPLOY_REMOTE_DIR || "/www/wwwroot/lgapi.zblack.cn";
const password = env.DEPLOY_SSH_PASSWORD || "";
const defaultKeyPath = path.join(os.homedir(), ".ssh", "id_rsa");
const keyPath = env.DEPLOY_SSH_KEY || (!password && existsSync(defaultKeyPath) ? defaultKeyPath : "");
if (!password && !keyPath) {
  fail("请在 deploy/.env.deploy 填写 DEPLOY_SSH_PASSWORD，或 DEPLOY_SSH_KEY（私钥路径）；也可配置本机 ~/.ssh/id_rsa 免密登录");
}
if (keyPath && !existsSync(keyPath)) fail(`找不到私钥文件：${keyPath}`);
if (keyPath && !password) info(`使用 SSH 私钥：${keyPath}`);

const PACK_ENTRIES = [
  "dist",
  "drizzle",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "deploy/ecosystem.config.cjs",
  "deploy/remote-apply.sh",
  ".env.example"
];

const runLocal = (command, args, useShell = isWin) => {
  const result = spawnSync(command, args, {
    cwd: BACKEND_ROOT,
    stdio: "inherit",
    shell: useShell
  });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} 失败`);
};

info("本地构建 dist（服务器不再执行 tsc）...");
runLocal("pnpm", ["build"]);
for (const entry of PACK_ENTRIES) {
  if (!existsSync(path.join(BACKEND_ROOT, entry))) fail(`打包缺少 ${entry}，请确认构建成功`);
}

const archivePath = path.join(BACKEND_ROOT, ".deploy-release.tgz");
info("打包发布物（不含 .env / node_modules / src）...");
runLocal("tar", ["-czf", ".deploy-release.tgz", ...PACK_ENTRIES], false);
const archiveMb = (statSync(archivePath).size / (1024 * 1024)).toFixed(1);
info(`包大小 ${archiveMb} MB -> 上传到 ${sshUser}@${host}:${remoteDir}`);

const connectSsh = () =>
  new Promise((resolve, reject) => {
    const conn = new Client();
    const opts = {
      host,
      port: sshPort,
      username: sshUser,
      readyTimeout: 30000,
      keepaliveInterval: 15000,
      tryKeyboard: Boolean(password)
    };
    if (password) opts.password = password;
    if (keyPath) opts.privateKey = readFileSync(keyPath);
    conn.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => password));
    });
    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect(opts);
  });

const execRemote = (conn, command) =>
  new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      stream.on("data", (chunk) => {
        process.stdout.write(chunk);
        stdout += chunk.toString();
      });
      stream.stderr.on("data", (chunk) => process.stderr.write(chunk));
      stream.on("close", (code) => {
        if (code === 0 || code === 10) resolve({ code, stdout });
        else reject(new Error(`远程命令退出码 ${code}`));
      });
    });
  });

const uploadFile = (conn, localPath, remotePath) =>
  new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const write = sftp.createWriteStream(remotePath);
      write.on("close", resolve);
      write.on("error", reject);
      createReadStream(localPath).pipe(write);
    });
  });

const remoteTar = "/tmp/lg-vicp-backend-release.tgz";
const quotedDir = bashQuote(remoteDir);
const applyCmd = [
  "set -euo pipefail",
  `mkdir -p ${quotedDir} ${quotedDir}/.bak ${quotedDir}/logs`,
  `if [ -d ${quotedDir}/dist ]; then rm -rf ${quotedDir}/.bak/dist; cp -a ${quotedDir}/dist ${quotedDir}/.bak/dist; fi`,
  `tar -xzf ${bashQuote(remoteTar)} -C ${quotedDir}`,
  `sed -i 's/\\r$//' ${quotedDir}/deploy/remote-apply.sh`,
  `cd ${quotedDir}`,
  "bash deploy/remote-apply.sh"
].join("\n");

let conn;
try {
  info(`SSH 连接 ${sshUser}@${host}:${sshPort} ...`);
  conn = await connectSsh();
  info("上传发布包...");
  await execRemote(conn, "mkdir -p /tmp");
  await uploadFile(conn, archivePath, remoteTar);
  info("服务器解压并落地（保留 .env，先迁移再重载 PM2）...");
  const result = await execRemote(conn, `bash -lc ${bashQuote(applyCmd)}`);
  if (result.code === 10) {
    console.warn("\n[警告] 服务器已生成 .env 模板，请先登录填写 DATABASE_URL 等后再执行 pnpm deploy。");
    process.exit(0);
  }
  if (!result.stdout.includes("部署完成，服务已就绪")) {
    console.warn("\n[警告] 未检测到“部署完成”标记，请查看上方远程日志。");
  } else {
    info(`部署完成。本机反代请指向服务器 3000 端口，健康检查：http://<服务器>/health/live`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  if (conn) conn.end();
  try {
    unlinkSync(archivePath);
  } catch {
    // ignore
  }
}
