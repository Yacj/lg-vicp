import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import * as s from "../../src/db/schema.js";
import type { createUatEnvironment } from "./environment.js";

/** 仅在已证明随机隔离库中装载附件原值；关闭合成集，避免其命中冒充客户资料。 */
export async function seedCustomerParameterFixture(env: Awaited<ReturnType<typeof createUatEnvironment>>) {
  assert(/^vicp_ai_uat_[a-f0-9]{32}$/.test(env.databaseName));
  const { db } = env;
  const data = JSON.parse(await readFile("tests/fixtures/product-parameters/customer-reference.json", "utf8"));
  const excel = JSON.parse(await readFile("tests/fixtures/product-parameters/customer-lambda.json", "utf8"));
  const roof = JSON.parse(await readFile("tests/fixtures/product-parameters/customer-roof.json", "utf8"));
  await db.update(s.catalogProducts).set({ status: "DISABLED" });
  await db.update(s.knowledgeDocumentVersions).set({ status: "DISABLED" });
  for (const table of [s.thermalReferenceSets,s.productSpecs,s.productParameters,s.materials,s.materialParameterVersions,s.insulationSystems,s.constructionSchemes,s.thermalCalcRules])
    await db.update(table).set({ status:"DISABLED" });
  const evidence={status:"PUBLISHED" as const,evidenceSource:"客户附件只读提取；隔离Fixture模拟发布，不冒充人工审核",evidenceRef:data.source.sha256,evidenceLevel:"A" as const};
  const [catalog]=await db.insert(s.catalogProducts).values({name:excel.product.name,thermalConductivity:excel.product.lambda,correctionFactor:excel.product.alpha,thicknessOptionsMm:[excel.product.thicknessMm]}).returning();
  const [atlasProduct]=await db.insert(s.catalogProducts).values({name:data.source.product,thermalConductivity:.005,correctionFactor:1.25,thicknessOptionsMm:data.thicknesses}).returning();
  const [series]=await db.insert(s.productSeries).values({code:"CUSTOMER-I",name:data.source.product,...evidence}).returning();
  const [system]=await db.insert(s.insulationSystems).values({code:"CUSTOMER-I",name:data.source.system,systemType:"EXTERNAL",...evidence}).returning();
  const [doc]=await db.insert(s.knowledgeDocuments).values({title:"客户知识库第一表（隔离验收）",visibility:"PUBLIC"}).returning();
  const [version]=await db.insert(s.knowledgeDocumentVersions).values({documentId:doc!.id,version:1,title:doc!.title,status:"PUBLISHED",usageMode:"AI_ENABLED"}).returning();
  await db.update(s.knowledgeDocuments).set({currentVersionId:version!.id}).where(eq(s.knowledgeDocuments.id,doc!.id));
  const [page]=await db.insert(s.knowledgePages).values({documentId:doc!.id,versionId:version!.id,pageNumber:21,physicalPageNumber:21,pageLabel:"21",pageLabelSource:"MANUAL",pageLabelVerified:true,parsedText:JSON.stringify(data),metadata:{recognitionStatus:"CONFIRMED"}}).returning();
  await db.insert(s.productKnowledgeLinks).values({productId:atlasProduct!.id,knowledgeDocumentId:doc!.id});
  const [set]=await db.insert(s.thermalReferenceSets).values({code:"CUSTOMER-FIRST-TABLE",name:doc!.title,atlasDocumentId:doc!.id,...evidence}).returning();
  const specs=[];
  for(const thickness of data.thicknesses){
    const [spec]=await db.insert(s.productSpecs).values({seriesId:series!.id,catalogProductId:atlasProduct!.id,specCode:`CUSTOMER-I-${thickness}`,specClass:"I",thicknessMm:thickness,...evidence}).returning();
    specs.push(spec!);
    await db.insert(s.productParameters).values({specId:spec!.id,parameterCode:"lambda_eq",parameterName:"当量导热系数",value:.005,unit:"W/(m·K)",paramSource:"ATLAS",...evidence});
  }
  const systems=[];
  for(const construction of data.constructions){
    const [scheme]=await db.insert(s.constructionSchemes).values({systemId:system!.id,schemeCode:construction.code,name:construction.code,substrateMaterial:construction.base,substrateThickness:construction.baseThickness,...evidence}).returning();
    for(const [index,spec] of specs.entries()){
      const thickness=data.thicknesses[index];
      await db.insert(s.schemeProductOptions).values({schemeId:scheme!.id,productSpecId:spec.id,minThickness:thickness,maxThickness:thickness,defaultThickness:thickness});
      await db.insert(s.thermalReferenceRows).values({setId:set!.id,schemeId:scheme!.id,productSpecId:spec.id,catalogProductId:atlasProduct!.id,thicknessMm:thickness,productThermalResistance:data.productR[index],totalThermalResistance:construction.totalR[index],kValue:construction.k[index],sourceDocumentId:doc!.id,sourcePageId:page!.id,sourcePageLabel:"21",rawThickness:String(thickness),rawProductResistance:String(data.productR[index]),rawTotalResistance:String(construction.totalR[index]),rawKValue:String(construction.k[index]),evidenceSource:doc!.title,evidenceRef:`21页 ${construction.code}`});
    }
    systems.push({schemeId:scheme!.id,constructionCode:construction.code,specClass:"I",systemName:data.source.system,baseMaterial:construction.base,baseThicknessMm:construction.baseThickness,
      layers:[{order:1,name:construction.base,thicknessMm:construction.baseThickness},{order:2,name:data.source.product,lambda:.005,alpha:1.25}],
      options:specs.map((spec,index)=>({productSpecId:spec.id,catalogProductId:atlasProduct!.id,thicknessMm:data.thicknesses[index],productThermalResistance:data.productR[index],totalThermalResistance:construction.totalR[index],kValue:construction.k[index]}))});
  }
  await db.update(s.knowledgePages).set({metadata:{recognitionStatus:"CONFIRMED",confirmedStructuredData:{pageLabel:"21",pageTitle:data.source.system,fullText:JSON.stringify(data),systems}}}).where(eq(s.knowledgePages.id,page!.id));
  const [material]=await db.insert(s.materials).values({code:"CUSTOMER-CORE",name:excel.core.name,...evidence}).returning();
  await db.insert(s.materialParameterVersions).values({materialId:material!.id,thermalConductivity:excel.core.lambda,correctionFactor:excel.core.alpha,...evidence});
  const roofSystems=roof.constructions.map((item:any)=>({systemName:roof.source.system,rawConstructionLabel:item.rawLabel,applicationPart:"ROOF",roofForm:"FLAT",placement:item.placement,
    specClass:"I",baseMaterial:"钢筋混凝土楼板",baseThicknessMm:120,
    layers:[{order:2,name:"钢筋混凝土楼板",thicknessMm:120,lambda:1.74,alpha:1,rValue:.069},{order:item.layerOrder,name:data.source.product,lambda:.005,alpha:1.25}],
    options:roof.thicknesses.map((thickness:number,index:number)=>({thicknessMm:thickness,productThermalResistance:roof.productR[index],totalThermalResistance:roof.totalR[index],kValue:roof.k[index]}))}));
  const [roofPage]=await db.insert(s.knowledgePages).values({documentId:doc!.id,versionId:version!.id,pageNumber:53,physicalPageNumber:53,pageLabel:"53",pageLabelSource:"MANUAL",pageLabelVerified:true,parsedText:JSON.stringify(roof),metadata:{recognitionStatus:"CONFIRMED",confirmedStructuredData:{pageLabel:"53",pageTitle:roof.source.title,fullText:JSON.stringify(roof),systems:roofSystems}}}).returning();
  return {scope:"客户知识库首表18档+第33表平屋面12档与Excel参数；非全图集",source:data.source,roof:roof.source,excel:excel.provenance,productIds:[catalog!.id,atlasProduct!.id],documentId:doc!.id,pageId:page!.id,roofPageId:roofPage!.id,expectedRows:18,roofReadOnlyRows:12,coreRNotImported:4.8};
}

/** 人工权限反例，绝非客户工程事实；若任何λ=.3哨兵被读到，验收必须失败。 */
export async function seedParameterScopeSentinels(env: Awaited<ReturnType<typeof createUatEnvironment>>) {
  assert(/^vicp_ai_uat_[a-f0-9]{32}$/.test(env.databaseName));const db=env.db;
  const [owner]=await db.insert(s.users).values({displayName:"隔离权限哨兵所有人",role:"NORMAL_USER"}).returning();
  const [project]=await db.insert(s.projects).values({name:"不可见权限哨兵项目",createdById:owner!.id,visibility:"PRIVATE"}).returning();
  for(const kind of ["PROJECT","DRAFT","BROWSE_ONLY","EXPIRED","OLD_VERSION","DELETED"]){
    const [doc]=await db.insert(s.knowledgeDocuments).values({title:`人工负向哨兵-${kind}`,visibility:"PUBLIC",projectId:kind==="PROJECT"?project!.id:null,...(kind==="DELETED"?{deletedAt:new Date()}: {})}).returning();
    const [version]=await db.insert(s.knowledgeDocumentVersions).values({documentId:doc!.id,title:doc!.title,version:1,status:kind==="DRAFT"?"DRAFT":"PUBLISHED",usageMode:kind==="BROWSE_ONLY"?"BROWSE_ONLY":"AI_ENABLED",...(kind==="EXPIRED"?{expiryDate:"2000-01-01"}:{})}).returning();
    let current=version!.id;
    if(kind==="OLD_VERSION")current=(await db.insert(s.knowledgeDocumentVersions).values({documentId:doc!.id,title:doc!.title,version:2,status:"PUBLISHED",usageMode:"AI_ENABLED"}).returning())[0]!.id;
    await db.update(s.knowledgeDocuments).set({currentVersionId:current}).where(eq(s.knowledgeDocuments.id,doc!.id));
    await db.insert(s.knowledgePages).values({documentId:doc!.id,versionId:version!.id,pageNumber:1,physicalPageNumber:1,pageLabel:"权限哨兵",metadata:{recognitionStatus:"CONFIRMED",confirmedStructuredData:{fullText:"人工权限负向数据，不是客户事实",systems:[{systemName:"权限哨兵",layers:[{name:"人工不可读参数",lambda:.3}]}]}}});
  }
  return {syntheticNegativeOnly:true,count:6,expectedLambdaMatches:0};
}
