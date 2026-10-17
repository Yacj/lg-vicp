import { and, asc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { catalogProducts, knowledgeAliases, knowledgeDocuments, knowledgeDocumentVersions, productKnowledgeLinks, productSpecs } from "../../db/schema.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { normalizeEntityText } from "../thermal/thermal-query-state.js";
import { resolveQueryEntities, type QueryEntity } from "../thermal/thermal-entity-resolver.js";
import { assertSolutionAccess } from "./solution-state.service.js";
import { isReferencePageConsumable } from "./reference-page-access.js";
import { buildProductAnswerFacts, formatProductFactsAnswer } from "./product-answer.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";
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

/** 无ID首问通过正式名称/类型/后台别名检索；详情不能擅自用全目录代替。 */
export async function resolveProductConsultation(ctx: ReferenceReadContext) {
  await assertSolutionAccess(ctx.app.db,ctx.user,ctx.conversation.id);
  const index=await ctx.app.db.select().from(catalogProducts).where(eq(catalogProducts.status,"ACTIVE")).orderBy(asc(catalogProducts.sortOrder),asc(catalogProducts.id)).limit(501);
  const aliases=await ctx.app.db.select({term:knowledgeAliases.term,alias:knowledgeAliases.alias}).from(knowledgeAliases).where(and(eq(knowledgeAliases.enabled,true),eq(knowledgeAliases.scope,"GLOBAL")));
  const text=normalizeEntityText(ctx.userMessage??"");
  const named=index.filter(item=>[item.name,...aliases.filter(alias=>normalizeEntityText(alias.term)===normalizeEntityText(item.name)).map(alias=>alias.alias)]
    .some(name=>normalizeEntityText(name).length>=2&&text.includes(normalizeEntityText(name))));
  const types=[...new Set(index.flatMap(item=>item.productType&&text.includes(normalizeEntityText(item.productType))?[item.productType]:[]))];
  const entities:QueryEntity[]=["I","II","III"].map(value=>({field:"specClass",value,names:[`${value}型`,`${{I:"Ⅰ",II:"Ⅱ",III:"Ⅲ"}[value as "I"|"II"|"III"]}型`]}));
  const specClass=resolveQueryEntities(ctx.userMessage??"",{},entities).specClass;
  const needIdentity=ctx.domainDecision?.intent==="PRODUCT_DETAIL";
  const ambiguous=types.length>1||index.length>500;
  const data=ambiguous||needIdentity&&!named.length&&!types.length&&!specClass ? {products:[],sources:[],hasMore:false} : await searchProductCatalog(ctx,{productIds:named.length?named.map(item=>item.id):undefined,
    productType:types[0],specClass,limit:12});
  const needsClarification=ambiguous||needIdentity&&!named.length&&!types.length&&!specClass;
  // 事实取得到此结束：下面只产出「事实合同 + 仅事实回答」，
  // 解释组织交给回答层（模型），并按已核验事实校验数值，不再用固定参数清单直出。
  const facts=buildProductAnswerFacts({products:data.products,sources:data.sources,hasMore:data.hasMore,decision:ctx.domainDecision});
  const answer=needsClarification ? "请指定要查看的产品名称、目录简称或型号。" : formatProductFactsAnswer(facts);
  ctx.onEvent?.("product_cards",{products:data.products});
  if(data.sources.length)ctx.onEvent?.("sources",{sources:data.sources});
  return {...data,needsClarification,facts,answer};
}
