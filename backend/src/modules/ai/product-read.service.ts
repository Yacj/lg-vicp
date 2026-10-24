import { and, asc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { catalogProducts, knowledgeAliases, knowledgeDocuments, knowledgeDocumentVersions, knowledgePages, productKnowledgeLinks, productSpecs } from "../../db/schema.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { normalizeEntityText } from "../thermal/thermal-query-state.js";
import { resolveQueryEntities, type QueryEntity } from "../thermal/thermal-entity-resolver.js";
import { assertSolutionAccess } from "./solution-state.service.js";
import { isReferencePageConsumable } from "./reference-page-access.js";
import { buildProductAnswerFacts, formatProductFactsAnswer, type ProductKnowledgeFamily, type ProductAnswerFacts } from "./product-answer.js";
import { readPageRecognitionMeta } from "../../shared/page-recognition.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { visiblePageLabel } from "../../shared/page-label.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import { previousProductQueryContext, previousProductNameSuggestion } from "./product-consultation-context.js";
import { readProductKnowledgeItems, groupProductKnowledgeItems } from "./product-knowledge-facts.js";
import { buildProductParameterFocus, resolveProductParameterFocus, parameterComparisonMatches, filterKnowledgeByParameter, productContinuationTarget } from "./product-parameter-focus.js";
import { readReferenceFactHistory } from "./reference-fact-history.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { approvedCatalogAliases, suggestCatalogNames } from "../products/product-identity-approvals.js";
import { readConsumableReferencePages, toReferencePageBlock } from "./ai-reference-pages.service.js";
export interface ProductSearchInput { keyword?: string; productType?: string; specClass?: "I"|"II"|"III"; productIds?: string[]; limit?: number }

/** 正式产品SEARCH/READ共用来源，只返回ACTIVE目录及已发布规格/当前有权资料。 */
export async function searchProductCatalog(ctx: ReferenceReadContext, input: ProductSearchInput = {}) {
  const conversation = await assertSolutionAccess(ctx.app.db,ctx.user,ctx.conversation.id);
  if (conversation.projectId !== ctx.conversation.projectId) throw new Error("会话项目已变化");
  for (const word of [input.keyword,input.productType].filter((item):item is string=>!!item))
    if (!normalizeEntityText(ctx.userMessage??"").includes(normalizeEntityText(word))) throw new Error("产品搜索条件须来自本轮用户原话");
  if (input.specClass && resolveQueryEntities(ctx.userMessage??"",{},[{field:"specClass",value:input.specClass,names:[input.specClass,`${input.specClass}型`]}]).specClass !== input.specClass)
    throw new Error("产品型号须来自本轮用户原话");
  const limit=Math.min(Math.max(input.limit??12,1),24);
  const matchingSpecs=input.specClass ? await ctx.app.db.select({catalogProductId:productSpecs.catalogProductId}).from(productSpecs)
    .where(and(eq(productSpecs.specClass,input.specClass),...publishedReferenceConditions(productSpecs))) : [];
  const literal=input.keyword?.replace(/[\\%_]/g,"\\$&");
  const rows=await ctx.app.db.select().from(catalogProducts).where(and(eq(catalogProducts.status,"ACTIVE"),
    input.productIds ? inArray(catalogProducts.id,input.productIds) : undefined,
    input.productType ? eq(catalogProducts.productType,input.productType) : undefined,
    input.specClass ? or(eq(catalogProducts.specClass,input.specClass),inArray(catalogProducts.id,matchingSpecs.flatMap(spec=>spec.catalogProductId?[spec.catalogProductId]:[]))) : undefined,
    literal ? or(ilike(catalogProducts.name,`%${literal}%`),ilike(catalogProducts.productType,`%${literal}%`),ilike(catalogProducts.summary,`%${literal}%`)) : undefined))
    .orderBy(asc(catalogProducts.sortOrder),asc(catalogProducts.id)).limit(limit+1);
  const visible=rows.slice(0,limit),ids=visible.map(item=>item.id);
  const specifications=ids.length ? await ctx.app.db.select().from(productSpecs).where(and(inArray(productSpecs.catalogProductId,ids),...publishedReferenceConditions(productSpecs))) : [];
  const links=ids.length ? await ctx.app.db.select({productId:productKnowledgeLinks.productId,document:knowledgeDocuments,version:knowledgeDocumentVersions})
    .from(productKnowledgeLinks).innerJoin(knowledgeDocuments,eq(productKnowledgeLinks.knowledgeDocumentId,knowledgeDocuments.id))
    .innerJoin(knowledgeDocumentVersions,and(eq(knowledgeDocumentVersions.id,knowledgeDocuments.currentVersionId),eq(knowledgeDocumentVersions.documentId,knowledgeDocuments.id)))
    .where(and(inArray(productKnowledgeLinks.productId,ids),conversation.projectId ? or(isNull(knowledgeDocuments.projectId),eq(knowledgeDocuments.projectId,conversation.projectId)) : isNull(knowledgeDocuments.projectId))) : [];
  const readable=links.filter(({document,version})=>isReferencePageConsumable({versionId:version.id,versionStatus:version.status,usageMode:version.usageMode,
    documentStatus:document.status,documentDeletedAt:document.deletedAt,currentVersionId:document.currentVersionId,effectiveDate:version.effectiveDate,expiryDate:version.expiryDate,projectId:document.projectId},undefined,conversation.projectId));
  const products=visible.map(item=>({id:item.id,name:item.name,summary:item.summary,productType:item.productType,specClass:item.specClass,
    thermalConductivity:item.thermalConductivity,correctionFactor:item.correctionFactor,thicknessOptionsMm:item.thicknessOptionsMm,
    specifications:specifications.filter(spec=>spec.catalogProductId===item.id).map(spec=>({id:spec.id,specCode:spec.specCode,specClass:spec.specClass,thicknessMm:spec.thicknessMm,lengthMm:spec.lengthMm,widthMm:spec.widthMm,combustionGrade:spec.combustionGrade,supplyRegions:spec.supplyRegions})),
    knowledgeDocumentIds:readable.filter(link=>link.productId===item.id).map(link=>link.document.id)}));
  return {products,hasMore:rows.length>limit,sources:readable.map(link=>({documentId:link.document.id,versionId:link.version.id,title:link.document.title}))};
}

export interface ProductKnowledgeIndex {
  families: ProductKnowledgeFamily[];
  sources: Array<{ documentId: string; versionId: string; title: string; pageId: string; pageLabel: string | null }>;
  pageCount: number;
}

/**
 * 产品问答的补充事实源：只读已确认/已发布知识页，按原表标题与产品层名称归纳构造系统/产品族。
 * 目录只作 SKU 补充，不能用目录条数推断甲方产品全集。
 */
export async function readProductKnowledgeFamilies(ctx: ReferenceReadContext, queryText?: string): Promise<ProductKnowledgeIndex> {
  const conversation = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  if (conversation.projectId !== ctx.conversation.projectId) throw new Error("会话项目已变化");
  const visibleProject = conversation.projectId ? or(isNull(knowledgeDocuments.projectId), eq(knowledgeDocuments.projectId, conversation.projectId)) : isNull(knowledgeDocuments.projectId);
  const rows = await ctx.app.db.select({ page: knowledgePages, document: knowledgeDocuments, version: knowledgeDocumentVersions })
    .from(knowledgePages)
    .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgePages.documentId))
    .innerJoin(knowledgeDocumentVersions, and(eq(knowledgeDocumentVersions.id, knowledgePages.versionId),
      eq(knowledgeDocumentVersions.id, knowledgeDocuments.currentVersionId), eq(knowledgeDocumentVersions.documentId, knowledgeDocuments.id)))
    .where(and(eq(knowledgeDocuments.status, "ACTIVE"), isNull(knowledgeDocuments.deletedAt),
      eq(knowledgeDocumentVersions.status, "PUBLISHED"), eq(knowledgeDocumentVersions.usageMode, "AI_ENABLED"), visibleProject));
  const q = normalizeEntityText(queryText ?? "").replace(/产品|系列|型号/g, "");
  const families = new Map<string, { family: ProductKnowledgeFamily; source: ProductKnowledgeIndex["sources"][number] }>();
  for (const row of rows) {
    if (!isReferencePageConsumable({ versionId: row.version.id, versionStatus: row.version.status, usageMode: row.version.usageMode,
      documentStatus: row.document.status, documentDeletedAt: row.document.deletedAt, currentVersionId: row.document.currentVersionId,
      effectiveDate: row.version.effectiveDate, expiryDate: row.version.expiryDate, projectId: row.document.projectId }, undefined, conversation.projectId)) continue;
    const data = readPageRecognitionMeta(row.page.metadata).confirmedStructuredData;
    const model = data ? (() => { try { return buildKnowledgePageRenderModel(row.page.id, data); } catch { return null; } })() : null;
    const title = row.page.pageTitle ?? data?.pageTitle ?? "";
    const familyName = /（([^）]{4,80})）/.exec(title)?.[1]?.trim() ?? "";
    const layerNames = [...new Set((model?.constructions ?? []).flatMap(construction => construction.layers
      .map(layer => layer.name).filter(name => /vicp|真空绝热|复合保温/i.test(name))))].slice(0, 8);
    if (!familyName && !layerNames.length) continue;
    const name = familyName || layerNames[0]!;
    if (q && !normalizeEntityText(name).includes(q) && !layerNames.some(layer => normalizeEntityText(layer).includes(q))) continue;
    const key = normalizeEntityText(name);
    const source = { documentId: row.document.id, versionId: row.version.id, title: row.document.title,
      pageId: row.page.id, pageLabel: visiblePageLabel(row.page) };
    const existing = families.get(key);
    if (existing) { existing.family.pageCount += 1; existing.family.layerNames = [...new Set([...existing.family.layerNames, ...layerNames])].slice(0, 8); }
    else families.set(key, { family: { name, pageCount: 1, layerNames }, source });
  }
  const ordered = [...families.values()].sort((a, b) => b.family.pageCount - a.family.pageCount).slice(0, 12);
  return { families: ordered.map(item => item.family), sources: ordered.map(item => item.source), pageCount: rows.length };
}

const AFFIRMATIVE_REPLIES = new Set(["是的", "是", "对", "对的", "没错", "确认", "好", "可以", "嗯", "是的介绍"]);
function isAffirmativeReply(text: string) {
  return AFFIRMATIVE_REPLIES.has(normalizeEntityText(text).replace(/[。！!？?，,、\s]/g, ""));
}

/** 无ID首问通过正式名称/类型/后台别名检索；详情不能擅自用全目录代替。 */
export async function resolveProductConsultation(ctx: ReferenceReadContext) {
  const session = await assertSolutionAccess(ctx.app.db,ctx.user,ctx.conversation.id);
  if (session.projectId !== ctx.conversation.projectId) throw new Error("会话项目已变化");
  const productContext = ctx.domainDecision?.productContextMessageId
    ? previousProductQueryContext(await readReferenceFactHistory(ctx.app, ctx.conversation.id), ctx.conversation) : undefined;
  if (ctx.domainDecision?.productContextMessageId) {
    if (!productContext || productContext.messageId !== ctx.domainDecision.productContextMessageId || !ctx.domainDecision.semantic
      || applyDomainPolicy(ctx.userMessage ?? "", ctx.domainDecision.semantic, ctx.taskState, { productQuery: productContext.query }).intent === "CLARIFY")
      throw new Error("上次产品读取目标已失效，请重新说明产品名称");
  }
  const index=await ctx.app.db.select().from(catalogProducts).where(eq(catalogProducts.status,"ACTIVE")).orderBy(asc(catalogProducts.sortOrder),asc(catalogProducts.id)).limit(501);
  const configuredAliases=await ctx.app.db.select({term:knowledgeAliases.term,alias:knowledgeAliases.alias}).from(knowledgeAliases).where(and(eq(knowledgeAliases.enabled,true),eq(knowledgeAliases.scope,"GLOBAL")));
  const aliases=[...configuredAliases,...approvedCatalogAliases(index)];
  const productQuery=ctx.domainDecision?.semantic?.productQuery;
  const continuation = ctx.domainDecision?.semantic?.productContinuation;
  const lookupText = ctx.domainDecision?.productContextMessageId ? productQuery?.entityText ?? ctx.userMessage ?? "" : ctx.userMessage ?? "";
  const text=normalizeEntityText(lookupText);
  const named=index.filter(item=>[item.name,...aliases.filter(alias=>normalizeEntityText(alias.term)===normalizeEntityText(item.name)).map(alias=>alias.alias)]
    .some(name=>productQuery?.scope === "IDENTITY" ? normalizeEntityText(name)===normalizeEntityText(productQuery.entityText??"")
      : normalizeEntityText(name).length>=2&&text.includes(normalizeEntityText(name))));
  const types=[...new Set(index.flatMap(item=>item.productType&&text.includes(normalizeEntityText(item.productType))?[item.productType]:[]))];
  const entities:QueryEntity[]=["I","II","III"].map(value=>({field:"specClass",value,names:[`${value}型`,`${{I:"Ⅰ",II:"Ⅱ",III:"Ⅲ"}[value as "I"|"II"|"III"]}型`]}));
  const specClass=resolveQueryEntities(lookupText,{},entities).specClass;
  const needIdentity=continuation?.action !== "FIND_OTHERS" && productQuery?.scope !== "CATALOG" && (ctx.domainDecision?.intent==="PRODUCT_DETAIL" || productQuery?.scope === "IDENTITY"
    || !!ctx.domainDecision?.semantic && !productQuery);
  const unknownIdentity=needIdentity&&!named.length && (productQuery?.scope === "IDENTITY" || !types.length&&!specClass);
  const unknownCategory=productQuery?.scope === "CATEGORY" && !types.some(type=>normalizeEntityText(type)===normalizeEntityText(productQuery.entityText??""));
  const ambiguous=types.length>1||index.length>500||productQuery?.scope === "IDENTITY" && named.length>1;
  // 上一轮已给出“你是不是想了解 X”的唯一建议，本轮明确肯定时绑定该产品；否定/换一个不绑定。
  const history = named.length ? [] : (await readReferenceFactHistory(ctx.app, ctx.conversation.id)) ?? [];
  const suggestion = previousProductNameSuggestion(history, ctx.conversation);
  const suggested = suggestion ? index.filter(item => item.name === suggestion.name) : [];
  const accepted = !named.length && isAffirmativeReply(normalizeEntityText(ctx.userMessage ?? "")) && suggested.length === 1 ? suggested[0] : undefined;
  const effectiveNamed = accepted ? [accepted] : named;
  const unresolvedIdentity = ambiguous || unknownIdentity || unknownCategory;
  let data=unresolvedIdentity && !accepted ? {products:[],sources:[],hasMore:false} : await searchProductCatalog(ctx,{productIds:effectiveNamed.length?effectiveNamed.map(item=>item.id):undefined,
    productType:types[0],specClass,limit:12});
  let needsClarification=unresolvedIdentity && !accepted;
  const suggestions = unknownIdentity && !accepted && productQuery?.entityText ? suggestCatalogNames(productQuery.entityText,index,aliases) : [];
  // 目录只作 SKU 补充；产品/系列介绍必须同时读已确认知识库的构造系统与产品层名称。
  const knowledge = await readProductKnowledgeFamilies(ctx, productQuery?.entityText ?? text)
    .catch(() => ({ families: [], sources: [], pageCount: 0 }));
  const knowledgeEntity = accepted?.name ?? productQuery?.entityText ?? (effectiveNamed.length === 1 ? effectiveNamed[0]!.name : undefined);
  const actualProductQuery = accepted ? { scope: "IDENTITY" as const, entityText: accepted.name, granularity: "PRODUCT" as const, evidence: ctx.userMessage ?? "" } : productQuery;
  let knowledgeItems = needIdentity && !knowledgeEntity && !effectiveNamed.length ? []
    : groupProductKnowledgeItems(await readProductKnowledgeItems(ctx,
      actualProductQuery?.scope === "CATALOG" || continuation?.action === "FIND_OTHERS" ? null : knowledgeEntity));
  let continuationQuestion: string | undefined;
  let parameterFilter: ProductAnswerFacts["parameterFilter"];
  if (knowledgeItems.length) needsClarification = false;
  if (continuation?.action === "FIND_OTHERS") {
    const allFacts = buildProductAnswerFacts({ products: data.products, sources: data.sources, hasMore: false, decision: ctx.domainDecision });
    const resolved = resolveProductParameterFocus(productContext?.parameterFocus,
      buildProductParameterFocus({ ...allFacts, knowledgeItems }), continuation.field);
    if (resolved.error) continuationQuestion = resolved.error;
    else if (continuation.action === "FIND_OTHERS") {
      const values = resolved.values!;
      const target = productContinuationTarget(ctx.userMessage ?? "", values[0]!.field, continuation.match, productContext?.parameterFilter?.operator);
      if (target.error) continuationQuestion = target.error;
      else if (!target.match) continuationQuestion = "你想看看其他产品的这个参数，还是找参数数值相同的产品？";
      else if (values.length !== 1 && target.match !== "READ" && target.value == null) continuationQuestion = "这个参数在原表中有多个取值，你想按哪一个值继续找？";
      else {
        const focus = values[0]!, match = target.match!, targetValue = target.value ?? focus.value;
        parameterFilter = { field: focus.field, operator: match, targetValue, unit: focus.unit, scope: focus.scope, referenceName: focus.entityName };
        const excluded = new Set(resolved.selected!.map(item => item.entityName));
        if (focus.scope === "CATALOG") {
          data = { ...data, products: data.products.filter(product => {
            if (excluded.has(product.name)) return false;
            const values = focus.field === "LAMBDA" ? [product.thermalConductivity] : focus.field === "CORRECTION" ? [product.correctionFactor] : product.thicknessOptionsMm ?? [];
            return values.some(value => value != null && parameterComparisonMatches(value, targetValue, match));
          }) };
          knowledgeItems = [];
        } else {
          data = { ...data, products: [] };
          knowledgeItems = filterKnowledgeByParameter(knowledgeItems, focus, match, excluded, targetValue);
        }
      }
    }
  }
  if (continuationQuestion) {
    needsClarification = true;
    data = { products: [], sources: [], hasMore: false };
    knowledgeItems = [];
  }
  // 事实取得到此结束：下面只产出「事实合同 + 仅事实回答」，
  // 解释组织交给回答层（模型），并按已核验事实校验数值，不再用固定参数清单直出。
  const knowledgeSources = knowledgeItems.flatMap(item => item.sources);
  const facts=buildProductAnswerFacts({products:data.products,sources:[...data.sources,...knowledgeSources],hasMore:data.hasMore || knowledgeItems.length > 12,
    knowledgeFamilies:continuationQuestion ? [] : knowledge.families,knowledgeItems,decision:ctx.domainDecision});
  if (continuation && continuation.action !== "REPHRASE") facts.mode = "TECHNICAL";
  facts.parameterFilter = parameterFilter;
  if (continuation?.field) {
    // 单指标追问只给该字段，避免展示无关参数后“这个参数”再度含糊。
    facts.knowledgeItems = facts.knowledgeItems?.map(item => ({ ...item, attributes: item.attributes.filter(attribute => attribute.key === continuation.field) }));
    facts.products = facts.products.map(product => ({ ...product,
      thermalConductivity: continuation.field === "LAMBDA" ? product.thermalConductivity : null,
      correctionFactor: continuation.field === "CORRECTION" ? product.correctionFactor : null,
      thicknessOptionsMm: continuation.field === "THICKNESS" ? product.thicknessOptionsMm : [],
      specifications: continuation.field === "THICKNESS" ? product.specifications : [] }));
  }
  if (continuation?.action === "EXPLAIN_PARAMETER") {
    facts.parameterExplanation = continuation.field === "LAMBDA"
      ? "导热系数 λ 描述材料传导热量的能力。比较时需要看同一参数口径与测试条件；原表材料层 λ 和目录产品当量 λ 不能直接替代，整套构造的效果还与厚度和其他构造层有关。"
      : continuation.field === "CORRECTION" ? "修正系数 α 按引用资料的适用条件使用，不能只凭这个系数判断整套构造的性能。"
      : continuation.field === "THICKNESS" ? "厚度需要区分材料层厚度、原表构造档位与产品供货规格；它们不能直接互相替代。"
      : undefined;
    if (!facts.parameterExplanation) { continuationQuestion = "你想了解导热系数、修正系数还是厚度的含义？"; needsClarification = true; }
  }
  const noMatchingOther = parameterFilter && !data.products.length && !knowledgeItems.length && !continuationQuestion;
  const filterLabel = parameterFilter ? `${{LAMBDA:"导热系数 λ",CORRECTION:"修正系数 α",THICKNESS:"厚度"}[parameterFilter.field]} ${{READ:"",EXACT:"=",LT:"<",LTE:"≤",GT:">",GTE:"≥"}[parameterFilter.operator]} ${parameterFilter.targetValue}${parameterFilter.unit}` : "";
  const answer=continuationQuestion ?? (noMatchingOther ? `当前可核验资料里，没有找到${parameterFilter!.operator === "READ" ? "可提供该参数的" : `满足“${filterLabel}”的`}其他产品/材料层记录。可以调整范围，或继续查看原来的产品资料。` : needsClarification
    ? knowledge.families.length ? formatProductFactsAnswer(facts)
      : suggestions.length
        ? `你是不是想了解${suggestions.map(item=>` ${item.matchedName}（${item.name}）`).join("或")}？确认一下名称，我就接着介绍。`
        : `${productQuery?.entityText ? `“${productQuery.entityText}”这个名称我还没对上。` : ""}你可以告诉我产品的正式名称或简称，我再帮你介绍。`
    : formatProductFactsAnswer(facts));
  const displayedSources = facts.knowledgeItems?.length
    ? facts.knowledgeItems.flatMap(item => item.sources) : knowledge.sources;
  const sources=continuationQuestion ? [] : [...new Map([...data.sources,...displayedSources].map(source =>
    [JSON.stringify([source.documentId,source.versionId,"pageId" in source ? source.pageId : null]),source])).values()];
  // 产品参数的原页读取复用同一来源授权；不创建构造候选，也不把旧版本页面接到新参数上。
  const pageSources = sources.flatMap(source => "pageId" in source && typeof source.pageId === "string"
    ? [{ pageId: source.pageId, versionId: source.versionId, documentId: source.documentId }] : []).slice(0, 6);
  const referencePages = !needsClarification && ctx.domainDecision?.semantic?.referenceReadFields?.includes("originalPage")
    ? await Promise.all((await readConsumableReferencePages(ctx.app, pageSources.map(source => source.pageId), session.projectId))
      .filter(row => pageSources.some(source => source.pageId === row.page.id && source.versionId === row.page.versionId && source.documentId === row.document.id))
      .map(row => toReferencePageBlock(ctx.app, row))) : [];
  ctx.onEvent?.("product_cards",{products:data.products});
  if(sources.length)ctx.onEvent?.("sources",{sources});
  return {...data,sources,referencePages,needsClarification,facts,answer,parameterFocus: continuationQuestion || continuation?.action === "FIND_OTHERS" || continuation?.action === "REPHRASE" ? productContext?.parameterFocus ?? []
    : !needsClarification && facts.mode === "TECHNICAL" ? buildProductParameterFocus(facts, continuation?.field) : [],
    knowledgeFamilies:knowledge.families,diagnostics:{scope:(continuationQuestion ? productContext?.query : actualProductQuery)??null,indexCount:index.length,matchedIdentityCount:effectiveNamed.length,
    returnedCount:data.products.length,hasMore:data.hasMore,reason:needsClarification?"NAME_UNRESOLVED":"CATALOG_MATCH",suggestions,
    parameterFilter,knowledgeProductCount:knowledgeItems.length,
    seriesCoverageVerified:knowledge.families.length>0,knowledgeFamilyCount:knowledge.families.length,knowledgePageCount:knowledge.pageCount}};
}
