import { describe, expect, it } from "vitest";
import { normalizeKeepNewlines, normalizeSearchText } from "./knowledge.normalize.js";

describe("知识检索文本归一化", () => {
  it("全角字符转为半角", () => {
    expect(normalizeSearchText("ＶＩＣＰ　外墙外保温")).toBe("vicp 外墙外保温");
  });

  it("折叠连续空白并去首尾", () => {
    expect(normalizeSearchText("  真空绝热\n\n  复合保温板  ")).toBe("真空绝热 复合保温板");
  });

  it("英文统一小写", () => {
    expect(normalizeSearchText("VICP")).toBe("vicp");
  });

  it("空字符串归一化后仍为空", () => {
    expect(normalizeSearchText("   ")).toBe("");
  });

  it("保留换行的归一化只折叠多余空行", () => {
    expect(normalizeKeepNewlines("甲\n\n\n\n乙")).toBe("甲\n\n乙");
  });
});