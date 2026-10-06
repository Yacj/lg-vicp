import { describe, expect, it } from "vitest";
import { isPageRenderingComplete } from "../shared/docx-render-errors.js";

describe("DOCX 页面渲染完整成功判定", () => {
  it("92 页全部成功 → pageRenderingComplete", () => {
    expect(isPageRenderingComplete({
      pageCount: 92,
      previewRendered: 92,
      previewFailed: 0
    })).toBe(true);
  });

  it("91 成功 1 失败 → 非完整成功（文本仍可 READY）", () => {
    expect(isPageRenderingComplete({
      pageCount: 92,
      previewRendered: 91,
      previewFailed: 1
    })).toBe(false);
  });

  it("全部失败 → 非完整成功", () => {
    expect(isPageRenderingComplete({
      pageCount: 92,
      previewRendered: 0,
      previewFailed: 92
    })).toBe(false);
  });

  it("pageCount=0 → 非完整成功", () => {
    expect(isPageRenderingComplete({
      pageCount: 0,
      previewRendered: 0,
      previewFailed: 0
    })).toBe(false);
  });
});
