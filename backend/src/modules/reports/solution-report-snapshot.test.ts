import "dotenv/config";
import { expect, it, vi } from "vitest";
import { assembleReportSnapshot } from "./report-snapshot.service.js";
import { renderTemplateHtml } from "./report-template-render.js";
import { confirmedSolutionFixture } from "../ai/solution-report.fixture.js";
import { toSolutionDocumentModel } from "../ai/solution-document-model.js";
import { reportMemoryDb } from "../../../tests/helpers/report-memory-db.js";
import { reportTemplates } from "../../db/schema.js";
it("Solution DocumentModel路径只读取模板与企业展示配置，不查询工程事实",async()=>{
  const db = reportMemoryDb(); db.rows(reportTemplates).push({id:"t",code:"standard_report",name:"方案",version:1,status:"PUBLISHED",sectionsJson:[{key:"selection",title:"确认方案",sourceType:"DATA",enabled:true,order:1}]});
  const select = vi.spyOn(db,"select");
  const model=toSolutionDocumentModel(confirmedSolutionFixture()); model.project={name:"冻结项目"};
  const result=await assembleReportSnapshot({db} as any,{reportType:"technical_scheme",solutionDocumentModel:model});
  expect(select).toHaveBeenCalledTimes(2);expect(result.dataJson).toMatchObject({solutionSnapshotId:model.solutionSnapshotId,project:{name:"冻结项目"},selection:{candidate:[{kValue:.1245}]}});
  model.solutions[0]!.kValue=99;expect((result.dataJson as any).selection.candidate[0].kValue).toBe(.1245);
  expect(renderTemplateHtml(result.dataJson as any)).toContain("0.1245");
});
