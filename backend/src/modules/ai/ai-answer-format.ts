/**
 * 用户可见正文的非语义 formatter。
 * 只做 trim / 空行 / NUL / 悬空标记 / 相邻完全重复行。
 * 禁止用正则删除有语义的整句话。
 */

const DANGLING_MARKDOWN_LINE = /^(?:\*\*|#{1,6}|[-*]|_+|`+)$/;
const DUPLICATE_SENTENCE = /([^。！？\n]{8,}[。！？])\1+/g;

function stripUnbalancedEmphasis(text: string): string {
  const marks = text.match(/\*\*/g)?.length ?? 0;
  if (marks % 2 === 0) return text;
  const last = text.lastIndexOf("**");
  if (last < 0) return text;
  return `${text.slice(0, last)}${text.slice(last + 2)}`;
}

function stripLeadingFragment(text: string): string {
  const firstBreak = text.search(/[。！？\n]/);
  const head = firstBreak >= 0 ? text.slice(0, firstBreak) : text;
  if (head.length <= 12 && /\*\*/.test(head) && !/^\*\*[^*].*\*\*/.test(head.trim())) {
    const rest = firstBreak >= 0 ? text.slice(firstBreak + 1) : "";
    return rest.trim();
  }
  return text;
}

export function formatUserVisibleAnswer(text: string): string {
  let value = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (!value) return "";

  value = value.replace(/\n{3,}/g, "\n\n");
  value = stripLeadingFragment(value);

  const lines = value.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (DANGLING_MARKDOWN_LINE.test(trimmed)) continue;
    const previous = kept[kept.length - 1]?.trim() ?? "";
    if (trimmed && previous === trimmed) continue;
    kept.push(line.replace(/[ \t]+$/g, ""));
  }
  value = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  value = value.replace(/([^\n]+)(?:\n{2,}\1)+/g, "$1");
  value = value.replace(DUPLICATE_SENTENCE, "$1");
  value = stripUnbalancedEmphasis(value);
  value = value.replace(/(^|\n)(?![-*] |\d+\. )([^\n]+)\n([-*] |\d+\. )/g, "$1$2\n\n$3");
  value = value.replace(/([。！？]){2,}/g, "$1");
  value = value.replace(/，{2,}/g, "，");
  return value.trim();
}
