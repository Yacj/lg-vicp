"use strict";
const fs = require("node:fs");
const path = require("node:path");

/** 与部署检查共用路径优先级：显式.env > 进程配置 > 经PDF自检的持久记录。 */
function resolveReportChromium(appRoot, fileEnv = {}, processEnv = process.env) {
  const clean = value => typeof value === "string" ? value.trim().replace(/^(["'])(.*)\1$/, "$2") : "";
  const explicit = clean(fileEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) || clean(processEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
  if (explicit) return { executablePath: explicit, explicit: true };
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(appRoot, ".cache/report-runtime.json"), "utf8"));
    if (saved.schemaVersion === 1 && typeof saved.executablePath === "string") return { executablePath: saved.executablePath, explicit: false };
  } catch { /* 首次部署或记录不可用，检查程序继续查找浏览器。 */ }
  return { executablePath: "", explicit: false };
}
module.exports = { resolveReportChromium };
