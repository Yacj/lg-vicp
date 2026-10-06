import { describe, expect, it } from "vitest";
import { sortClientQuickPrompts, toClientQuickPrompt } from "./ai-quick-prompt.service.js";
import {
  DEFAULT_QUICK_PROMPTS,
  isLegacySystemWordingQuickPrompt,
  LEGACY_QUICK_PROMPT_CONTENTS
} from "./ai-quick-prompt.defaults.js";

describe("快捷提问客户端投影", () => {
  it("不返回管理字段", () => {
    const item = toClientQuickPrompt({
      id: "qp_001",
      title: "查询图集",
      description: "查询图集章节、构造和节点做法",
      content: "帮我查一下和当前问题相关的图集做法，并告诉我出处。",
      icon: "book",
      position: "AI_HOME"
    });
    expect(item).toEqual({
      id: "qp_001",
      title: "查询图集",
      description: "查询图集章节、构造和节点做法",
      content: "帮我查一下和当前问题相关的图集做法，并告诉我出处。",
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

describe("快捷提问默认文案", () => {
  it("是用户会说的自然问题，不含系统指令", () => {
    for (const item of DEFAULT_QUICK_PROMPTS) {
      expect(item.content).not.toMatch(/当前已发布|不要编造|找不到可靠依据|system/i);
      expect(item.content.length).toBeLessThan(80);
    }
    expect(DEFAULT_QUICK_PROMPTS.map((item) => item.title)).toEqual([
      "查询图集",
      "分析当前项目",
      "匹配保温方案",
      "查询节能标准"
    ]);
  });

  it("能识别需要被 seed 覆盖的旧系统味文案，不误伤自定义内容", () => {
    expect(isLegacySystemWordingQuickPrompt(LEGACY_QUICK_PROMPT_CONTENTS[0])).toBe(true);
    expect(isLegacySystemWordingQuickPrompt("帮我查一下和当前问题相关的图集做法，并告诉我出处。")).toBe(false);
    expect(isLegacySystemWordingQuickPrompt("外墙保温怎么做？")).toBe(false);
  });
});
