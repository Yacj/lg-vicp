import "dotenv/config";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { beforeEach, expect, it, vi } from "vitest";
import { reportMemoryDb } from "../../../tests/helpers/report-memory-db.js";
import { reports, files, reportArtifacts, projects } from "../../db/schema.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
const mock=vi.hoisted(()=>({render:vi.fn(),audit:vi.fn()}));
vi.mock("./report-pdf-preview.js",()=>({renderReportPdfPreview:mock.render}));
vi.mock("../audit-logs/audit-log.service.js",()=>({writeAuditLog:mock.audit}));
import { reportRoutes } from "./reports.routes.js";
const id="00000000-0000-4000-8000-000000000991";
let db:any,storage:any;
beforeEach(()=>{
 vi.clearAllMocks();db=reportMemoryDb();
 db.rows(reports).push({id,createdById:"owner",projectId:null,reportType:"technical_scheme",status:"READY",publishedAt:null});
 db.rows(files).push({id:"pdf",status:"READY",deletedAt:null,objectKey:"reports/frozen/report.pdf"});
 db.rows(reportArtifacts).push({reportId:id,type:"PDF",fileId:"pdf"});
 storage={getObject:vi.fn(async()=>Buffer.from("actual-pdf-bytes"))};
 mock.render.mockImplementation(async load=>{await load();return {pageNumber:2,pageCount:3,imageDataUrl:"data:image/png;base64,cG5n",pdfSha256:"sha"};});
});
async function appFor(user={id:"owner",clientType:"C_APP",role:"NORMAL_USER"}){
 const app=Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
 await app.register(errorHandlerPlugin);app.decorate("db",db);app.decorate("storage",storage);
 app.decorate("authenticate",async(request:any)=>{request.currentUser=user;});await app.register(reportRoutes,{prefix:"/api/v1"});return app;
}
it("页面预览只消费原有PDF工件字节，带源文件SHA且禁止HTTP缓存；不改报告/快照",async()=>{
 const app=await appFor(),before=structuredClone(db.rows(reports));
 try{
  const response=await app.inject(`/api/v1/reports/${id}/artifacts/PDF/pages/2`);
  expect(response.json()).toMatchObject({success:true,data:{pageNumber:2,pdfSha256:"sha"}});
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(storage.getObject).toHaveBeenCalledWith("reports/frozen/report.pdf");
  expect(mock.render).toHaveBeenCalledWith(expect.any(Function),2);expect(db.rows(reports)).toEqual(before);
 }finally{await app.close();}
});
it.each(["otherOwner","unpublishedProject","deletedProject","deletedFile","wrongFormat","invalidPage"])("%s在读取PDF前拒绝，不因预览绕过下载权限",async kind=>{
 if(kind==="unpublishedProject"||kind==="deletedProject"){
  db.rows(reports)[0].projectId="p";if(kind!=="deletedProject")db.rows(projects).push({id:"p",createdById:"owner",visibility:"PUBLIC",deletedAt:null});
 }
 if(kind==="deletedFile")db.rows(files)[0].deletedAt=new Date();
 const app=await appFor(kind==="otherOwner"||kind==="unpublishedProject"?{id:"viewer",clientType:"C_APP",role:"NORMAL_USER"}:undefined);
 try{
  const response=await app.inject(`/api/v1/reports/${id}/artifacts/${kind==="wrongFormat"?"HTML":"PDF"}/pages/${kind==="invalidPage"?0:2}`);
  expect(response.json().success).toBe(false);expect(storage.getObject).not.toHaveBeenCalled();expect(mock.render).not.toHaveBeenCalled();
 }finally{await app.close();}
});
