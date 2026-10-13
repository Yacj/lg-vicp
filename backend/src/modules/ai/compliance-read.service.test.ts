import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveComplianceRead } from "./compliance-read.service.js";
import { resolveReferenceQueryWithoutAgent } from "./reference-query.service.js";
import { domainDecision } from "./ai-domain-turn-decision.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";
const m = vi.hoisted(() => ({ scope: vi.fn(), reference: vi.fn(), query: vi.fn(), publish: vi.fn(), access: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: m.access }));
vi.mock("./reference-candidate-resolver.service.js", () => ({ resolveCandidateReference: m.reference, resolveReferenceRead: vi.fn() }));
vi.mock("./solution-candidate-query.service.js", () => ({ querySolutionCandidates: m.query }));
vi.mock("./candidate-result.service.js", () => ({ publishCandidateResult: m.publish }));
vi.mock("../thermal/thermal-standard-scope.service.js", () => ({ resolveScopedThermalStandard: m.scope }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: async () => ({ entities: [
  {field:"regionCode", value:"test-region", names:["测试地区"]}, {field:"buildingType", value:"住宅", names:["住宅"]}
], aliases: [] }) }));
let limits: any[];
function context(message = "这个方案是否达标", query: any = { regionCode: "test-region", buildingType: "住宅" }) {
  const builder: any = { from: () => builder, where: () => builder, limit: async () => [], then: (r: any) => Promise.resolve(limits).then(r) };
  return { app: { db: { select: () => builder, insert: vi.fn(), update: vi.fn() } }, request: {}, user: {id:"user"},
    conversation: {id:"conversation",projectId:null}, userMessage:message, domainDecision:domainDecision("COMPLIANCE_CHECK",message),
    taskState:{taskType:"GENERAL",lastReferenceLookup:{query,candidates:[{id:"candidate"}],candidateQueryRevision:7,createdAt:new Date().toISOString(),projectId:null}}, onEvent:vi.fn()
  } as unknown as ReferenceReadContext;
}
beforeEach(() => {
  vi.clearAllMocks(); limits = [{id:"standard",basisCode:"TEST",basisName:"测试标准",regionName:"测试地区",limitKValue:.4,clauseRef:"5.2",standardDocumentId:"doc",version:1}];
  m.access.mockResolvedValue({projectId:null}); m.reference.mockResolvedValue({candidates:[{id:"candidate",kValue:.3}],pages:[],sources:[],query:{}});
  m.scope.mockResolvedValue({limit:{...limits[0],sourceDocumentId:"doc"}});
});
describe("只读合规服务（正式读取边界使用替身）", () => {
  it.each([[.3,true],[.5,false]])("K=%s 使用正式限值而非固定城市阈值", async (k, compliant) => {
    m.reference.mockResolvedValue({candidates:[{id:"candidate",kValue:k}],pages:[],sources:[],query:{}});
    const ctx=context(), before=structuredClone(ctx.taskState);
    const result=await resolveReferenceQueryWithoutAgent(ctx);
    expect(result).toMatchObject({readOnly:true,compliance:{status:"CHECKED",compliant}});
    expect(result.sources).toEqual(expect.arrayContaining([expect.objectContaining({documentId:"doc",clauseRef:"5.2"})]));
    expect(ctx.taskState).toEqual(before); expect(m.query).not.toHaveBeenCalled(); expect(m.publish).not.toHaveBeenCalled();
    expect(ctx.app.db.insert).not.toHaveBeenCalled(); expect(ctx.app.db.update).not.toHaveBeenCalled();
  });
  it("只问缺失地区这一项", async () => {
    const result=await resolveComplianceRead(context("是否达标",{buildingType:"住宅"}));
    expect(result.compliance).toMatchObject({status:"NEEDS_INPUT",field:"regionCode"}); expect(m.scope).not.toHaveBeenCalled();
  });
  it("无有效标准如实返回无法判定", async () => { limits=[]; expect((await resolveComplianceRead(context())).compliance.status).toBe("UNAVAILABLE"); });
  it("多标准不擅自取最严格，需选择一项", async () => { limits.push({...limits[0],id:"other"}); expect((await resolveComplianceRead(context())).compliance).toMatchObject({status:"NEEDS_INPUT",field:"standardLimitId"}); });
  it("范围无法覆盖不输出达标", async () => { m.scope.mockResolvedValue({limit:null,reason:"范围未覆盖住宅"}); expect((await resolveComplianceRead(context())).compliance.status).toBe("UNAVAILABLE"); });
  it("当前正式候选已撤回仍拒绝引用", async () => { m.reference.mockResolvedValue({candidates:[],pages:[],sources:[],reason:"正式候选已撤回"}); expect((await resolveComplianceRead(context())).compliance.status).toBe("NEEDS_INPUT"); });
  it("显式本轮参数只作条件核验，不复制历史 K 筛选", async () => {
    const result=await resolveComplianceRead(context("测试地区住宅K0.5是否达标"));
    expect(result.compliance).toMatchObject({status:"CHECKED",compliant:false,parameterSource:"USER_INPUT"});
    expect(m.reference).not.toHaveBeenCalled();
  });
});
