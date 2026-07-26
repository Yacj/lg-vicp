import { rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const repository = resolve(process.cwd());
const target = resolve(repository, "dist");

if (dirname(target) !== repository || basename(target) !== "dist") {
  throw new Error("构建目录路径校验失败，已停止清理");
}

rmSync(target, { recursive: true, force: true });
