import { beforeAll, describe, expect, it } from "vitest";
import { resolveAnswerContract, formatAnswerContractPrompt } from "../../shared/ai-answer-contract.js";
import { applyAgentStreamPart, classifyFinishedStep, createAgentStepBuffer } from "./ai-agent-step-buffer.js";
import { formatUserVisibleAnswer } from "./ai-answer-format.js";
import { resolveAiCapabilities } from "./ai-capability-router.js";
import { resolveConversationTask } from "./conversation-task.js";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

const PROCESS_LEAK = /我先明确一点|我会调用|直接泛查会|我先查一下|让我确认/;

function visibleFromParts(parts: Array<{ type: string; text?: string }>): { visible: string; internal: string } {
  let buffer = createAgentStepBuffer();
  let visible = "";
  let internal = "";
  const settle = () => {
    if (!buffer.text.trim()) return;
    if (classifyFinishedStep(buffer) === "internal") {
      internal = internal ? `${internal}\n${buffer.text}` : buffer.text;
    } else {
      visible = visible ? `${visible}\n\n${formatUserVisibleAnswer(buffer.text)}` : formatUserVisibleAnswer(buffer.text);
    }
  };
  for (const part of parts) {
    if (part.type === "start-step" && buffer.text) settle();
    buffer = applyAgentStreamPart(buffer, part);
    if (part.type === "finish-step") {
      settle();
      buffer = createAgentStepBuffer();
    }
  }
  return { visible, internal };
}

describe("Answer Contract", () => {
  it("旧式知识提问走 KNOWLEDGE，查已有方案走 REFERENCE_LOOKUP", () => {
    const knowledgeMessage = "请根据当前已发布的知识资料，帮助我查询相关节能标准和技术要求，并给出对应章节、页码和原文来源。找不到可靠依据时请明确说明，不要编造标准号或条文。";
    const knowledgeTask = resolveConversationTask({ message: knowledgeMessage });
    const knowledgeCaps = resolveAiCapabilities({ message: knowledgeMessage });
    expect(resolveAnswerContract({
      taskType: knowledgeTask.state.taskType,
      capabilities: knowledgeCaps,
      message: knowledgeMessage
    })).toBe("KNOWLEDGE");

    const lookupMessage = "保温薄抹灰系统传热系数0.3的方案";
    const lookupCaps = resolveAiCapabilities({ message: lookupMessage });
    expect(lookupCaps.needReferenceLookup).toBe(true);
    expect(lookupCaps.needThermalTool).toBe(false);
    expect(resolveAnswerContract({
      capabilities: lookupCaps,
      message: lookupMessage
    })).toBe("REFERENCE_LOOKUP");
  });

  it("合同文案只注入当前合同，并收紧 CLARIFY 兜底", () => {
    const prompt = formatAnswerContractPrompt("KNOWLEDGE");
    expect(prompt).toContain("当前合同：KNOWLEDGE");
    expect(prompt).toContain("先给结论或关键要求");
    expect(prompt).not.toContain("THERMAL：");
    expect(prompt).not.toContain("REFERENCE_LOOKUP：");
    expect(prompt).not.toContain("即使当前合同不是 CLARIFY");
    expect(prompt).toContain("才改用 CLARIFY：只问 1 个最关键条件");
    expect(prompt).not.toMatch(/我会调用|我不会编造/);
  });
});

describe("Case A：旧式标准查询 Prompt", () => {
  it("即使输入系统味指令，用户正文也不能出现过程话术", async () => {
    const { GLOBAL_RESPONSE_POLICY } = await import("../../shared/ai-response-policy.js");
    const result = visibleFromParts([
      { type: "start-step" },
      { type: "text-delta", text: "我先明确一点，不同方向依据完全不同。直接泛查会不准确。我会调用检索。" },
      { type: "tool-call" },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "text-delta", text: "你想查哪个方向：外墙保温、屋面、门窗，还是某个具体构造节点？" },
      { type: "finish-step" }
    ]);
    expect(result.internal).toMatch(PROCESS_LEAK);
    expect(result.visible).not.toMatch(PROCESS_LEAK);
    expect(result.visible).toContain("你想查哪个方向");
    expect(result.visible.match(/？/g)?.length).toBe(1);
    expect(GLOBAL_RESPONSE_POLICY).toContain("不描述准备做什么或内部执行过程");
  });
});

describe("Case B：匹配保温方案", () => {
  it("最终正文句子完整，不泄露内部流程，不出现半句", () => {
    const result = visibleFromParts([
      { type: "start-step" },
      { type: "text-delta", text: "我先查一下相关图集。" },
      { type: "tool-input-start" },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "text-delta", text: "与部位**" },
      { type: "tool-call" },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "text-delta", text: "薄抹灰外墙保温可采用 25mm 做法。\n\n- 需设置抗裂防护层\n- 窗洞口应封堵\n\n依据\n- 《外墙外保温工程技术标准》5.2 节，A7 页" },
      { type: "finish-step" }
    ]);
    expect(result.visible.startsWith("薄抹灰")).toBe(true);
    expect(result.visible).not.toMatch(PROCESS_LEAK);
    expect(result.visible).not.toContain("与部位**");
    expect(result.visible).toContain("25mm");
    expect(result.visible).toMatch(/。/);
  });
});

describe("Case C：传热系数 0.3 方案", () => {
  it("第一屏先给接近 0.3 的结果，禁止开头“我先查一下”", () => {
    const result = visibleFromParts([
      { type: "start-step" },
      { type: "text-delta", text: "我先查一下图集里的 I/II/III 型全区间数据。" },
      { type: "tool-call" },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "text-delta", text: "接近 0.3 的薄抹灰方案传热系数约为 0.30。\n\n- 厚度 25mm\n- 依据：《保温图集》选用表" },
      { type: "finish-step" }
    ]);
    expect(result.visible.startsWith("接近 0.3")).toBe(true);
    expect(result.visible).not.toContain("我先查一下");
    expect(result.visible).not.toContain("I/II/III");
    expect(resolveAnswerContract({
      capabilities: resolveAiCapabilities({ message: "保温薄抹灰系统传热系数0.3的方案" }),
      message: "保温薄抹灰系统传热系数0.3的方案"
    })).toBe("REFERENCE_LOOKUP");
  });
});

const LAST_LOOKUP = {
  query: { targetK: 0.3, systemHint: "薄抹灰" },
  candidates: [
    {
      id: "row-ii",
      specClass: "II" as const,
      thicknessMm: 55,
      kValue: 0.294,
      systemName: "薄抹灰外保温",
      schemeId: "scheme-ii",
      productSpecId: "spec-ii",
      evidenceSource: "保温图集",
      evidenceRef: "A2"
    },
    {
      id: "row-i",
      specClass: "I" as const,
      thicknessMm: 50,
      kValue: 0.30,
      systemName: "薄抹灰外保温",
      schemeId: "scheme-i",
      productSpecId: "spec-i"
    }
  ],
  createdAt: "2026-09-21T00:00:00.000Z"
};

describe("REFERENCE_LOOKUP vs THERMAL 五案", () => {
  it("Case 1：查已有 0.3 方案走 REFERENCE_LOOKUP，不进正式计算", () => {
    const message = "保温薄抹灰系统传热系数0.3的方案有么";
    const capabilities = resolveAiCapabilities({ message });
    expect(capabilities.needReferenceLookup).toBe(true);
    expect(capabilities.needThermalTool).toBe(false);
    expect(resolveAnswerContract({ capabilities, message })).toBe("REFERENCE_LOOKUP");
    const prompt = formatAnswerContractPrompt("REFERENCE_LOOKUP");
    expect(prompt).toContain("不要把地区、气候区、建筑类型、基层、厚度当作查询前置条件");
    expect(prompt).toContain("不要立刻说没有方案");
    expect(prompt).not.toContain("DIRECT：");
  });

  it("Case 2：上一轮已有候选时，Ⅱ型具体参数仍走 REFERENCE_LOOKUP", () => {
    const message = "Ⅱ型薄抹灰外保温系统外墙具体参数";
    expect(resolveAnswerContract({
      capabilities: resolveAiCapabilities({ message }),
      message,
      lastReferenceLookup: LAST_LOOKUP
    })).toBe("REFERENCE_LOOKUP");
  });

  it("Case 3：问上海是否满足要求走 THERMAL", () => {
    const message = "这个0.3的方案在上海能满足要求吗？";
    const capabilities = resolveAiCapabilities({ message });
    expect(capabilities.needThermalTool).toBe(true);
    expect(resolveAnswerContract({
      capabilities,
      message,
      lastReferenceLookup: LAST_LOOKUP
    })).toBe("THERMAL");
  });

  it("Case 4：明确帮我算走 THERMAL", () => {
    const message = "55mm Ⅱ型 VICP 的主断面 K 值帮我算一下";
    expect(resolveAnswerContract({
      capabilities: resolveAiCapabilities({ message }),
      message,
      lastReferenceLookup: LAST_LOOKUP
    })).toBe("THERMAL");
  });

  it("Case 5：图集里更低一点的Ⅱ型仍走 REFERENCE_LOOKUP", () => {
    const message = "图集里还有没有比0.3更低一点的Ⅱ型方案？";
    const capabilities = resolveAiCapabilities({ message });
    expect(capabilities.needReferenceLookup).toBe(true);
    expect(capabilities.needThermalTool).toBe(false);
    expect(resolveAnswerContract({
      capabilities,
      message,
      lastReferenceLookup: LAST_LOOKUP
    })).toBe("REFERENCE_LOOKUP");
  });
});
