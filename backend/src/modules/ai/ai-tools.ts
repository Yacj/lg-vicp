/**
 * Agent Tool Registry 兼容入口。实现已拆到 src/modules/ai/tools/。
 */
export {
  createAgentTools,
  TOOL_STATUS_LABELS,
  hashToolInput,
  isAgentWaitSignal,
  stableStringify,
  summarizeToolPayload,
  type AgentWaitSignal,
  type ToolRuntimeContext
} from "./tools/index.js";
