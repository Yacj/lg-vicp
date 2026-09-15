import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { ReportTemplateSection } from "../../db/schema.js";

/**
 * 模板报告确定性渲染器（纯函数，无 AI、无数据库访问）：
 * - 渲染源为报告快照 dataJson（章节数据在生成时点已冻结，历史不随后台参数漂移）；
 * - 章节按模板 sections 配置的 enabled + order 输出；DATA 章节渲染快照数据，TEXT 章节渲染配置文案；
 * - 缺失数据不吞错：章节显式标注"待补充"，绝不编造数值。
 */

export interface ReportSnapshotPayload {
  title?: string;
  generatedAt?: string;
  asOfDate?: string;
  template?: {
    name?: string;
    sections?: ReportTemplateSection[];
  };
  settings?: {
    coverTitle?: string | null;
    headerText?: string | null;
    footerText?: string | null;
    showDisclaimer?: boolean;
  };
  disclaimerText?: string | null;
  [key: string]: unknown;
}

/** 缺失数据标注（渲染层不吞错） */
export const MISSING_MARK = "本章节数据待补充（无已发布来源）";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!);
}

/** 空值判断：null/undefined/空串/空数组/空对象 */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

/** 标量渲染（对象 -> 键值行，数组 -> 编号行） */
export function flattenValue(value: unknown, depth = 0): string {
  if (isEmptyValue(value)) return MISSING_MARK;
  const indent = "  ".repeat(depth);
  if (Array.isArray(value)) {
    return value.map((item, index) => `${indent}${index + 1}. ${flattenValue(item, depth + 1)}`).join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${indent}${key}：${flattenValue(item, depth + 1)}`)
      .join("\n");
  }
  return `${indent}${String(value)}`;
}

/** 对象数组 -> HTML 表格（列取首次出现的键顺序），空列跳过 */
function renderTableHtml(rows: Array<Record<string, unknown>>): string {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key) && !isEmptyValue(row[key])) columns.push(key);
    }
  }
  if (columns.length === 0) return `<p class="missing">${MISSING_MARK}</p>`;
  const header = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const body = rows.map((row) =>
    `<tr>${columns.map((column) => `<td>${escapeHtml(flattenValue(row[column]))}</td>`).join("")}</tr>`
  ).join("");
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

/** DATA 章节值 -> HTML */
function renderSectionHtml(value: unknown): string {
  if (isEmptyValue(value)) return `<p class="missing">${MISSING_MARK}</p>`;
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "object" && item !== null)) {
      return renderTableHtml(value as Array<Record<string, unknown>>);
    }
    return `<ul>${value.map((item) => `<li>${escapeHtml(flattenValue(item))}</li>`).join("")}</ul>`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => !isEmptyValue(item));
    if (entries.length === 0) return `<p class="missing">${MISSING_MARK}</p>`;
    return `<dl>${entries.map(([key, item]) =>
      `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(flattenValue(item))}</dd>`
    ).join("")}</dl>`;
  }
  return `<p>${escapeHtml(String(value))}</p>`;
}

/** 模板报告 -> HTML 文档（Worker 渲染与 PDF/IMAGE 共用） */
export function renderTemplateHtml(payload: ReportSnapshotPayload): string {
  const sections = (payload.template?.sections ?? [])
    .filter((section) => section.enabled)
    .sort((a, b) => a.order - b.order);
  const body = sections.map((section) => {
    if (section.sourceType === "TEXT") {
      return `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.content ?? "")}</p></section>`;
    }
    return `<section><h2>${escapeHtml(section.title)}</h2>${renderSectionHtml(payload[section.key])}</section>`;
  }).join("");
  const meta = payload.generatedAt || payload.asOfDate
    ? `<p class="meta">数据生效时点：${escapeHtml(payload.asOfDate ?? "")}；报告生成时间：${escapeHtml(payload.generatedAt ?? "")}</p>`
    : "";
  const header = payload.settings?.headerText?.trim()
    ? `<p class="header">${escapeHtml(payload.settings.headerText.trim())}</p>`
    : "";
  const title = payload.settings?.coverTitle?.trim() || payload.title || "VICP 项目报告";
  const footer = payload.settings?.footerText?.trim()
    || "本报告由蓝格 VICP 建筑节能 AI 智配系统生成，需经专业审核后方可作为正式技术文件使用。";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  body{font-family:"Microsoft YaHei",sans-serif;color:#1f2937;margin:48px;line-height:1.7}
  h1{font-size:28px;border-bottom:2px solid #176b57;padding-bottom:12px}
  h2{font-size:20px;margin-top:28px}
  p,li{font-size:14px}
  table{border-collapse:collapse;width:100%;margin:8px 0}
  th,td{border:1px solid #d1d5db;padding:6px 10px;font-size:13px;text-align:left}
  th{background:#f3f4f6}
  dl{font-size:14px}dt{font-weight:600;margin-top:8px}dd{margin-left:16px}
  .missing{color:#b45309}
  .meta,.header{color:#6b7280;font-size:12px}
  footer{margin-top:48px;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb;padding-top:12px}
  </style></head><body>${header}<h1>${escapeHtml(title)}</h1>${meta}${body}
  <footer>${escapeHtml(footer)}</footer></body></html>`;
}

/** 模板报告 -> Word 文档 */
export async function renderTemplateWord(payload: ReportSnapshotPayload): Promise<Buffer> {
  const sections = (payload.template?.sections ?? [])
    .filter((section) => section.enabled)
    .sort((a, b) => a.order - b.order);
  const footer = payload.settings?.footerText?.trim()
    || "本报告由蓝格 VICP 建筑节能 AI 智配系统生成，需经专业审核后方可作为正式技术文件使用。";
  const paragraphs = [
    ...(payload.settings?.headerText?.trim()
      ? [new Paragraph({ children: [new TextRun({ text: payload.settings.headerText.trim(), size: 20 })] })]
      : []),
    new Paragraph({ text: payload.settings?.coverTitle?.trim() || payload.title || "VICP 项目报告", heading: HeadingLevel.TITLE }),
    ...sections.flatMap((section) => [
      new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        children: [new TextRun(
          section.sourceType === "TEXT"
            ? (section.content ?? MISSING_MARK)
            : flattenValue(payload[section.key])
        )]
      })
    ]),
    new Paragraph({ text: footer })
  ];
  return Packer.toBuffer(new Document({ sections: [{ children: paragraphs }] }));
}