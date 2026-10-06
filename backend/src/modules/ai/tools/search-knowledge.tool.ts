import { tool } from "ai";
import { z } from "zod";
import { loadKnowledgeForGeneration } from "../ai-knowledge-load.js";
import { toAiSources } from "../ai-source.mapper.js";
import { formatKnowledgeHitsForModel } from "../../knowledge/knowledge.service.js";
import { runRegisteredTool, type ToolRuntimeContext } from "./tool-runtime.js";
import { toolOk } from "./tool-output.js";
import { normalizeSearchKnowledgeForModel } from "./tool-result-normalizer.js";
import { parseConversationTaskState } from "../conversation-task.js";
import { saveConversationTaskState } from "../ai-conversation-state.service.js";
import { buildUserSelectionWaitState } from "../agent-choice.js";
import {
  candidatesFromHits,
  knowledgeSourceKindFromScope,
  knowledgeSourceKindOf,
  resolveKnowledgeSourceDecision,
  shouldForceReselectKnowledgeSource
} from "../knowledge-source-selection.js";
import { USER_LANGUAGE_NOTES } from "../../../shared/ai-response-policy.js";

export const searchKnowledgeInput = z.object({
  query: z
    .string()
    .trim()
    .min(2, "检索问题至少 2 个字符")
    .max(300, "检索问题最多 300 个字符")
    .describe("需要查找的具体技术问题，不要只传泛化关键词"),
  scope: z
    .enum(["ALL", "ATLAS", "STANDARD"])
    .default("ALL")
    .describe("图集构造优先 ATLAS，标准规范优先 STANDARD，不确定使用 ALL。scope 不是用户选择的文档 ID，也不是保温体系")
});

export function createSearchKnowledgeTool(ctx: ToolRuntimeContext) {
  return tool({
    description: `
      查找当前用户有权使用的已发布技术资料。
      涉及图集、标准、规范、构造节点或需要出处时使用。
      不用于读取项目自身字段。
      保温体系 insulationSystemId 只用于检索加权，不能代替图集/资料来源选择。
    `,
    inputSchema: searchKnowledgeInput,
    execute: async ({ query, scope }, options) => runRegisteredTool(ctx, "search_knowledge", { query, scope }, options, async () => {
      const scopedQuery = scope === "ALL"
        ? query
        : `${scope === "ATLAS" ? "图集构造" : "标准规范"} ${query}`;
      const { chunks, retrievalFailed } = await loadKnowledgeForGeneration({
        app: ctx.app,
        log: ctx.request.log,
        conversationId: ctx.conversation.id,
        messageId: ctx.assistantMessageId,
        content: scopedQuery,
        projectId: ctx.conversation.projectId,
        insulationSystemId: ctx.conversation.insulationSystemId ?? null,
        needSearch: true
      });
      const taskState = ctx.taskState ?? parseConversationTaskState(null);
      const neededKind = knowledgeSourceKindFromScope(scope);
      const candidates = candidatesFromHits(chunks, neededKind);
      const decision = resolveKnowledgeSourceDecision({
        candidates,
        confirmedIds: taskState.confirmedKnowledgeSourceIds,
        confirmedKind: taskState.confirmedKnowledgeSourceKind,
        neededKind,
        forceReselect: shouldForceReselectKnowledgeSource(query),
        previousCandidateIds: taskState.knowledgeSourceCandidateIds
      });

      if (decision.action === "NONE") {
        ctx.onEvent?.("sources", { sources: [] });
        return toolOk(normalizeSearchKnowledgeForModel({ hits: [], retrievalFailed }), {
          summary: retrievalFailed ? "资料暂时读不到" : USER_LANGUAGE_NOTES.missingVerifiableSource
        });
      }

      if (decision.action === "AUTO" || decision.action === "REUSE") {
        const kind = knowledgeSourceKindOf(decision.selectedIds, candidates);
        if (ctx.taskState) {
          ctx.taskState.confirmedKnowledgeSourceIds = decision.selectedIds;
          ctx.taskState.confirmedKnowledgeSourceKind = kind;
          ctx.taskState.knowledgeSourceCandidateIds = candidates.map((item) => item.id);
        }
        await saveConversationTaskState(ctx.app, ctx.conversation.id, {
          ...(ctx.taskState ?? taskState),
          confirmedKnowledgeSourceIds: decision.selectedIds,
          confirmedKnowledgeSourceKind: kind,
          knowledgeSourceCandidateIds: candidates.map((item) => item.id)
        });
      }

      if (decision.action === "WAIT") {
        const waiting = buildUserSelectionWaitState({
          request: decision.request,
          sourceToolCallId: options.toolCallId
        });
        return {
          ok: true as const,
          waiting: true,
          __agentSignal: "WAITING_USER_INPUT" as const,
          type: waiting.type,
          selectionKind: waiting.selectionKind,
          title: waiting.title,
          prompt: waiting.prompt,
          options: waiting.options,
          multiple: waiting.multiple,
          minSelections: waiting.minSelections,
          maxSelections: waiting.maxSelections,
          autoSelectWhenSingle: waiting.autoSelectWhenSingle,
          confirmAction: waiting.confirmAction,
          request: waiting.request,
          sourceToolCallId: options.toolCallId
        };
      }

      const selected = new Set(decision.selectedIds);
      const filteredChunks = chunks.filter((chunk) => selected.has(chunk.documentId));
      const hits = formatKnowledgeHitsForModel(filteredChunks);
      const sources = toAiSources(filteredChunks);
      ctx.onEvent?.("sources", { sources });
      const data = normalizeSearchKnowledgeForModel({ hits, retrievalFailed });
      return toolOk({
        ...data,
        selectedSourceIds: decision.selectedIds,
        sourceKind: knowledgeSourceKindOf(decision.selectedIds, candidates)
      }, {
        summary: data.available ? `命中 ${data.hits.length} 条资料` : (data.note ?? USER_LANGUAGE_NOTES.missingVerifiableSource)
      });
    })
  });
}
