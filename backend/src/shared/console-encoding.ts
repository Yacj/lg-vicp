import { execFileSync } from "node:child_process";

export function configureConsoleEncoding() {
  if (process.platform !== "win32") return;

  try {
    execFileSync("cmd.exe", ["/d", "/s", "/c", "chcp 65001>nul"], {
      stdio: "inherit"
    });
  } catch {
    // 某些非交互式 Windows 进程没有控制台，保持默认输出即可。
  }
}