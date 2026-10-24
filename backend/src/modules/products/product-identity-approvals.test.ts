import "dotenv/config";
import { expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { loadThermalQueryDictionary } from "../thermal/thermal-query-dictionary.service.js";
import { applySemanticQuery } from "../thermal/semantic-query.js";
import { approvedCatalogAliases, suggestCatalogNames } from "./product-identity-approvals.js";
const products=[{name:"VICP复合保温板"}];
it("正式简称仅连接用户确认的唯一目录名称；不按品牌子串套用其他产品",()=>{
  expect(approvedCatalogAliases(products)).toEqual([{term:"VICP复合保温板",alias:"VICP"}]);
  expect(approvedCatalogAliases([{name:"VICP其他产品"}])).toEqual([]);
  expect(approvedCatalogAliases([...products,...products])).toEqual([]);
});
it.each(["VLCP","VIC","VIICP","VICQ","VICPX"])("%s近似名称只给建议，不更改原名或产出产品ID",name=>{
  const before=JSON.stringify(products),suggestions=suggestCatalogNames(name,products,approvedCatalogAliases(products));
  expect(suggestions).toEqual([{name:"VICP复合保温板",matchedName:"VICP"}]);expect(JSON.stringify(products)).toBe(before);
});
it.each(["ABC","材料","XYCP","VC","这是引用VICP的句子"])("%s不按子串给近似提示",name=>{
  expect(suggestCatalogNames(name,products,approvedCatalogAliases(products))).toEqual([]);
});
it("产品简称映射不进入热工全局字典，不把体系品牌硬绑定成目录产品ID",async()=>{
  const db:any={select:()=>{let table="";const b:any={from:(t:any)=>{table=getTableName(t);return b;},innerJoin:()=>b,where:()=>b,
    then:(resolve:any)=>Promise.resolve(table==="catalog_products"?[{id:"p",name:"VICP复合保温板"}]:[]).then(resolve)};return b;}};
  const dictionary=await loadThermalQueryDictionary(db);
  expect(dictionary.aliases).toEqual([]);
  const q=applySemanticQuery("VICP",{intent:"REFERENCE_LOOKUP",queryMode:"NEW_QUERY",confidence:.95,preferences:[],unresolved:[],constraints:[{
    type:"ENTITY",field:"systemHint",entityText:"VICP",resolvedText:null,operation:"SET",metric:null,operator:null,value:null,evidence:"VICP",hard:true,confidence:.95
  }]},dictionary);
  expect(q.unresolved).toEqual([]);expect(q.systemHint).toBe("VICP");expect(q.catalogProductId).toBeUndefined();
});
