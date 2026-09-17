"use strict";

const fs = require("node:fs");
const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "..");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return out;
}

const fileEnv = loadDotEnv(path.join(APP_ROOT, ".env"));
const parsedHeap = Number(fileEnv.WORKER_MAX_OLD_SPACE_MB || process.env.WORKER_MAX_OLD_SPACE_MB || 768);
const workerHeapMb = Number.isFinite(parsedHeap) && parsedHeap > 0 ? parsedHeap : 768;

module.exports = {
  apps: [
    {
      name: "lg-vicp-api",
      cwd: APP_ROOT,
      script: "dist/server.js",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      min_uptime: 10000,
      exp_backoff_restart_delay: 200,
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 10000,
      max_memory_restart: "800M",
      env: {
        NODE_ENV: "production"
      },
      error_file: path.join(APP_ROOT, "logs/pm2-api-error.log"),
      out_file: path.join(APP_ROOT, "logs/pm2-api-out.log"),
      merge_logs: true,
      time: true
    },
    {
      name: "lg-vicp-worker",
      cwd: APP_ROOT,
      script: "dist/worker.js",
      interpreter: "node",
      node_args: `--max-old-space-size=${workerHeapMb}`,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      min_uptime: 10000,
      exp_backoff_restart_delay: 200,
      // 与 docker-compose worker.stop_grace_period 对齐，等待 PDF 解析等长任务自行结束
      kill_timeout: 21 * 60 * 1000,
      max_memory_restart: "1500M",
      env: {
        NODE_ENV: "production"
      },
      error_file: path.join(APP_ROOT, "logs/pm2-worker-error.log"),
      out_file: path.join(APP_ROOT, "logs/pm2-worker-out.log"),
      merge_logs: true,
      time: true
    }
  ]
};
