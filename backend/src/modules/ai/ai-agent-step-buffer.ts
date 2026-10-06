/**
 * Agent Step Buffer：在不知道当前 Step 是否会调用 Tool 之前，不把 text-delta 推给用户。
 * 基于 AI SDK 7 fullStream 的 start-step / text-delta / tool-call / finish-step。
 */

export type AgentStepKind = "internal" | "visible";

export type AgentStepBuffer = {
  text: string;
  hasToolCall: boolean;
};

export type AgentStreamPartLike = {
  type: string;
  text?: unknown;
};

export function createAgentStepBuffer(): AgentStepBuffer {
  return { text: "", hasToolCall: false };
}

export function isToolBoundaryPart(type: string): boolean {
  return type === "tool-call"
    || type === "tool-input-start"
    || type === "tool-input-delta"
    || type === "tool-input-end";
}

export function applyAgentStreamPart(
  buffer: AgentStepBuffer,
  part: AgentStreamPartLike
): AgentStepBuffer {
  if (part.type === "start-step") {
    return createAgentStepBuffer();
  }
  if (part.type === "text-delta") {
    const delta = typeof part.text === "string" ? part.text : "";
    if (!delta) return buffer;
    return { ...buffer, text: buffer.text + delta };
  }
  if (isToolBoundaryPart(part.type)) {
    return { ...buffer, hasToolCall: true };
  }
  return buffer;
}

export function classifyFinishedStep(buffer: AgentStepBuffer): AgentStepKind {
  return buffer.hasToolCall ? "internal" : "visible";
}

/** 用户停止或流结束时：尚无 Tool Call 的缓冲视为可见半成品；已有 Tool Call 则仍内部。 */
export function classifyInterruptedStep(buffer: AgentStepBuffer): AgentStepKind | null {
  if (!buffer.text.trim()) return null;
  return classifyFinishedStep(buffer);
}

/**
 * 最终答案按段发送：优先完整段落，其次完整句子。
 * 不为了逐 token 动画效果切开半句。
 */
export function splitVisibleAnswerChunks(text: string, maxChunkChars = 120): string[] {
  const value = text.trim();
  if (!value) return [];
  const paragraphs = value.split(/\n{2,}/);
  const chunks: string[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index] ?? "";
    const suffix = index < paragraphs.length - 1 ? "\n\n" : "";
    const piece = `${paragraph}${suffix}`;
    if (piece.length <= maxChunkChars) {
      chunks.push(piece);
      continue;
    }
    const sentences = piece.split(/(?<=[。！？；\n])/);
    let current = "";
    for (const sentence of sentences) {
      if (!sentence) continue;
      if (current && current.length + sentence.length > maxChunkChars) {
        chunks.push(current);
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks.filter((item) => item.length > 0);
}
