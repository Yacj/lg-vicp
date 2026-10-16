import { querySelectedKnowledgeCandidates, readConsumableReferencePages, referencePageLocators, toReferencePageBlock } from "./ai-reference-pages.service.js";
import { assertSolutionAccess } from "./solution-state.service.js";
import { readReferenceFactHistory, historyMentionStatus } from "./reference-fact-history.js";
import { constructionCodes } from "./reference-candidate-selection.js";
import { requestedSpecClasses } from "./ai-knowledge-load.js";
import { extractSemanticFacts } from "./thermal-answer-semantics.js";
import { bindReferencePageMatch, type ReferencePageBlock } from "./reference-page.js";
import { buildAllowedAnswerFacts } from "./thermal-answer-validation.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import type { WikiHit } from "../knowledge/knowledge.service.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";
import { verifyVisibleConfirmedPageFact } from "./confirmed-page-fact-verify.js";

const metricKey = { K: "kValue", TOTAL_R: "totalThermalResistance", PRODUCT_R: "productThermalResistance" } as const;
const metricLabel = { K: "K", TOTAL_R: "总热阻 R₀", PRODUCT_R: "产品层热阻 R" };
/** 同一指标、同一已确认记录集合上的纯数值关系；不作等效替换或合规判断。 */
export function compareReferenceNumbers(a: ReferenceLookupCandidate, b: ReferenceLookupCandidate, metric: keyof typeof metricKey) {
  const left = a[metricKey[metric]], right = b[metricKey[metric]];
  if (typeof left !== "number" || !Number.isFinite(left) || typeof right !== "number" || !Number.isFinite(right)) return "该指标缺失，无法比较。";
  return `${metricLabel[metric]}：${left.toFixed(3)} ${left > right ? ">" : left < right ? "<" : "="} ${right.toFixed(3)}。`;
}

/** 只读事实查询不发布候选，不写QueryState、SolutionState、Snapshot或Report。 */
export async function resolveReferenceFactRead(ctx: ReferenceReadContext, hits: readonly WikiHit[]) {
  const request = ctx.domainDecision?.semantic?.factRead;
  if (!request || ctx.domainDecision?.mutation !== "NONE") return undefined;
  const session = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  const respond = (answer: string, candidates: ReferenceLookupCandidate[] = [], pages: ReferencePageBlock[] = [], code = "FACT_IDENTITY_REQUIRED") => {
    const sources = pages.map(page => ({ documentId: page.page.documentId, pageId: page.page.pageId, title: page.page.documentTitle, pageLabel: page.page.pageLabel }));
    const facts = buildAllowedAnswerFacts({}, candidates); facts.canonicalAnswers = [answer];
    return { facts, candidates, sources, referencePages: pages, readOnly: true as const, needsClarification: !candidates.length, validationCode: code };
  };
  if (session.projectId !== ctx.conversation.projectId) return respond("会话所属项目已变化，请重新查询。");
  if (request.mode === "DEFINE") {
    const result = respond("材料层或保温芯层的热阻只描述该层；产品整体热阻描述完整产品，必须有独立来源证据；整构造传热阻描述整套构造。它们不是同一个指标。仅有保温层厚度不能确定产品整体热阻或整构造传热阻，不能把芯层数值互填，也不能自行相加补算。原表未单独给出产品整体热阻时，应明确标注未给出；原表的 R 符号和单位按来源保留。", [], [], "THERMAL_METRIC_DEFINITION");
    result.facts.canonicalAnswers[0] += "传热系数 K 表示构造的传热能力，与热阻是不同指标，不能互换名称和单位。这里仅说明概念，不核验某一厚度的数值。";
    return { ...result, needsClarification: false };
  }
  const lookup = ctx.taskState?.lastReferenceLookup;
  if (ctx.candidateQueryRevision != null && ctx.candidateQueryRevision !== lookup?.candidateQueryRevision
    || ctx.domainDecision.semantic?.reference.revision != null && ctx.domainDecision.semantic.reference.revision !== lookup?.candidateQueryRevision)
    return respond("候选列表已变化，请重新指定当前来源。");
  const history = await readReferenceFactHistory(ctx.app, ctx.conversation.id);
  const message = ctx.userMessage ?? "";
  let codes = [...new Set(constructionCodes(message))];
  if (request.mode === "VERIFY" && !codes.length) {
    const verified = await verifyVisibleConfirmedPageFact(ctx, history, request.metric);
    if (verified) return { ...respond(verified.answer, [], verified.pages, verified.code), needsClarification: verified.needsClarification };
  }
  const prefix = request.historyClaim && codes.length ? codes.map(code => historyMentionStatus(code, history)
    ? `当前会话先前的助手回答提到过 ${code}；以下重新核验资料。`
    : `在当前可核验的会话记录中，助手此前未提到 ${code}。下面按独立资料查询说明。`).join("\n") + "\n" : "";
  // 核对省略的构造仅可来自最近一次实际助手回答中的唯一编码；不从待核对数字反选身份。
  if (!codes.length && request.mode === "VERIFY") {
    const prior = history.find(row => constructionCodes(row.content).length);
    codes = [...new Set(prior ? constructionCodes(prior.content) : [])];
  }
  const specs = requestedSpecClasses(message);
  if (request.mode !== "COMPARE" && codes.length !== 1) return respond(prefix + "请补充要核对的构造编号；若已有多个构造，还需明确对应来源和保温板厚度。");
  const recentLocators = history.flatMap(row => Date.now() - row.createdAt.getTime() <= 24 * 3600_000 ? referencePageLocators(row.metadata) : []);
  const currentScope = lookup && !lookup.candidateResultInvalid && lookup.projectId === session.projectId
    && Date.now() - Date.parse(lookup.createdAt) <= 24 * 3600_000 ? lookup.query : undefined;
  // 新的独立查询只用本轮已授权检索命中；省略核对只能使用会话已消费来源，不宽查。
  const useHistory = request.mode === "VERIFY" && !constructionCodes(message).length;
  const historyRows = useHistory ? await readConsumableReferencePages(ctx.app, recentLocators.map(item => item.pageId), session.projectId) : [];
  const documentIds = useHistory ? historyRows.map(row => row.document.id) : hits.map(hit => hit.documentId);
  const versionIds = useHistory ? historyRows.map(row => row.version.id) : hits.map(hit => hit.versionId);
  const query = { documentIds: [...new Set(documentIds.length ? documentIds : currentScope?.documentIds ?? [])],
    knowledgeVersionIds: [...new Set(versionIds.length ? versionIds : currentScope?.knowledgeVersionIds ?? [])], filters: [] };
  if (!query.documentIds.length || !query.knowledgeVersionIds.length) return respond(prefix + "缺少当前有权访问的确认来源，请指定原构造及资料页后核对。");
  const all = await querySelectedKnowledgeCandidates(ctx.app, query, session.projectId);
  let candidates = all.filter(candidate => (!codes.length || codes.some(code => constructionCodes(candidate.constructionCode ?? candidate.schemeCode ?? "").some(value => value === code)))
    && (!specs.length || specs.some(item => item.specClass === candidate.specClass)));
  const numbers = extractSemanticFacts(message);
  const thicknesses = [...new Set(numbers.flatMap(fact => fact.kind === "thickness" ? [fact.value] : []))];
  if (thicknesses.length) candidates = candidates.filter(candidate => thicknesses.some(value => value === candidate.thicknessMm));
  if (request.mode === "COMPARE") {
    if (specs.length < 2) return respond("请明确要比较的两个型号及指标，不能用不同指标或未确认的芯材属性替代。");
    const groups = specs.map(item => candidates.filter(candidate => candidate.specClass === item.specClass));
    if (groups.some(group => !group.length)) return respond("当前同一授权资料范围未找到每个型号的确认记录，无法完成数值比较；不能补造芯材属性。");
    // 一般型号比较优先取同基层、同厚度的记录；指定多个厚度时必须逐型号唯一，否则澄清。
    const first = groups[0]!.find(a => groups.slice(1).every(group => group.some(b => b.sourceVersionId === a.sourceVersionId
      && b.substrateMaterial === a.substrateMaterial && b.substrateThickness === a.substrateThickness
      && (thicknesses.length > 1 || b.thicknessMm === a.thicknessMm))));
    if (!first) return respond("缺少同版本、同基层且厚度可明确对应的记录，无法建立可比条件；请指定构造和厚度。");
    const matched = groups.map(group => group.filter(item => item.sourceVersionId === first.sourceVersionId
      && item.substrateMaterial === first.substrateMaterial && item.substrateThickness === first.substrateThickness
      && (thicknesses.length > 1 || item.thicknessMm === first.thicknessMm)));
    // 两型号各自的厚度由其独立工程片段约束，不以R值反选。
    if (thicknesses.length > 1) {
      for (let i = 0; i < specs.length; i++) {
        const start = message.indexOf(specs[i]!.term), end = i + 1 < specs.length ? message.indexOf(specs[i + 1]!.term) : message.length;
        const local = extractSemanticFacts(message.slice(start, end)).filter(fact => fact.kind === "thickness");
        matched[i] = matched[i]!.filter(candidate => local.length === 1 && candidate.thicknessMm === local[0]!.value);
      }
    }
    if (matched.some(group => group.length !== 1)) return respond("每个型号还对应多个构造来源，请指定构造编号和厚度后比较。");
    candidates = matched.map(group => group[0]!);
  } else {
    const identities = new Set(candidates.map(item => `${item.sourceVersionId}:${item.schemeId}`));
    if (identities.size > 1) return respond(prefix + "该构造编号在当前资料中对应多个构造，请补充体系或来源页，不能任选版本。");
  }
  if (!candidates.length) return respond(prefix + "当前确认资料没有对应构造/厚度档位，无法核验该数值。");
  const rows = await readConsumableReferencePages(ctx.app, candidates.flatMap(item => item.sourcePageId ? [item.sourcePageId] : []), session.projectId);
  const pages: ReferencePageBlock[] = [];
  for (const candidate of candidates) {
    const row = rows.find(row => row.page.id === candidate.sourcePageId && row.page.versionId === candidate.sourceVersionId && row.page.documentId === candidate.sourceDocumentId);
    if (!row) return respond(prefix + "来源已撤回、换版或无权访问，请重新指定来源。");
    let page = pages.find(page => page.page.pageId === row.page.id);
    if (!page) { page = await toReferencePageBlock(ctx.app, row); pages.push(page); }
    const match = bindReferencePageMatch(candidate, { ...page.page, renderModel: page.renderModel });
    if (!match || match.optionId !== candidate.optionId) return respond(prefix + "确认档位已变化，不能沿用旧引用。");
    page.matches.push(match);
  }
  const display = candidates.map(candidate => buildAllowedAnswerFacts({}, [candidate], "详细参数").canonicalAnswers[0]!.split("\n").slice(1, -1).join("\n")).join("\n");
  let conclusion = "";
  if (request.mode === "COMPARE") {
    const metric = request.metric ?? "PRODUCT_R";
    conclusion = compareReferenceNumbers(candidates[0]!, candidates[1]!, metric)
      + "比较的是图集记录中的同种指标，型号及厚度见下；产品层R不等于芯材R。不同厚度或构造层次不代表同厚度性能、可替换性或工程达标。未核实的芯材组成、价格及寿命不作推断。\n";
  } else if (request.mode === "VERIFY") {
    const metric = request.metric;
    const claims = numbers.filter(fact => fact.kind === "metric" && fact.metric === metric);
    if (!metric || claims.length !== 1) return respond(prefix + "请明确要核对的指标及数值。");
    const claimFact = claims[0]!;
    if (claimFact.kind !== "metric") return respond(prefix + "请明确要核对的指标及数值。");
    const claim = claimFact.value;
    const matching = candidates.filter(item => item[metricKey[metric]] === claim);
    conclusion = matching.length ? `${metricLabel[metric]}=${claim} 与确认记录一致，对应保温板厚度 ${matching.map(item => item.thicknessMm).join("、")}mm。`
      : `${metricLabel[metric]}=${claim} 与当前指定构造/厚度的确认记录不一致，请以下表为准。`;
    if (!thicknesses.length) conclusion += "本轮没有指定板厚，仅核对表中对应关系，不认定为已选档位。";
    conclusion += "这是资料事实核对，未确认正式方案。\n";
  }
  return respond(prefix + conclusion + display, candidates, pages, "CONFIRMED_FACT_READ");
}
