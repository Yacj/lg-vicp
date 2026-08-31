import { describe, expect, it, vi } from "vitest";

// document.worker（isNoTextLayer）引用 env，导入前注入测试环境变量
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

import { extractPdfDocumentInWorker } from "./pdf-text-extractor.js";
import { isNoTextLayer } from "./document.worker.js";

/**
 * 真实 PDF fixture 集成测试（Case A / Case B）：
 * - Case A：有文本层 + 书签大纲 → 文本逐页提取 + 书签解析为 TOC 物理页；
 * - Case B：无文本层（转曲/扫描件）→ 提取文本为空，判定 NO_TEXT_LAYER（不是解析失败）。
 */

/** 最小合法 PDF（Catalog/Pages/Page/Content/Font + xref/trailer），可附带 /Outlines 书签大纲 */
function createPdf(
  texts: readonly string[],
  bookmarks: ReadonlyArray<{ title: string; page: number }> = []
): Buffer {
  const pageCount = texts.length;
  const fontId = 3 + pageCount * 2;
  const objects: string[] = [
    bookmarks.length > 0
      ? `<< /Type /Catalog /Pages 2 0 R /Outlines ${3 + pageCount * 2 + 1} 0 R >>`
      : "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${texts.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pageCount} >>`
  ];
  const outlineRootId = 3 + pageCount * 2 + 1;
  const outlineItemIds: number[] = [];
  let nextId = outlineRootId + 1;
  for (let index = 0; index < bookmarks.length; index++) outlineItemIds.push(nextId++);
  for (const [index, text] of texts.entries()) {
    const content = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`
    );
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  // 对象 id 与数组位置一一对应：页面/内容流之后依次是 Font、Outlines 根、书签条目
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  if (bookmarks.length > 0) {
    objects.push(`<< /Type /Outlines /First ${outlineItemIds[0]} 0 R /Last ${outlineItemIds[outlineItemIds.length - 1]} 0 R /Count ${bookmarks.length} >>`);
  }
  for (const [index, bookmark] of bookmarks.entries()) {
    const pageRef = 3 + (bookmark.page - 1) * 2;
    const prev = index > 0 ? ` /Prev ${outlineItemIds[index - 1]} 0 R` : "";
    const next = index < bookmarks.length - 1 ? ` /Next ${outlineItemIds[index + 1]} 0 R` : "";
    objects.push(
      `<< /Title (${bookmark.title}) /Parent ${outlineRootId} 0 R /Dest [${pageRef} 0 R /XYZ null null null]${prev}${next} >>`
    );
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

describe("Case A：有文本层 PDF（文本提取 + 书签大纲解析为 TOC 物理页）", () => {
  it("逐页提取文本并解析书签大纲的物理页定位", async () => {
    const pdf = createPdf(["General Description A1", "Thermal Table Page 21"], [
      { title: "General Description", page: 1 },
      { title: "Thermal Table", page: 2 }
    ]);
    const result = await extractPdfDocumentInWorker(pdf);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]).toContain("General Description A1");
    expect(result.pages[1]).toContain("Thermal Table Page 21");
    // 书签大纲：title + level + 解析出的物理页序号（1-based）
    expect(result.outline).toEqual([
      { title: "General Description", level: 1, pageNumber: 1 },
      { title: "Thermal Table", level: 1, pageNumber: 2 }
    ]);
    // isNoTextLayer：有文本层 → false
    const total = result.pages.reduce((sum, text) => sum + text.trim().length, 0);
    expect(isNoTextLayer(total)).toBe(false);
  });

  it("无书签 PDF 返回空大纲", async () => {
    const result = await extractPdfDocumentInWorker(createPdf(["plain page"]));
    expect(result.outline).toEqual([]);
  });
});

describe("Case B：转曲/扫描 PDF（无文本层）", () => {
  it("全部页面提取文本为空 → 判定 NO_TEXT_LAYER（不是解析失败）", async () => {
    // 转曲件：内容流只有绘图指令没有文本对象
    const pdf = createPdf(["", "", ""]);
    const result = await extractPdfDocumentInWorker(pdf);
    expect(result.pages).toHaveLength(3);
    expect(result.pages.every((text) => text.trim().length === 0)).toBe(true);
    const total = result.pages.reduce((sum, text) => sum + text.trim().length, 0);
    // 语义：NO_TEXT_LAYER 是文件特性，进入"绑定检索源/浏览版"链路，不是 OCR_REQUIRED/FAILED
    expect(isNoTextLayer(total)).toBe(true);
  });

  it("文本层阈值：短文本（低于阈值）同样判缺文本层，长文本不误判", () => {
    expect(isNoTextLayer(0)).toBe(true);
    expect(isNoTextLayer(19)).toBe(true);
    expect(isNoTextLayer(20)).toBe(false);
    expect(isNoTextLayer(2000)).toBe(false);
  });
});
