import type { AgentToolName } from "../../src/modules/ai/ai-capability-router.js";
import type { ConversationTaskState, LastReferenceLookup, ReferenceLookupCandidate } from "../../src/modules/ai/conversation-task.js";
import type { thermalCalcRecords, aiMessages, aiToolCalls, aiAgentRuns } from "../../src/db/schema.js";

export type UatPersona = "SALES" | "DESIGN_INSTITUTE";
export type UatIntent = ConversationTaskState["taskType"] | "REFERENCE_LOOKUP" | "THERMAL" | "COMPLIANCE";
export type FailureType = "ROUTING" | "PARSER" | "FILTER" | "STATE" | "RETRIEVAL" | "THERMAL" | "SOURCE" | "ANSWER_CONTRACT" | "UX_COPY" | "HALLUCINATION" | "INFRASTRUCTURE";
export type UatExpect = {
  intent: UatIntent;
  taskType?: ConversationTaskState["taskType"];
  toolsAny: AgentToolName[];
  operation?: "LOOKUP_CANDIDATES" | "CALCULATE";
  query?: Partial<LastReferenceLookup["query"]>;
  inheritPreviousFilters?: boolean;
  reusePreviousCandidate?: boolean;
  expectedCandidate?: Partial<ReferenceLookupCandidate>;
  candidateCount?: number;
  referencePageRequired?: boolean;
  resultType?: "REFERENCE" | "CALCULATED";
  answerFacts?: { pattern: string; value: number; tolerance?: number }[];
  answerIncludes?: string[];
  clarification?: boolean;
  hardFailRules: string[];
};
export type UatTurn = { user: string; expect: UatExpect };
export type UatCase = { id: string; persona: UatPersona; scenario: string; tags: string[]; turns: UatTurn[] };
export type SseEvent = { event: string; data: Record<string, unknown> };
export type Observation = {
  message: typeof aiMessages.$inferSelect;
  tools: (typeof aiToolCalls.$inferSelect)[];
  runs: (typeof aiAgentRuns.$inferSelect)[];
  task: ConversationTaskState;
  events: SseEvent[];
  calculations: (typeof thermalCalcRecords.$inferSelect)[];
};
export type Check = { group: "intent" | "parameters" | "facts" | "state" | "quality" | "source"; passed: boolean; type: FailureType; detail: string; hard?: boolean };
export type TurnResult = { caseId: string; persona: UatPersona; scenario: string; turn: number; user: string; expected: UatExpect; actual?: Observation; checks: Check[]; quality: { score: number; method: string; reasons: string[] }; score: number; status: "PASS" | "WARN" | "FAIL" | "BLOCKED" };

export const HARD_FAIL_RULES = ["HARD_CONDITION", "METRIC_CONFUSION", "FABRICATED_PAGE", "RESULT_TYPE", "UNSUPPORTED_COMPLIANCE", "STALE_CONDITIONS", "THICKNESS_VIOLATION"];
