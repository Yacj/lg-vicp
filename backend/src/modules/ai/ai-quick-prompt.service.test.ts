import { describe, expect, it } from "vitest";
import { sortClientQuickPrompts, toClientQuickPrompt } from "./ai-quick-prompt.service.js";

describe("快捷提问客户端投影", () => {
  it("不返回管理字段", () => {
    const item = toClientQuickPrompt({
      id: "qp_001",
      title: "查询图集",
      description: "查询图集章节、构造和节点做法",
      content: "请根据当前已发布的知识资料，帮助我查询与问题相关的图集内容，并给出对应章节、页码和原文来源。",
      icon: "book",
      position: "AI_HOME"
    });
    expect(item).toEqual({
      id: "qp_001",
      title: "查询图集",
      description: "查询图集章节、构造和节点做法",
      content: "请根据当前已发布的知识资料，帮助我查询与问题相关的图集内容，并给出对应章节、页码和原文来源。",
      icon: "book",
      position: "AI_HOME"
    });
    expect(item).not.toHaveProperty("createdById");
    expect(item).not.toHaveProperty("actionType");
    expect(item).not.toHaveProperty("enabled");
  });

  it("按 sortOrder ASC，相同时按创建时间", () => {
    const sorted = sortClientQuickPrompts([
      { sortOrder: 30, createdAt: new Date("2026-01-01"), title: "C" },
      { sortOrder: 10, createdAt: new Date("2026-01-03"), title: "A" },
      { sortOrder: 10, createdAt: new Date("2026-01-02"), title: "B" }
    ]);
    expect(sorted.map((item) => item.title)).toEqual(["B", "A", "C"]);
  });
});
