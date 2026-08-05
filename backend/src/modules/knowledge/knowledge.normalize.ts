/**
 * 知识库文本归一化纯函数。
 * 检索与分块共用：全角转半角、空白折叠、统一大小写，保证"同一文本不同写法"可稳定匹配。
 */

/** NFKC 归一化 + 空白折叠 + 小写化。中文不受小写化影响。 */
export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 归一化并保留换行（用于页面原文比较时忽略空白差异，暂未使用，预留） */
export function normalizeKeepNewlines(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .toLowerCase();
}