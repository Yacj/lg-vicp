import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGenerateReportTool, generateReportInput } from "./generate-report.tool.js";
import { domainDecision, DOMAIN_INTENTS } from "../ai-domain-turn-decision.js";
import { applyDomainPolicy } from "../ai-domain-policy.js";
import { domainSemanticFixture } from "../domain-semantic.fixture.js";
import type { ToolRuntimeContext } from "./tool-runtime.js";
const m=vi.hoisted(()=>({run:vi.fn(),create:vi.fn(),get:vi.fn(),generate:vi.fn(),report:vi.fn(),solution:vi.fn()}));
vi.mock("./tool-runtime.js",()=>({runRegisteredTool:m.run}));
vi.mock("../report-context-snapshot.service.js",()=>({createReportContextSnapshot:m.create,getReportContextSnapshot:m.get,generateReportFromSnapshot:m.generate}));
vi.mock("../../reports/report-generation.service.js",()=>({createReport:m.report}));
vi.mock("../solution-report.service.js",()=>({generateConfirmedSolutionReport:m.solution}));
function context(intent: typeof DOMAIN_INTENTS[number], message="你好") {
  return {app:{db:{insert:vi.fn(),select:vi.fn(),transaction:vi.fn()},queues:{reportGeneration:{add:vi.fn()}}},
    request:{},user:{id:"user"},conversation:{id:"conversation",projectId:null},userMessage:message,
    domainDecision:intent === "REPORT_REQUEST" ? applyDomainPolicy(message,domainSemanticFixture(message,intent,{reportType:message === "生成产品对比报告" ? "material_compare" : "technical_scheme"})) : domainDecision(intent,message),taskState:{taskType:"GENERAL",reportContextSnapshotId:"old"},onEvent:vi.fn()
  } as unknown as ToolRuntimeContext;
}
async function execute(ctx:ToolRuntimeContext,input:Record<string,unknown>={}) {
  return createGenerateReportTool(ctx).execute!(generateReportInput.parse(input),{toolCallId:"call",messages:[]}) as Promise<any>;
}
beforeEach(()=>{vi.clearAllMocks();m.run.mockImplementation((_c,_n,_a,_o,run)=>run());m.get.mockResolvedValue({id:"old",conversationId:"conversation",projectId:null,reportType:"material_compare",selectedProductIds:["product"]});m.generate.mockResolvedValue({reportId:"report",taskId:"task",status:"QUEUED"});m.solution.mockResolvedValue({ok:true});});
describe("报告execute第一入口强授权",()=>{
  it.each(DOMAIN_INTENTS.filter(i=>i!=="REPORT_REQUEST"))("%s 即使模型传快照也零副作用",async intent=>{
    const ctx=context(intent);const result=await execute(ctx,{snapshotId:"old",reportType:"technical_scheme",requirements:"生成报告"});
    expect(result).toMatchObject({ok:false,code:"REPORT_AUTHORIZATION_REQUIRED"});expect(m.run).not.toHaveBeenCalled();
    for(const mock of [m.create,m.generate,m.report,m.solution,ctx.app.db.insert,ctx.app.queues.reportGeneration.add]) expect(mock).not.toHaveBeenCalled();
    expect(ctx.onEvent).not.toHaveBeenCalled();
  });
  it("历史已确认产品选择不能授权本轮普通问答",async()=>{const ctx=context("GENERAL");ctx.selectedUserSelection={selectionKind:"PRODUCT",selectedIds:["product"],options:[],confirmAction:"GENERATE_REPORT"};expect((await execute(ctx)).ok).toBe(false);});
  it("本轮服务端校验的同用户同会话UI报告确认可以授权",async()=>{const ctx=context("GENERAL");ctx.reportAuthorization={userId:"user",conversationId:"conversation",reportType:"material_compare"};expect((await execute(ctx,{reportType:"material_compare"})).ok).toBe(true);});
  it("其他用户或会话的UI授权标识不能复用",async()=>{const ctx=context("GENERAL");ctx.reportAuthorization={userId:"other",conversationId:"conversation"};expect((await execute(ctx)).ok).toBe(false);expect(m.run).not.toHaveBeenCalled();});
  it("明确产品对比报告保留原快照流程",async()=>{const result=await execute(context("REPORT_REQUEST","生成产品对比报告"),{reportType:"material_compare"});expect(result.ok).toBe(true);expect(m.generate).toHaveBeenCalledOnce();});
  it("普通方案报告不复用旧产品报告快照",async()=>{await execute(context("REPORT_REQUEST","生成保温方案报告"));expect(m.solution).toHaveBeenCalledOnce();expect(m.get).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();});
  it("外会话产品快照不能排队",async()=>{m.get.mockResolvedValue({id:"other",conversationId:"other",projectId:null,reportType:"material_compare"});expect((await execute(context("REPORT_REQUEST","生成产品对比报告"),{snapshotId:"other",reportType:"material_compare"})).ok).toBe(false);expect(m.generate).not.toHaveBeenCalled();});
  it("分类标签/evidence不能单独授权写入",async()=>{const ctx=context("REPORT_REQUEST","生成报告");ctx.domainDecision=domainDecision("REPORT_REQUEST","生成报告");expect((await execute(ctx,{reportType:"technical_scheme"})).code).toBe("REPORT_AUTHORIZATION_REQUIRED");expect(m.run).not.toHaveBeenCalled();});
  it("Tool模型参数不能把本轮正式方案目标降级为旧产品报告",async()=>{await execute(context("REPORT_REQUEST","生成保温方案报告"),{reportType:"material_compare",snapshotId:"old"});expect(m.solution).toHaveBeenCalledOnce();expect(m.get).not.toHaveBeenCalled();expect(m.generate).not.toHaveBeenCalled();});
});
