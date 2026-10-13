import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
import { generateConfirmedSolutionReport } from "./solution-report.service.js";
import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
const m=vi.hoisted(()=>({active:vi.fn(),snapshot:vi.fn(),generate:vi.fn()}));
vi.mock("./solution-state.service.js",()=>({loadActiveSolution:m.active,getSolutionSnapshot:m.snapshot}));
vi.mock("../reports/report-snapshot.service.js",()=>({generateTemplateReport:m.generate}));
const ctx=()=>({app:{},user:{id:"u"},request:{},conversation:{id:"c",projectId:null},onEvent:vi.fn()}) as unknown as ToolRuntimeContext;
beforeEach(()=>{vi.clearAllMocks();m.active.mockResolvedValue({stage:"CONFIRMED",confirmedSnapshotId:"s",projectId:null});m.snapshot.mockResolvedValue({id:"s",userId:"u",conversationId:"c",projectId:null,confirmedBy:"u",confirmedAt:new Date(),payload:{projectSnapshot:null,conditionsSnapshot:{},preferencesSnapshot:{},queryStateSnapshot:{},candidates:[{candidateId:"a",kValue:.294,substrateMaterial:"空心砌块"}],alternatives:[],referencePages:[],warnings:[]}});m.generate.mockResolvedValue({report:{id:"report"},taskId:"task"});});
it.each([null,{stage:"SELECTED",projectId:null},{stage:"CONFIRMED",projectId:"other",confirmedSnapshotId:"s"}])("没有当前确认快照拒绝排队：%s",async active=>{m.active.mockResolvedValue(active);expect(await generateConfirmedSolutionReport(ctx())).toMatchObject({ok:false,code:"SOLUTION_SNAPSHOT_REQUIRED"});expect(m.generate).not.toHaveBeenCalled();});
it("正式方案报告只传快照派生DocumentModel，不传产品目录或重查候选",async()=>{const c=ctx();await generateConfirmedSolutionReport(c);expect(m.generate).toHaveBeenCalledWith(c.app,c.request,c.user,expect.objectContaining({solutionDocumentModel:expect.objectContaining({solutionSnapshotId:"s",solutions:[expect.objectContaining({kValue:.294})]})}));expect(c.onEvent).toHaveBeenCalledWith("report_queued",expect.objectContaining({solutionSnapshotId:"s"}));});
it("原页Worker键只映射已重验图片，不存签名URL，失效页保留冻结表",async()=>{
  const snapshot=await m.snapshot(); snapshot.payload.referencePages=[{sourcePageId:"p",objectKey:"pages/p.png",renderModel:{constructions:[]}},{sourcePageId:"old",objectKey:"pages/old.png",renderModel:{constructions:[]}}];
  snapshot.referenceImages=[{sourcePageId:"p",imageUrl:"https://signed.invalid/?token=secret"},{sourcePageId:"old",imageUrl:null}];m.snapshot.mockResolvedValue(snapshot);
  await generateConfirmedSolutionReport(ctx());const model=m.generate.mock.calls[0]![3].solutionDocumentModel;
  expect(model.referencePages[0]).toMatchObject({pageId:"p",pageImageObjectKey:"pages/p.png"});expect(model.referencePages[1]).toMatchObject({pageImageObjectKey:null,renderModel:{constructions:[]}});
  expect(JSON.stringify(model)).not.toContain("signed.invalid");expect(snapshot.payload.referencePages[0]).not.toHaveProperty("pageImageObjectKey");
});
