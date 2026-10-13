import "dotenv/config";
import { expect, it, vi } from "vitest";
import { assembleReportSnapshot } from "./report-snapshot.service.js";
import { renderTemplateHtml } from "./report-template-render.js";
it("Solution DocumentModel 路径只读取模板，不查询工程事实",async()=>{
  const from=vi.fn(); const chain:any={where:()=>chain,orderBy:()=>chain,limit:async()=>[{id:"t",code:"standard_report",name:"方案",version:1,sectionsJson:[{key:"selection",title:"确认方案",sourceType:"DATA",enabled:true,order:1}]}]};from.mockReturnValue(chain);
  const model:any={schemaVersion:1,solutionSnapshotId:"s",project:{name:"冻结项目"},solutions:[{candidateId:"a",kValue:.294}],queryState:{},requirements:{},preferences:{},comparison:[],alternatives:[],referencePages:[],warnings:[]};
  const result=await assembleReportSnapshot({db:{select:()=>({from})}} as any,{reportType:"technical_scheme",solutionDocumentModel:model});
  expect(from).toHaveBeenCalledTimes(1);expect(result.dataJson).toMatchObject({solutionSnapshotId:"s",project:{name:"冻结项目"},selection:{candidate:[{kValue:.294}]}});
  model.solutions[0].kValue=99;expect((result.dataJson as any).selection.candidate[0].kValue).toBe(.294);
  expect(renderTemplateHtml(result.dataJson as any)).toContain("0.294");
});
