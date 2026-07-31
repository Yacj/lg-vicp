#!/usr/bin/env node
// ============================================================
// 蓝格 VICP 后端一键部署（本地执行，跨平台：Windows/Linux/macOS）
//
// 流程：提交并推送 backend/ 改动
//       -> SSH 登录服务器执行 deploy/deploy.sh（pull + compose up --build + 健康检查）
//
// 说明：类型检查与单元测试不在此链路内。类型错误由服务器 Dockerfile 构建时的
//       tsc 编译兜底（构建失败即部署中止，不会上线坏代码）；
//       回归测试建议由 CI 承担。
//
// 配置（backend/.env，已加入 .gitignore 不会随代码上传）：
//   DEPLOY_SSH_HOST     服务器 IP 或域名（必填）
//   DEPLOY_SSH_USER     登录用户，默认 root
//   DEPLOY_SSH_PORT     SSH 端口，默认 22
//   DEPLOY_REMOTE_DIR   服务器上仓库目录，默认 /opt/lg-vicp
//
// 用法：pnpm deploy
// ============================================================
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(BACKEND_ROOT, ".env");

const fail = (msg) => {
  console.error(`[失败] ${msg}`);
  process.exit(1);
};
const info = (msg) => console.log(`[部署] ${msg}`);

// ---------- 1. 读取部署配置 ----------
if (!existsSync(ENV_PATH)) fail(`未找到 ${ENV_PATH}，请先复制 .env.example 为 .env 并配置`);
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

const host = env.DEPLOY_SSH_HOST;
if (!host) fail("缺少 DEPLOY_SSH_HOST（服务器 IP 或域名），请写入 backend/.env");
const sshUser = env.DEPLOY_SSH_USER || "root";
const sshPort = env.DEPLOY_SSH_PORT || "22";
const remoteDir = env.DEPLOY_REMOTE_DIR || "/opt/lg-vicp";

// ---------- 2. 提交并推送 backend/ 改动 ----------
// 仓库根在 backend/ 的上级（monorepo），只提交 backend/ 目录，不波及 app/admin-web
const git = (args, opts = {}) => {
  const r = spawnSync("git", args, { cwd: BACKEND_ROOT, encoding: "utf8", ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    fail(`git ${args.join(" ")} 执行失败：${r.stderr || r.stdout}`);
  }
  return r;
};

const repoRoot = git(["rev-parse", "--show-toplevel"]).stdout.trim();
// 仓库根是 monorepo 上级目录，用绝对路径限定只提交 backend/，不波及 app/admin-web
const backendPath = path.join(repoRoot, "backend");
git(["add", "--", backendPath]);
// 注意：diff --cached --quiet 退出码 1 表示“暂存区有差异”（正常语义），
// 不能用 git() 的默认失败处理，须 allowFail 后自行判断；
// 路径限定 backend/，避免暂存区其他目录的改动误判
const hasStaged = git(["diff", "--cached", "--quiet", "--", backendPath], { allowFail: true }).status !== 0;
const currentBranch = git(["branch", "--show-current"]).stdout.trim() || "main";

if (hasStaged) {
  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
  const msg = `chore(backend): deploy ${ts}`;
  info(`自动提交：${msg}`);
  // pathspec 限定只提交 backend/，暂存区其他内容（app/admin-web 等）保持原状
  git(["commit", "-m", msg, "--", backendPath]);
} else {
  info("backend/ 无改动，跳过提交");
}
info(`推送 ${currentBranch} 到 origin...`);
git(["push", "origin", currentBranch]);

// ---------- 3. SSH 远程部署 ----------
const remoteCmd = `cd ${remoteDir} && bash deploy/deploy.sh`;
info(`SSH ${sshUser}@${host}:${sshPort} 执行远程部署...`);
info(`命令：${remoteCmd}`);

// 实时透传服务器输出，同时收集内容用于检测部署结果
// accept-new：首次连接自动记录主机指纹，避免部署流程在确认提示处卡住
const ssh = spawn("ssh", ["-T", "-o", "StrictHostKeyChecking=accept-new", "-p", sshPort, `${sshUser}@${host}`, remoteCmd], { stdio: ["inherit", "pipe", "inherit"] });
let sshOutput = "";
ssh.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  sshOutput += chunk.toString();
});

const sshExit = await new Promise((resolve) => ssh.on("close", (code) => resolve(code)));
if (sshExit !== 0) {
  fail("远程部署失败，请检查服务器日志（docker compose logs -f）");
}

// 首次部署时服务器 .env 未初始化，deploy.sh 会提示后退出（exit 0），此处检测成功标记
if (!sshOutput.includes("部署完成，服务已就绪")) {
  console.warn(
    "\n[警告] 未检测到“部署完成”标记。若服务器是首次部署，请登录服务器完成 .env 初始化：\n" +
      `  ssh ${sshUser}@${host}\n  cd ${remoteDir} && bash deploy/deploy.sh\n` +
      "初始化完成后，下次直接 pnpm deploy 即可一键更新。"
  );
} else {
  info("部署完成：http://<服务器IP>:8080（管理员密码请用后台“用户管理 -> 重置密码”修改）");
}