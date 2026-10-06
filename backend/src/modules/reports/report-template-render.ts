import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";
import type { ReportTemplateSection } from "../../db/schema.js";

/**
 * 模板报告确定性渲染器（纯函数，无 AI、无数据库访问）：
 * - 渲染源为报告快照 dataJson（章节数据在生成时点已冻结，历史不随后台参数漂移）；
 * - 章节按模板 sections 配置的 enabled + order 输出；DATA 章节渲染快照数据，TEXT 章节渲染配置文案；
 * - 缺失数据不吞错：章节显式标注"待补充"，绝不编造数值。
 * - HTML / PDF / Word 都只读同一份 dataJson.referencePages，禁止回读聊天或重算匹配。
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

/** Word 内嵌参考页最大宽度（EMU 换算前的像素近似） */
const WORD_IMAGE_MAX_WIDTH = 520;

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

function formatParamBar(highlights: unknown): string {
  if (!Array.isArray(highlights) || highlights.length === 0) return "";
  return highlights.map((highlight) => {
    if (!highlight || typeof highlight !== "object") return "";
    const row = highlight as Record<string, unknown>;
    const label = String(row.label ?? row.field ?? "");
    const value = String(row.value ?? "");
    if (!label && !value) return "";
    return `${label} = ${value}`.trim();
  }).filter(Boolean).join(" | ");
}

function referencePageTitle(page: Record<string, unknown>): string {
  const summary = page.summary && typeof page.summary === "object"
    ? page.summary as Record<string, unknown>
    : {};
  return String(
    summary.constructionCode
    ?? summary.productSpecName
    ?? summary.productName
    ?? summary.systemType
    ?? "参考方案"
  );
}

function referencePageMeta(page: Record<string, unknown>): string {
  const title = typeof page.documentTitle === "string" ? page.documentTitle : "";
  const pageLabel = typeof page.pageLabel === "string" && page.pageLabel
    ? page.pageLabel
    : page.pageNumber != null
      ? String(page.pageNumber)
      : page.physicalPageNumber != null
        ? String(page.physicalPageNumber)
        : "";
  if (title && pageLabel) return `${title} · 第 ${pageLabel} 页`;
  if (title) return title;
  if (pageLabel) return `第 ${pageLabel} 页`;
  return "";
}

function referenceMatchGroups(page: Record<string, unknown>): Array<{ title: string; bar: string }> {
  const matches = Array.isArray(page.matches) ? page.matches : [];
  if (matches.length > 0) {
    return matches.map((match) => {
      if (!match || typeof match !== "object") return { title: "参考方案", bar: "" };
      const row = match as Record<string, unknown>;
      const summary = row.summary && typeof row.summary === "object"
        ? row.summary as Record<string, unknown>
        : {};
      return {
        title: String(summary.constructionCode ?? summary.productSpecName ?? summary.productName ?? "参考方案"),
        bar: formatParamBar(row.highlights)
      };
    }).filter((item) => item.bar || item.title);
  }
  return [{ title: referencePageTitle(page), bar: formatParamBar(page.highlights) }];
}

/** 参考页参数条和完整页图。没有图片时只输出参数条。优先 matches，兼容扁平 highlights。 */
export function renderReferencePagesHtml(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  return value.map((item) => {
    if (!item || typeof item !== "object") return "";
    const page = item as Record<string, unknown>;
    const groups = referenceMatchGroups(page);
    const groupHtml = groups.map((group) =>
      `<h2>${escapeHtml(group.title)}</h2>${group.bar ? `<p class="param-bar">${escapeHtml(group.bar)}</p>` : ""}`
    ).join("");
    const image = typeof page.imageDataUrl === "string" && page.imageDataUrl
      ? `<img class="reference-page" src="${escapeHtml(page.imageDataUrl)}" alt="完整参考页" />`
      : "";
    const meta = referencePageMeta(page);
    return `<section>${groupHtml}${image}${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ""}</section>`;
  }).join("");
}

export async function embedReferencePageImages(
  pages: unknown,
  loadObject: (objectKey: string) => Promise<Buffer | null>
): Promise<unknown[]> {
  if (!Array.isArray(pages)) return [];
  return Promise.all(pages.map(async (item) => {
    if (!item || typeof item !== "object") return item;
    const page = item as Record<string, unknown>;
    const objectKey = typeof page.pageImageObjectKey === "string" ? page.pageImageObjectKey : "";
    if (!objectKey) return page;
    const bytes = await loadObject(objectKey);
    if (!bytes) return page;
    const mime = objectKey.endsWith(".jpg") || objectKey.endsWith(".jpeg") ? "image/jpeg" : "image/png";
    return {
      ...page,
      imageBytes: bytes,
      imageMime: mime,
      imageDataUrl: `data:${mime};base64,${bytes.toString("base64")}`
    };
  }));
}

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1]!, bytes: Buffer.from(match[2]!, "base64") };
}

function readPngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJpegSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + length;
  }
  return null;
}

function fitImageSize(bytes: Buffer, mime: string): { width: number; height: number; type: "png" | "jpg" } {
  const isJpeg = mime === "image/jpeg" || mime === "image/jpg";
  const size = isJpeg ? readJpegSize(bytes) : readPngSize(bytes);
  const width = size?.width && size.width > 0 ? size.width : WORD_IMAGE_MAX_WIDTH;
  const height = size?.height && size.height > 0 ? size.height : Math.round(WORD_IMAGE_MAX_WIDTH * 1.4);
  const scale = Math.min(1, WORD_IMAGE_MAX_WIDTH / width);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    type: isJpeg ? "jpg" : "png"
  };
}

function resolveReferenceImage(page: Record<string, unknown>): { bytes: Buffer; mime: string } | null {
  if (Buffer.isBuffer(page.imageBytes)) {
    return {
      bytes: page.imageBytes,
      mime: typeof page.imageMime === "string" ? page.imageMime : "image/png"
    };
  }
  if (typeof page.imageDataUrl === "string" && page.imageDataUrl) {
    return decodeDataUrl(page.imageDataUrl);
  }
  return null;
}

/** 模板报告 -> HTML 文档（Worker 渲染与 PDF/IMAGE 共用） */
export function renderTemplateHtml(payload: ReportSnapshotPayload): string {
  const sections = (payload.template?.sections ?? [])
    .filter((section) => section.enabled)
    .sort((a, b) => a.order - b.order);
  const referenceHtml = renderReferencePagesHtml(payload.referencePages);
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
  .param-bar{font-weight:700;color:#176b57;margin:8px 0}
  img.reference-page{max-width:100%;height:auto;border:1px solid #e5e7eb}
  </style></head><body>${header}<h1>${escapeHtml(title)}</h1>${meta}${body}${referenceHtml}
  <footer>${escapeHtml(footer)}</footer></body></html>`;
}

function renderReferencePagesWord(value: unknown): Paragraph[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const paragraphs: Paragraph[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const page = item as Record<string, unknown>;
    for (const group of referenceMatchGroups(page)) {
      paragraphs.push(new Paragraph({ text: group.title, heading: HeadingLevel.HEADING_1 }));
      if (group.bar) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: group.bar, bold: true, color: "176B57", size: 22 })]
        }));
      }
    }
    const image = resolveReferenceImage(page);
    if (image) {
      const fitted = fitImageSize(image.bytes, image.mime);
      paragraphs.push(new Paragraph({
        children: [new ImageRun({
          type: fitted.type,
          data: image.bytes,
          transformation: { width: fitted.width, height: fitted.height },
          altText: { title: "完整参考页", description: "报告快照中的完整参考页图片", name: "reference-page" }
        })]
      }));
    }
    const meta = referencePageMeta(page);
    if (meta) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: meta, size: 18, color: "6B7280" })]
      }));
    }
  }
  return paragraphs;
}

/** 模板报告 -> Word 文档（与 HTML/PDF 同源 dataJson.referencePages） */
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
    ...renderReferencePagesWord(payload.referencePages),
    new Paragraph({ text: footer })
  ];
  return Packer.toBuffer(new Document({ sections: [{ children: paragraphs }] }));
}
