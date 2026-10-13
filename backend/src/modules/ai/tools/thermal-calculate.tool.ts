import { decideDomainTurn, isReferenceRead } from "../ai-domain-turn-decision.js";
import { resolveCandidateReference, resolveReferenceRead } from "../reference-candidate-resolver.service.js";
import { tool } from "ai";
import { z } from "zod";
import { executeThermalCalc } from "../../thermal/thermal-calc.service.js";
import { thermalCalcModeSchema } from "../../thermal/thermal-calc.schemas.js";
import { thermalLookupFilterSchema } from "../../thermal/thermal-lookup.schemas.js";
import { formatLookupThickness } from "../../thermal/thermal-lookup-thickness.js";
import { querySolutionCandidates } from "../solution-candidate-query.service.js";
import { runRegisteredTool, type ToolRuntimeContext } from "./tool-runtime.js";
import { toolError, toolOk } from "./tool-output.js";
import { buildReferencePageBlocks, REFERENCE_PAGE_MISSING_NOTE, type ReferencePageCandidate } from "../reference-page.js";
import { knowledgeDocumentVersions, knowledgeDocuments, knowledgePages } from "../../../db/schema.js";
import { and, eq, inArray } from "drizzle-orm";
import { normalizeReferenceLookupForModel, normalizeThermalForModel } from "./tool-result-normalizer.js";
import { filterReusableCandidates } from "./thermal-lookup.js";
import {
  resolveMetricTolerance,
  TOLERANCE_ADJUSTED_NOTE,
  THERMAL_LOOKUP_METRICS,
  type ThermalLookupMode
} from "../../thermal/thermal-lookup-mode.js";
import { parseConversationTaskState, mergeConversationTaskState, type LastReferenceLookup } from "../conversation-task.js";
import { saveConversationTaskState } from "../ai-conversation-state.service.js";
import { bindConfirmedPageFacts, interpretThermalQuestion, thermalMetricClarification, THERMAL_FACT_RULES } from "../thermal-answer-facts.js";
import type { ReferenceLookupCandidate } from "../conversation-task.js";
import { isReferencePageConsumable } from "../reference-page-access.js";
export { isReferencePageConsumable } from "../reference-page-access.js";
import { readPageRecognitionMeta } from "../../../shared/page-recognition.js";
import { formatConfirmedLookupAnswer, thermalLookupPrimaryFields } from "../../knowledge/knowledge-test-reference.js";
import { parseSemanticQuery } from "../semantic-query.service.js";
import { validateCandidateAgainstQueryState, traceQueryState } from "../../thermal/thermal-query-state.js";
import { normalizeConversationLookupQuery } from "./thermal-lookup.js";
import { resolveScopedThermalStandard } from "../../thermal/thermal-standard-scope.service.js";
import { buildAllowedAnswerFacts, setThermalAnswerFacts } from "../thermal-answer-validation.js";
import { buildThermalQueryDebug, logThermalQueryDebug, toRejectedCandidateDebug } from "../../thermal/thermal-query-debug.js";
import { visiblePageLabel } from "../../../shared/page-label.js";
import { readableRenderModel } from "../../../shared/readable-page-render.js";

const specClassSchema = z.enum(["I", "II", "III"]);

/**
 * 单一 object + superRefine，禁止 discriminatedUnion。
 * OpenAI 兼容网关（含 DeepSeek）对 oneOf/anyOf Tool JSON Schema 经常卡住或死循环重试。
 */
export const thermalInput = z.object({
  filters: z.array(thermalLookupFilterSchema).min(1).max(12).optional().describe("多个热工指标条件，默认全部同时满足（AND）；不得只传其中一项"),
  metric: z.enum(THERMAL_LOOKUP_METRICS).optional().describe("查表指标：K 传热系数，TOTAL_R 总热阻，PRODUCT_R 产品层热阻"),
  targetValue: z.number().positive().max(100).optional().describe("查表指标目标值，与 metric 配合使用"),
  tolerance: z.number().positive().max(100).optional().describe("仅用户明确给出±或上下误差时传入；后端从用户原话提取并限制，模型值不直接生效"),
  operation: z.enum(["LOOKUP_CANDIDATES", "CALCULATE"])
    .describe("查已有参考档位用 LOOKUP_CANDIDATES；对已确定方案/规格/厚度做正式计算用 CALCULATE"),
  targetK: z.number().positive().max(10).optional()
    .describe("deprecated：兼容目标 K，优先使用 metric=K + targetValue"),
  targetR: z.number().positive().max(100).optional()
    .describe("deprecated：兼容目标总热阻，优先使用 metric=TOTAL_R + targetValue"),
  systemHint: z.string().trim().min(1).max(80).optional()
    .describe("用户提到的保温体系提示，例如薄抹灰；不是 UUID"),
  specClass: specClassSchema.optional()
    .describe("I / II / III 型；用户说Ⅱ型时传 II"),
  systemId: z.uuid("保温体系 ID 格式不正确").optional().describe("已知的正式保温体系 ID，优先于名称提示"),
  schemeCode: z.string().trim().min(1).max(80).optional().describe("查询指定构造方案编码"),
  catalogProductId: z.uuid("产品目录 ID 格式不正确").optional().describe("查询指定产品目录"),
  lookupMode: z.enum(["APPROX", "MAX_LIMIT", "MIN_LIMIT", "EXACT"]).optional()
    .describe(
      "查询已有参考档位时的指标语义（K / 总热阻 / 产品层热阻共用），必须与用户原话一致："
      + "「0.3左右 / 接近0.3 / 约0.3 / 0.3的方案有么 / 有没有0.3附近的」用 APPROX；"
      + "「不超过0.3 / 0.3以内 / K≤0.3 / 最大0.3 / 上限0.3 / 是否满足0.3限值」用 MAX_LIMIT；"
      + "「不低于0.3 / K≥0.3 / 至少0.3」用 MIN_LIMIT；「正好等于0.303」用 EXACT。"
      + "用户本轮明确语义优先于本参数；缺省先按原话推断，无新语义则继承上轮，首轮默认 APPROX。"
    ),
  kTolerance: z.number().positive().max(5).optional()
    .describe("K 容差（仅 APPROX/EXACT 生效）；一般不要传，由后端使用固定业务默认值"),
  mode: thermalCalcModeSchema.optional()
    .describe("REFERENCE_TABLE 图集查表，EQUIVALENT 整体当量，LAYERED 分层法；仅 CALCULATE 需要"),
  schemeId: z.uuid("构造方案 ID 格式不正确").optional()
    .describe("已发布构造方案 ID；查询时可限定方案，CALCULATE 必填"),
  productSpecId: z.uuid("产品规格 ID 格式不正确").optional()
    .describe("已发布产品规格 ID；查询时可限定规格，CALCULATE 必填"),
  thicknessMm: z.coerce.number().positive().max(100000).optional()
    .describe("保温厚度 mm。查表时用于匹配参考行；正式计算时必须落在方案产品选项区间内"),
  thicknessMin: z.coerce.number().positive().max(1000).optional().describe("查表最小保温厚度 mm，与精确厚度互斥"),
  thicknessMax: z.coerce.number().positive().max(1000).optional().describe("查表最大保温厚度 mm；20mm以内传此字段，不能传精确厚度"),
  regionCode: z.string().trim().min(1).max(40).optional()
    .describe("标准限值地区编码；缺省不判定是否达标"),
  ruleCode: z.string().trim().min(1).max(80).optional()
    .describe("计算规则编码；缺省取最新已发布规则")
}).superRefine((data, ctx) => {
  if (data.operation === "LOOKUP_CANDIDATES") {
    if (data.thicknessMm !== undefined && (data.thicknessMin !== undefined || data.thicknessMax !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["thicknessMm"], message: "精确厚度与厚度范围不能同时提供" });
    }
    if (data.thicknessMin !== undefined && data.thicknessMax !== undefined && data.thicknessMin > data.thicknessMax) {
      ctx.addIssue({ code: "custom", path: ["thicknessMin"], message: "厚度范围下限不能大于上限" });
    }
  }
  if (data.operation === "LOOKUP_CANDIDATES" && (data.metric === undefined) !== (data.targetValue === undefined)) {
    ctx.addIssue({ code: "custom", path: ["targetValue"], message: "metric 与 targetValue 必须同时提供" });
  }
  if (data.metric === "K" && data.targetValue != null && data.targetValue > 10) {
    ctx.addIssue({ code: "custom", path: ["targetValue"], message: "目标 K 不能超过 10" });
  }
  if (data.operation !== "CALCULATE") return;
  if (!data.mode) {
    ctx.addIssue({ code: "custom", path: ["mode"], message: "正式计算必须指定计算模式" });
  }
  // 缺省标识允许从唯一已选正式候选继承；执行前仍必须确定性补齐并校验。
});

export const thermalLookupInput = thermalInput;
export const thermalCalculateOpInput = thermalInput;
/** 兼容旧测试名 */
export const thermalCalculateInput = thermalInput;

function summarizeProcess(steps: unknown): Array<{ title?: string; formula?: string; value?: unknown }> {
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 24).map((step) => {
    if (!step || typeof step !== "object") return { title: String(step) };
    const record = step as Record<string, unknown>;
    return {
      title: typeof record.title === "string" ? record.title : typeof record.name === "string" ? record.name : undefined,
      formula: typeof record.formula === "string" ? record.formula : undefined,
      value: record.value ?? record.result ?? record.output
    };
  });
}

async function persistLastReferenceLookup(ctx: ToolRuntimeContext, snapshot: LastReferenceLookup) {
  const { publishCandidateResult } = await import("../candidate-result.service.js");
  await publishCandidateResult(ctx, snapshot);
}
/** 计算参数澄清不是一次新的候选查询，不刷新方案池或伪造新的可见revision。 */
async function saveCalculationQuery(ctx: ToolRuntimeContext, last: LastReferenceLookup | undefined, query: LastReferenceLookup["query"]) {
  if (!last) return;
  const task = mergeConversationTaskState(ctx.taskState ?? parseConversationTaskState(null), { lastReferenceLookup: { ...last, query } });
  if (ctx.taskState) ctx.taskState.lastReferenceLookup = task.lastReferenceLookup;
  await saveConversationTaskState(ctx.app, ctx.conversation.id, task);
}

export function createThermalTool(ctx: ToolRuntimeContext) {
  return tool({
    description: `
      热工能力。LOOKUP_CANDIDATES：按传热系数 K / 总热阻 TOTAL_R / 产品层热阻 PRODUCT_R 和体系提示查询已发布图集参考档位，不要要求地区、气候区、基层或建筑类型；未命中时必须再检索知识库，不得把选用表未命中说成整个资料库没有方案。跨体系回退必须先说明没有找到指定体系的正式参考方案。传热阻系数含义不明时澄清是传热系数K还是总热阻R；模型不能决定容差。
      查询时必须区分 K 语义：用户说「0.3左右 / 接近0.3 / 0.3的方案有么」是近似查询（lookupMode=APPROX，0.303 也应返回）；只有用户明确说「不超过 / 以内 / ≤ / 最大 / 上限 / 限值」才是上限查询（lookupMode=MAX_LIMIT）。
      多轮仅更新用户明确改变的指标，保留其他条件；取消条件从用户原话识别。厚度18mm是精确档，20mm以内用thicknessMax，18mm以上用thicknessMin，18～25mm同时传上下限。尽量薄不猜数字，在满足硬条件后按厚度升序展示。
      CALCULATE：对已确定的方案、规格和厚度做正式确定性计算；合规判断才需要地区。
      项目归属以当前会话为准，不要传入 projectId。
      ${THERMAL_FACT_RULES}
    `,
    inputSchema: thermalInput,
    execute: async (args, options) => {
      // 每次调用单独保存审计，避免同Step并行工具共享上下文时相互污染。
      let lookupDecision: Record<string, unknown> | undefined;
      const statusMessage = args.operation === "LOOKUP_CANDIDATES"
        ? "正在查询已发布参考方案…"
        : "正在进行热工计算…";
      return runRegisteredTool(ctx, "thermal", args, {
        toolCallId: options.toolCallId,
        abortSignal: options.abortSignal,
        statusMessage,
        auditMetadata: () => lookupDecision ? { backendDecision: lookupDecision } : {}
      }, async () => {
        const decision = ctx.domainDecision ?? decideDomainTurn(ctx.userMessage ?? "", ctx.taskState?.lastReferenceLookup);
        if (isReferenceRead(decision)) {
          const read = await resolveReferenceRead({ ...ctx, domainDecision: decision });
          setThermalAnswerFacts(ctx, read.facts);
          return toolOk({ candidates: read.candidates, needsClarification: read.needsClarification,
            canonicalAnswers: read.facts.canonicalAnswers, readOnly: true }, { sources: read.sources });
        }
        if (args.operation === "CALCULATE" && decision.intent !== "THERMAL_CALCULATE")
          return toolError({ code: "THERMAL_USER_AUTHORIZATION_REQUIRED", message: "执行热工计算需要用户本轮明确授权，并指定正式方案、规格和厚度。" });
        if (args.operation !== "CALCULATE" && !["REFERENCE_QUERY", "REFERENCE_REFINE"].includes(decision.intent))
          return toolError({ code: "REFERENCE_QUERY_AUTHORIZATION_REQUIRED", message: "本轮没有查表或修改筛选条件的要求。" });
        if (args.operation === "CALCULATE" && ctx.answerContract === "REFERENCE_LOOKUP") {
          return toolError({
            code: "REFERENCE_LOOKUP_ONLY",
            message: "当前是查询已有参考方案，请改用 LOOKUP_CANDIDATES，不要做正式热工计算"
          });
        }
        if (args.operation !== "CALCULATE") {
          const last = ctx.taskState?.lastReferenceLookup;
          const resolution = await parseSemanticQuery(ctx, {
            filters: args.filters,
            metric: args.metric,
            targetValue: args.targetValue,
            systemId: args.systemId,
            schemeId: args.schemeId,
            schemeCode: args.schemeCode,
            productSpecId: args.productSpecId,
            catalogProductId: args.catalogProductId,
            targetK: args.targetK,
            targetR: args.targetR,
            thicknessMm: args.thicknessMm,
            thicknessMin: args.thicknessMin,
            thicknessMax: args.thicknessMax,
            systemHint: args.systemHint,
            specClass: args.specClass,
            mode: args.lookupMode,
            tolerance: args.tolerance ?? args.kTolerance
          });
          if (resolution.needsClarification) {
            await persistLastReferenceLookup(ctx, { query: resolution.query, candidates: [], createdAt: new Date().toISOString() });
            if (!resolution.semanticParserResult && interpretThermalQuestion(ctx.userMessage ?? "", last?.query.metric).needsClarification) {
              return toolOk(thermalMetricClarification());
            }
            return toolOk({ needsClarification: true, instruction: "请用一个短问题确认不明确的热工指标、目标值及多条件关系；已明确的条件全部保留，禁止只取一项或猜测工程指标。" });
          }
          const inherited = resolution.query;
          const requestedMode = inherited.mode;
          if (resolution.conflict) {
            ctx.app.log.warn({ toolMode: args.lookupMode, resolvedMode: requestedMode }, "热工查询模式冲突：以用户明确语义为准");
          }
          // 只有纯参数/原页指代可复用；普通查询即使签名相同也重新读取正式发布状态。
          const attributeQuestion = resolution.attributeQuestion;
          const reusable = attributeQuestion ? filterReusableCandidates(last, inherited) : null;
          lookupDecision = {
            query: inherited,
            reusePreviousCandidate: reusable !== null,
            candidateIds: reusable?.map(candidate => candidate.id) ?? []
          };
          let candidates = reusable;
          let notes: string[] = [];
          let effectiveMode: ThermalLookupMode = inherited.mode ?? requestedMode ?? "APPROX";
          let identityCandidates: ReferenceLookupCandidate[] = [];
          let nearbyCandidates: ReferenceLookupCandidate[] = [];
          let effectiveTolerance: number | null = inherited.metric ? resolveMetricTolerance(inherited.metric, effectiveMode, inherited.tolerance) ?? null : null;
          let matchedSystemHint: boolean | null = reusable ? last?.matchedSystemHint ?? null : inherited.systemHint ? true : null;
          let isFallback = reusable ? last?.isFallback ?? false : false;
          let candidateQueryResult: Awaited<ReturnType<typeof querySolutionCandidates>> | undefined;
          if (!candidates) {
            const result = await querySolutionCandidates(ctx, inherited);
            candidateQueryResult = result;
            const outcome = result.outcome!;
            Object.assign(inherited, result.queryState);
            effectiveMode = outcome.lookupMode;
            identityCandidates = result.identityMatchedButMetricFailed;
            nearbyCandidates = result.nearbyCandidates;
            candidates = result.matchedCandidates;
            matchedSystemHint = result.matchedSystemHint;
            notes = result.notes;
            effectiveTolerance = outcome.tolerance ?? null;
            logThermalQueryDebug(ctx.app.log, buildThermalQueryDebug({ query: result.queryState, lifecycle: resolution.lifecycle,
              rawText: ctx.userMessage ?? "", semantic: resolution, toolFilters: inherited.filters, stageCounts: outcome.stageCounts,
              matchedCount: result.matchedCount, returnedCandidateIds: candidates.map(item => item.id),
              nearby: nearbyCandidates.map(item => toRejectedCandidateDebug(item.id, validateCandidateAgainstQueryState(item, result.queryState))),
              identityMatchedButMetricFailed: identityCandidates.map(item => item.id) }));
          }
          if (candidates.length === 0) {
            const thicknessLabel = formatLookupThickness(inherited);
            if (thicknessLabel) notes.push(`当前正式参考数据里没有找到同时满足${thicknessLabel}和所述热工条件的方案。`);
            notes = [...notes, "选用表未命中不等于知识库没有该方案，请继续检索图集原文"];
          }
          if (inherited.filters?.some((filter) => filter.toleranceAdjusted) && !notes.includes(TOLERANCE_ADJUSTED_NOTE)) {
            notes.push(TOLERANCE_ADJUSTED_NOTE);
          }
          const pageOutcome = candidateQueryResult?.pages ?? await emitReferencePages(ctx, candidates);
          const identityPages = candidateQueryResult?.identityPages ?? await emitReferencePages({ app: ctx.app, conversation: ctx.conversation }, identityCandidates);
          if (ctx.answerContract === "REFERENCE_LOOKUP" && !attributeQuestion && (inherited.filters?.length ?? 0) > 0 && pageOutcome.blocks?.length
            && pageOutcome.blocks.every(block => block.matches.every(match => Boolean(match.optionId)))) {
            const optionIds = pageOutcome.blocks.flatMap(block => block.matches.flatMap(match => match.optionId ? [match.optionId] : []));
            const answer = formatConfirmedLookupAnswer(pageOutcome.blocks, optionIds, inherited.filters ?? [], { compact: true });
            pageOutcome.blocks.forEach(block => { block.primaryFieldKeys = thermalLookupPrimaryFields(inherited.filters ?? []); });
            ctx.onReferenceAnswer?.(`${isFallback ? `${notes[0]}\n\n` : ""}${answer}`, pageOutcome.blocks);
          }
          candidates = pageOutcome.candidates;
          const allowedFacts = buildAllowedAnswerFacts(inherited, candidates, ctx.userMessage ?? "", undefined,
            { nearbyCandidates, identityMatchedButMetricFailed: identityPages.candidates });
          setThermalAnswerFacts(ctx, allowedFacts);
          if (!candidates.length && identityPages.candidates.length) ctx.onReferenceAnswer?.(allowedFacts.canonicalAnswers[0]!, identityPages.blocks ?? []);
          notes = [...notes, ...pageOutcome.warnings];
          {
            const snapshot: LastReferenceLookup = {
              query: { ...inherited, mode: effectiveMode },
              candidates,
              createdAt: new Date().toISOString(),
              matchedSystemHint,
              isFallback
            };
            await persistLastReferenceLookup(ctx, snapshot);
          }
          if (pageOutcome.missingPage && candidates.length > 0) {
            notes = [...notes, REFERENCE_PAGE_MISSING_NOTE];
          }
          const data = normalizeReferenceLookupForModel({
            allowedFacts, canonicalAnswers: allowedFacts.canonicalAnswers, queryState: inherited,
            thicknessMm: inherited.thicknessMm,
            thicknessMin: inherited.thicknessMin,
            thicknessMax: inherited.thicknessMax,
            preferThinner: inherited.preferThinner,
            filters: inherited.filters,
            requestedTolerance: inherited.requestedTolerance,
            effectiveTolerance: inherited.effectiveTolerance,
            toleranceAdjusted: inherited.toleranceAdjusted,
            metric: inherited.metric,
            targetValue: inherited.targetValue,
            tolerance: effectiveTolerance,
            found: candidates.length > 0,
            candidates,
            notes,
            lookupMode: effectiveMode,
            kTolerance: inherited.metric === "K" ? effectiveTolerance : null,
            matchedSystemHint,
            isFallback
          });
          return toolOk(data, {
            summary: candidates.length > 0
              ? `找到 ${candidates.length} 条接近目标的已发布参考档位`
              : "选用表未命中，需继续检索知识库图集",
            ...(pageOutcome.sources.length > 0 ? { sources: pageOutcome.sources } : {})
          });
        }

        const last = ctx.taskState?.lastReferenceLookup;
        const query = normalizeConversationLookupQuery({ ...args, mode: args.lookupMode }, ctx.userMessage ?? "", last).query;
        if (args.regionCode) query.regionCode = args.regionCode;
        // 引用只来自本轮原话或真实SolutionState.Selected；旧临时Selected及单候选不能证明授权。
        const reference = await resolveCandidateReference({ ...ctx, domainDecision: { ...decision,
          referenceScope: /已选|选中的|保留的/.test(ctx.userMessage ?? "") ? "CURRENT_SELECTED" : "LATEST_VISIBLE" } });
        const frozen = reference.candidates.length === 1 ? reference.candidates[0] : undefined;
        if (!frozen) return toolError({ code: "THERMAL_CANDIDATE_REQUIRED", message: reference.reason ?? "请指定一个已核验方案后执行计算。" });
        if (args.schemeId && args.schemeId !== frozen.schemeId || args.productSpecId && args.productSpecId !== frozen.productSpecId
          || args.thicknessMm != null && args.thicknessMm !== frozen.thicknessMm && !(new RegExp(`${args.thicknessMm}\\s*(?:mm|毫米)`, "i").test(ctx.userMessage ?? "")))
          return toolError({ code: "THERMAL_INPUT_NOT_GROUNDED", message: "计算标识或厚度与本轮用户引用不一致，请确认具体方案和厚度。" });
        args.schemeId = frozen.schemeId;
        args.productSpecId = frozen.productSpecId;
        args.thicknessMm ??= frozen.thicknessMm;
        let complianceAuthorized = false;
        if (/达标|合规|符合.*标准/.test(ctx.userMessage ?? "")) {
          const scoped = await resolveScopedThermalStandard(ctx.app.db, query);
          if (!scoped.limit) query.unresolved = [{ field: "standardLimitId", reason: scoped.reason ?? "请确认地区、建筑类型和标准" }];
          else complianceAuthorized = true;
        }
        if (!args.mode || !args.schemeId || !args.productSpecId || args.thicknessMm == null || frozen && !validateCandidateAgainstQueryState({ ...frozen, thicknessMm: args.thicknessMm }, query).passed || query.unresolved?.length) {
          const missing = { ...traceQueryState(query), intent: "THERMAL" as const };
          await saveCalculationQuery(ctx, last, missing);
          return toolOk({ needsClarification: true, instruction: "请明确一个满足当前硬条件的正式方案、规格与厚度后计算。" });
        }
        await saveCalculationQuery(ctx, last, { ...query, intent: "THERMAL", thicknessMm: args.thicknessMm });
        const result = await executeThermalCalc(ctx.app, ctx.request, ctx.user, {
          mode: args.mode,
          schemeId: args.schemeId,
          productSpecId: args.productSpecId,
          thicknessMm: args.thicknessMm,
          regionCode: args.regionCode,
          standardLimitId: query.standardLimitId, buildingType: query.buildingType, structureType: query.structureType,
          ruleCode: args.ruleCode,
          projectId: ctx.conversation.projectId ?? null
        });
        const record = result.record;
        if (result.valid && record && (ctx.user.clientType === "C_APP" || ctx.user.clientType === "PC_AI")) {
          const { loadCalculatedCandidates } = await import("../solution-state.service.js");
          const { publishCandidateResult } = await import("../candidate-result.service.js");
          const calculated = await loadCalculatedCandidates(ctx, record.id);
          await publishCandidateResult(ctx, { query: { ...query, intent: "THERMAL" }, candidates: calculated, createdAt: new Date().toISOString() }, true);
        }
        const calcResult = (record?.result ?? {}) as Record<string, unknown>;
        const calculationFacts = { ...frozen, thicknessMm: args.thicknessMm,
          kValue: typeof calcResult.kValue === "number" ? calcResult.kValue : undefined,
          productThermalResistance: typeof calcResult.productResistance === "number" ? calcResult.productResistance : undefined,
          totalThermalResistance: typeof calcResult.totalResistance === "number" ? calcResult.totalResistance : undefined };
        ctx.thermalCanonicalAnswers = [`K=${String(calcResult.kValueRounded ?? calcResult.kValue ?? "未提供")} R=${String(calcResult.totalResistanceRounded ?? calcResult.totalResistance ?? "未提供")}${validateCandidateAgainstQueryState(calculationFacts, query).passed ? "" : "；计算结果不能证明满足全部原筛选条件。"}`];
        setThermalAnswerFacts(ctx, { query, candidates: [], canonicalAnswers: ctx.thermalCanonicalAnswers,
          calculation: { schemeId: args.schemeId, productSpecId: args.productSpecId, thicknessMm: args.thicknessMm,
            kValue: typeof (calcResult.kValueRounded ?? calcResult.kValue) === "number" ? (calcResult.kValueRounded ?? calcResult.kValue) as number : undefined,
            totalResistance: typeof (calcResult.totalResistanceRounded ?? calcResult.totalResistance) === "number" ? (calcResult.totalResistanceRounded ?? calcResult.totalResistance) as number : undefined,
            productThermalResistance: calculationFacts.productThermalResistance, complianceAuthorized,
            compliant: typeof calcResult.compliant === "boolean" ? calcResult.compliant : null,
            standardLimitK: typeof record?.standard?.limitKValue === "number" ? record.standard.limitKValue : undefined } });
        const data = normalizeThermalForModel({
          valid: result.valid,
          K: calcResult.kValueRounded ?? calcResult.kValue ?? null,
          R: calcResult.totalResistanceRounded ?? calcResult.totalResistance ?? null,
          pass: (calcResult.compliant as boolean | null | undefined) ?? null,
          notes: result.notes,
          errors: result.errors,
          process: summarizeProcess(record?.steps)
        });
        return toolOk(data, {
          summary: result.valid
            ? `K=${String(data.K)} R=${String(data.R)}`
            : (data.notes[0] ?? "热工计算未完成")
        });
      });
    }
  });
}

export async function emitReferencePages(
  ctx: Pick<ToolRuntimeContext, "app"> & { onEvent?: ToolRuntimeContext["onEvent"]; conversation?: { projectId: string | null } },
  candidates: ReferenceLookupCandidate[]
) {
  const warnings: string[] = [];
  const pageIds = [...new Set(candidates.map((item) => item.sourcePageId).filter((id): id is string => Boolean(id)))];
  if (pageIds.length === 0) return { missingPage: candidates.length > 0, sources: [] as unknown[], candidates, warnings };
  const rows = await ctx.app.db.select({
    pageId: knowledgePages.id,
    documentId: knowledgePages.documentId,
    documentTitle: knowledgeDocuments.title,
    docNumber: knowledgeDocuments.docNumber,
    pageNumber: knowledgePages.pageNumber,
    physicalPageNumber: knowledgePages.physicalPageNumber,
    pageLabel: knowledgePages.pageLabel,
    pageLabelSource: knowledgePages.pageLabelSource,
    pageLabelVerified: knowledgePages.pageLabelVerified,
    metadata: knowledgePages.metadata,
    pageImageObjectKey: knowledgePages.pageImageObjectKey,
    versionId: knowledgeDocumentVersions.id,
    versionStatus: knowledgeDocumentVersions.status,
    effectiveDate: knowledgeDocumentVersions.effectiveDate,
    expiryDate: knowledgeDocumentVersions.expiryDate,
    documentStatus: knowledgeDocuments.status,
    documentDeletedAt: knowledgeDocuments.deletedAt,
    currentVersionId: knowledgeDocuments.currentVersionId,
    usageMode: knowledgeDocumentVersions.usageMode,
    projectId: knowledgeDocuments.projectId
  }).from(knowledgePages)
    .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgePages.documentId))
    .innerJoin(knowledgeDocumentVersions, and(eq(knowledgeDocumentVersions.id, knowledgePages.versionId), eq(knowledgeDocumentVersions.documentId, knowledgePages.documentId)))
    .where(inArray(knowledgePages.id, pageIds));
  const today = new Date().toISOString().slice(0, 10);
  const validRows = rows.filter((row) => isReferencePageConsumable(row, today, ctx.conversation?.projectId ?? null));
  // 历史参数追问也必须重验来源授权，不能只跳过签名却继续返回失效快照的数值。
  candidates = candidates.filter(candidate => !candidate.sourcePageId || validRows.some(page => page.pageId === candidate.sourcePageId
    && (!candidate.sourceDocumentId || candidate.sourceDocumentId === page.documentId)));
  candidates = candidates.map((candidate) => {
    const page = validRows.find((row) => row.pageId === candidate.sourcePageId);
    if (!page) return candidate;
    const bound = bindConfirmedPageFacts({ ...candidate, sourcePageLabel: visiblePageLabel(page) }, { ...page, pageLabel: visiblePageLabel(page) });
    if (bound.warnings.length) {
      ctx.app.log.warn({ candidateId: candidate.id, pageId: page.pageId, warnings: bound.warnings }, "热工候选来源一致性警告");
      warnings.push(...bound.warnings);
    }
    return bound.candidate;
  });
  candidates = candidates.filter(candidate => {
    const page = validRows.find(row => row.pageId === candidate.sourcePageId);
    return !page || !readPageRecognitionMeta(page.metadata).confirmedStructuredData || Boolean(candidate.optionId);
  });
  const rejectedPageIds = pageIds.filter((pageId) => !validRows.some((row) => row.pageId === pageId));
  if (rejectedPageIds.length > 0) {
    ctx.app.log.warn({ pageIds: rejectedPageIds }, "热工参考页当前不满足正式知识版本访问条件，已跳过签名输出");
  }
  const pages = await Promise.all(validRows.map(async (row) => {
    const physicalPageNumber = row.physicalPageNumber ?? row.pageNumber;
    return {
      pageId: row.pageId,
      documentId: row.documentId,
      documentTitle: row.documentTitle,
      docNumber: row.docNumber,
      pageNumber: physicalPageNumber,
      physicalPageNumber,
      pageLabel: visiblePageLabel(row),
      pageImageObjectKey: row.pageImageObjectKey,
      renderModel: readableRenderModel(row.pageId, row.metadata, visiblePageLabel(row)),
      imageUrl: row.pageImageObjectKey
        ? await ctx.app.storage.createDownloadUrl(row.pageImageObjectKey, `page-${physicalPageNumber}.png`, 3600).catch(() => null)
        : null
    };
  }));
  const built = buildReferencePageBlocks(candidates as ReferencePageCandidate[], pages);
  if (built.blocks.length > 0) {
    ctx.onEvent?.("reference_pages", { referencePages: built.blocks, stored: built.stored });
    const sources = built.blocks.map((block) => ({
      documentId: block.page.documentId,
      pageId: block.page.pageId,
      title: block.page.documentTitle,
      pageLabel: block.page.pageLabel,
      pageNumber: block.page.pageNumber,
      physicalPageNumber: block.page.physicalPageNumber ?? block.page.pageNumber
    }));
    ctx.onEvent?.("sources", { sources });
    return { missingPage: false, sources, candidates, warnings, blocks: built.blocks };
  }
  return { missingPage: true, sources: [] as unknown[], candidates, warnings };
}

/** 兼容旧导出名 */
export const createThermalCalculateTool = createThermalTool;
