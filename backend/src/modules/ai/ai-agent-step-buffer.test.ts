import { describe, expect, it } from "vitest";
import {
  applyAgentStreamPart,
  classifyFinishedStep,
  classifyInterruptedStep,
  createAgentStepBuffer,
  splitVisibleAnswerChunks
} from "./ai-agent-step-buffer.js";
import { formatUserVisibleAnswer } from "./ai-answer-format.js";

function replay(parts: Array<{ type: string; text?: string }>) {
  let buffer = createAgentStepBuffer();
  let userVisibleText = "";
  let internalStepText = "";
  const visibleDeltas: string[] = [];
  const flush = (interrupted = false) => {
    const kind = interrupted
      ? classifyInterruptedStep(buffer)
      : (buffer.text.trim() ? classifyFinishedStep(buffer) : null);
    if (!kind) return;
    const formatted = formatUserVisibleAnswer(buffer.text);
    if (kind === "internal") {
      internalStepText = internalStepText ? `${internalStepText}\n\n${buffer.text.trim()}` : buffer.text.trim();
      return;
    }
    if (!formatted) return;
    userVisibleText = userVisibleText ? `${userVisibleText}\n\n${formatted}` : formatted;
    visibleDeltas.push(...splitVisibleAnswerChunks(formatted));
  };
  for (const part of parts) {
    if (part.type === "start-step" && buffer.text) flush();
    buffer = applyAgentStreamPart(buffer, part);
    if (part.type === "finish-step") {
      flush();
      buffer = createAgentStepBuffer();
    }
  }
  if (buffer.text) flush(true);
  return { userVisibleText, internalStepText, visibleDeltas };
}

describe("Agent Step Buffer", () => {
  it("Tool Step 文本进入 internalStepText，不进入用户正文", () => {
    const result = replay([
      { type: "start-step" },
      { type: "text-delta", text: "我先查一下相关资料。" },
      { type: "tool-call" },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "text-delta", text: "外墙薄抹灰系统传热系数可做到 0.30。" },
      { type: "finish-step" }
    ]);
    expect(result.internalStepText).toContain("我先查一下相关资料。");
    expect(result.userVisibleText).toBe("外墙薄抹灰系统传热系数可做到 0.30。");
    expect(result.userVisibleText).not.toContain("我先查一下");
    expect(result.visibleDeltas.join("")).toBe(result.userVisibleText);
  });

  it("没有 Tool Call 的 Step 才作为最终答案按段发送", () => {
    const result = replay([
      { type: "start-step" },
      { type: "text-delta", text: "你好，我是筑小格。" },
      { type: "finish-step" }
    ]);
    expect(result.internalStepText).toBe("");
    expect(result.userVisibleText).toBe("你好，我是筑小格。");
  });

  it("中断在 Tool Step 时不把过渡文本发给用户", () => {
    const result = replay([
      { type: "start-step" },
      { type: "text-delta", text: "让我确认一下。" },
      { type: "tool-input-start" }
    ]);
    expect(result.userVisibleText).toBe("");
    expect(result.internalStepText).toContain("让我确认一下。");
  });
});
