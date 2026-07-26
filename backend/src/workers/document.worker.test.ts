import { describe, expect, it } from "vitest";
import { splitText } from "./document.worker.js";

describe("知识文本切片", () => {
  it("保留全部文本并限制单片长度", () => {
    const source = Array.from({ length: 40 }, (_, index) => `第${index + 1}条建筑节能资料。`).join("\n");
    const chunks = splitText(source, 120, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
    expect(chunks[0]).toContain("第1条建筑节能资料");
    expect(chunks.at(-1)).toContain("第40条建筑节能资料");
  });

  it("空白文本不生成切片", () => {
    expect(splitText("  \n\n  ")).toEqual([]);
  });
});
