import { and, eq, desc } from "drizzle-orm";
import { createHash } from "node:crypto";
import { thermalCalcRecords, thermalCalcRules, catalogProducts } from "../../db/schema.js";
import { productSpecs } from "../../db/schema.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { executeThermalCalc } from "../thermal/thermal-calc.service.js";
import { getPublishedConstructionSchemeDetail, getPublishedInsulationSystem } from "../construction/construction-read.service.js";
import { assertSolutionAccess, loadCalculatedCandidates } from "./solution-state.service.js";
import { publishCandidateResult } from "./candidate-result.service.js";
import { referenceRowsStillCurrent } from "./reference-candidate-source.service.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";
import { resolveMaterialFacts } from "../knowledge/knowledge-fact-resolver.js";
import { readReferenceFactHistory } from "./reference-fact-history.js";
import { currentReferenceFocus } from "./reference-focus.js";
import { solutionSelectionSummary } from "./solution-selection-summary.js";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const value = (number: unknown) => typeof number === "number" && Number.isFinite(number) ? String(Number(number.toPrecision(10))) : "未提供";

/** 仅呈现记录内冻结的层、公式与参数，不重算、不从模型答案取工程值。 */
export function renderCalculationRecord(candidate: ReferenceLookupCandidate) {
  const input = candidate.inputSnapshot ?? {}, result = candidate.resultSnapshot ?? {}, source = candidate.provenanceSnapshot ?? {};
  const rule = object(source.rule), layers = Array.isArray(source.layers) ? source.layers.map(object) : [];
  const steps = Array.isArray(source.steps) ? source.steps.map(object) : [];
  const layered = input.mode === "LAYERED";
  const lines = [`${candidate.schemeCode ?? "正式构造"}，${layered ? "分层法" : "整体当量法"}。本次输入作用于唯一产品层：${value(input.thicknessMm)}mm。`,
    `计算规则 ${String(rule.code ?? "未提供")}，规则版本 ${String(rule.version ?? "未提供")}，公式版本 ${String(rule.formulaVersion ?? "未提供")}。`,
    ["| 构造层 | 厚度 mm | λ W/(m·K) | α | R m²·K/W | 参数来源 |", "| --- | ---: | ---: | ---: | ---: | --- |",
      ...layers.map(layer => `| ${String(layer.layerName ?? "未提供")} | ${value(typeof layer.thicknessM === "number" ? layer.thicknessM * 1000 : undefined)} | ${value(layer.lambda)} | ${value(layer.correctionFactor)} | ${value(steps.find(step => step.key === `layer_${String(layer.layerOrder)}`)?.value)} | ${String(layer.evidenceSource ?? "未提供")} · ${String(layer.evidenceRef ?? "未提供")} |`)].join("\n"),
    layered ? "各材料层按 Rᵢ=δᵢ/(λᵢ×αᵢ)；产品层行热阻仅覆盖该行，包覆及其他层分别计入整构造。" : "产品层按已发布当量参数计算，其余层按各自材料参数计算。",
    `产品层行热阻 R=${value(result.productResistance)} m²·K/W；整构造总热阻 R=${value(result.totalResistance)} m²·K/W；K=${value(result.kValue)} W/(m²·K)。`,
    ...steps.filter(step => step.key === "total_resistance" || step.key === "k_value").map(step => `${String(step.label)}：${String(step.formula)} = ${value(step.value)}。`),
    `表面热阻：内表面 ${value(rule.interiorSurfaceResistance)}、外表面 ${value(rule.exteriorSurfaceResistance)} m²·K/W；${rule.includeSurfaceResistances === true ? "本次已计入" : rule.includeSurfaceResistances === false ? "本次未计入" : "冻结记录未说明是否计入"}。`,
    `${result.valid === true ? "本次计算必需参数齐全，计算参数及来源已随记录冻结。" : "请按冻结记录核对计算参数及缺项。"}未指定适用标准，不判断达标；如需改变基层或其他层，应先明确对应的正式模型。`];
  return lines.join("\n\n");
}

/** 正常聊天与工具共用。语义只申请计算，服务负责模型身份、层角色、继承及执行。 */
export async function calculateConversationModel(ctx: ReferenceReadContext) {
  const decision = ctx.domainDecision, proposed = decision?.semantic?.calculationRequest;
  const reject = (answer: string): { answer: string; valid: boolean; calculationId?: string } => ({ answer, valid: false });
  if (!proposed || decision.intent !== "THERMAL_CALCULATE" || decision.mutation !== "CALCULATE")
    return reject("请明确计算方法、已发布构造和要调整的层厚度。");
  const conversation = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  if (conversation.projectId !== ctx.conversation.projectId) return reject("会话所属项目已变化，请重新选择计算模型。");
  let inherited: ReferenceLookupCandidate | undefined;
  if (decision.semantic?.relation === "CONTINUE" || decision.semantic?.relation === "REFINE") {
    const lookup = ctx.taskState?.lastReferenceLookup;
    const records = lookup?.candidates.filter(item => item.sourceType === "CALCULATED") ?? [];
    const age = Date.now() - Date.parse(lookup?.createdAt ?? "");
    if (lookup?.projectId === conversation.projectId && lookup.candidateQueryRevision && !lookup.candidateResultInvalid
      && age >= -60_000 && age <= 24 * 3600_000 && records.length === 1
      && await referenceRowsStillCurrent(ctx.app.db, records, { userId: ctx.user.id, projectId: conversation.projectId })) inherited = records[0];
  }
  const previous = inherited?.inputSnapshot;
  const schemeId = proposed.schemeId ?? (typeof previous?.schemeId === "string" ? previous.schemeId : undefined);
  const specId = proposed.productSpecId ?? (typeof previous?.productSpecId === "string" ? previous.productSpecId : undefined);
  const mode = proposed.mode ?? (previous?.mode === "LAYERED" || previous?.mode === "EQUIVALENT" ? previous.mode : undefined);
  const thicknessMm = proposed.thicknessMm ?? (typeof previous?.thicknessMm === "number" ? previous.thicknessMm : undefined);
  if (!schemeId || !mode || thicknessMm == null) {
    const history = ctx.taskState?.lastReferenceLookup?.candidates.length ? await readReferenceFactHistory(ctx.app, ctx.conversation.id) : [];
    const focusedIds = currentReferenceFocus(history, ctx.conversation, ctx.taskState?.lastReferenceLookup);
    const focused = ctx.taskState?.lastReferenceLookup?.candidates.filter(candidate => focusedIds.includes(candidate.id)) ?? [];
    if (focused.length === 1 && await referenceRowsStillCurrent(ctx.app.db, focused, { userId: ctx.user.id, projectId: ctx.conversation.projectId }))
      return reject(`前面查到的参考做法是：\n${solutionSelectionSummary(focused, false)}\n要核算调整后的效果，还需对应到本次使用的正式计算模型和厚度作用层；板材总厚与芯材厚不能直接替用。目前还不能给出新的计算值，可以先核对该做法是否有对应厚度的参考档位。`);
    return reject("还缺少可唯一定位的已发布构造、计算方法或目标层厚度，请补充这些条件后计算。");
  }
  const model = await getPublishedConstructionSchemeDetail(ctx.app.db, schemeId).catch(() => null);
  if (!model) return reject("该计算模型目前未发布或已失效，请重新选择有效构造。");
  const modelFingerprint = createHash("sha256").update(JSON.stringify([model.id, model.version, model.layers, model.productOptions])).digest("hex");
  if (inherited && inherited.provenanceSnapshot?.modelFingerprint !== modelFingerprint)
    return reject("上次计算后构造层或产品选项已变化，不能直接沿用‘其他层不变’；请核对当前模型后重新发起计算。");
  if (inherited) {
    const rule = object(inherited.provenanceSnapshot?.rule);
    const [currentRule] = typeof rule.code === "string" ? await ctx.app.db.select().from(thermalCalcRules)
      .where(and(eq(thermalCalcRules.code, rule.code), ...publishedReferenceConditions(thermalCalcRules))).orderBy(desc(thermalCalcRules.version)).limit(1) : [];
    if (!currentRule || currentRule.id !== rule.id || currentRule.version !== rule.version)
      return reject("上次计算的规则已换版或失效，请先核对规则后重新计算，不能静默继承新的计算口径。");
    const parameters = Array.isArray(inherited.provenanceSnapshot?.parameters) ? inherited.provenanceSnapshot.parameters.map(object) : [];
    for (const parameter of parameters.filter(item => typeof item.materialId === "string")) {
      const current = (await resolveMaterialFacts(ctx.app.db, { materialId: parameter.materialId as string }))[0];
      if (!current || current.id !== parameter.id || current.version !== parameter.version || current.thermalConductivity !== parameter.thermalConductivity
        || current.correctionFactor !== parameter.correctionFactor)
        return reject("上次计算的材料参数已换版或失效，需要先核对新参数，不能将这次结果称为仅改变芯材厚度。");
    }
    for (const parameter of parameters.filter(item => item.source === "CATALOG")) {
      const [current] = typeof parameter.id === "string" ? await ctx.app.db.select().from(catalogProducts)
        .where(and(eq(catalogProducts.id, parameter.id), eq(catalogProducts.status, "ACTIVE"))).limit(1) : [];
      if (!current || current.thermalConductivity !== parameter.thermalConductivity || current.correctionFactor !== parameter.correctionFactor)
        return reject("上次使用的产品当量参数已变化，需要先核对参数后重新计算。");
    }
    if (parameters.some(parameter => !parameter.materialId && parameter.source !== "CATALOG"))
      return reject("上次当量参数还需重新核验来源版本，请明确当前模型及计算条件后重新计算。");
  }
  if (!await getPublishedInsulationSystem(ctx.app.db, model.systemId)) return reject("该模型所属保温体系未发布或已失效，当前不能用于正式计算。");
  const productLayers = model.layers.filter(layer => layer.layerType === "PRODUCT_LAYER");
  const target = proposed.targetLayerId ?? (inherited && previous?.schemeId === schemeId ? productLayers[0]?.id : undefined);
  if (productLayers.length !== 1 || !target || target !== productLayers[0]!.id)
    return reject("当前公式只支持调整唯一产品层的厚度。请明确芯材层或产品层，不能将复合板总厚直接套入某一子层。");
  const productSpecId = specId ?? (model.productOptions.length === 1 ? model.productOptions[0]!.productSpecId : undefined);
  if (!productSpecId) return reject("该构造存在多个产品选项，请先指定正式规格。");
  const [spec] = await ctx.app.db.select().from(productSpecs).where(and(eq(productSpecs.id, productSpecId), ...publishedReferenceConditions(productSpecs))).limit(1);
  if (!spec) return reject("该产品规格未发布或已失效，当前不能用于正式计算。");
  if (decision.semantic?.complianceCheck?.required) return reject("本次计算还要求合规判断，需要先核验地区、建筑类型及适用的正式标准。可以补充条件后继续。");
  const execution = await executeThermalCalc(ctx.app, ctx.request, ctx.user, { mode, schemeId, productSpecId, thicknessMm, projectId: conversation.projectId });
  if (!execution.valid || !execution.record) return reject(execution.errors.map(error => error.message).join("\n") || "当前条件不足以完成正式计算。");
  const candidates = await loadCalculatedCandidates(ctx, execution.record.id);
  candidates.forEach(candidate => { candidate.provenanceSnapshot = { ...candidate.provenanceSnapshot, modelFingerprint, targetLayerId: target }; });
  // 新结果替换本轮计算上下文，旧记录保留；不替用户设置Final或确认。
  await publishCandidateResult({ ...ctx, candidatePublication: "READ_ONLY_ADVICE" }, {
    query: { intent: "THERMAL", schemeId, productSpecId, thicknessMm, filters: [] }, candidates, createdAt: new Date().toISOString() });
  return { answer: renderCalculationRecord(candidates[0]!), valid: true, calculationId: execution.record.id };
}

/** 仅本人同项目的实际记录可解释；确认来源仍由调用方重验。 */
export async function readCalculationDetails(ctx: ReferenceReadContext, candidate: ReferenceLookupCandidate) {
  if (!candidate.calculationId) return undefined;
  const [record] = await ctx.app.db.select().from(thermalCalcRecords).where(and(eq(thermalCalcRecords.id, candidate.calculationId), eq(thermalCalcRecords.createdById, ctx.user.id))).limit(1);
  return record && record.projectId === ctx.conversation.projectId ? renderCalculationRecord(candidate) : undefined;
}

export async function readConversationCalculation(ctx: ReferenceReadContext) {
  await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  const lookup = ctx.taskState?.lastReferenceLookup;
  const age = Date.now() - Date.parse(lookup?.createdAt ?? "");
  const candidates = lookup?.candidates.filter(candidate => candidate.sourceType === "CALCULATED") ?? [];
  if (!lookup?.candidateQueryRevision || lookup.projectId !== ctx.conversation.projectId || lookup.candidateResultInvalid
    || !Number.isFinite(age) || age < -60_000 || age > 24 * 3600_000 || candidates.length !== 1
    || !await referenceRowsStillCurrent(ctx.app.db, candidates, { userId: ctx.user.id, projectId: ctx.conversation.projectId }))
    return { answer: "当前没有可核验的最近计算记录，请先指定本次计算；不会从旧话题补入参数。" };
  return { answer: await readCalculationDetails(ctx, candidates[0]!) ?? "该计算记录已不可读取，请重新核对来源。" };
}
