import "dotenv/config";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
const mocks = vi.hoisted(() => ({ access: vi.fn(), model: vi.fn(), system: vi.fn(), execute: vi.fn(), load: vi.fn(), publish: vi.fn(), history: vi.fn(), current: vi.fn() }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: mocks.history }));
vi.mock("./reference-candidate-source.service.js", () => ({ referenceRowsStillCurrent: mocks.current }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: mocks.access, loadCalculatedCandidates: mocks.load }));
vi.mock("../construction/construction-read.service.js", () => ({ getPublishedConstructionSchemeDetail: mocks.model, getPublishedInsulationSystem: mocks.system }));
vi.mock("../thermal/thermal-calc.service.js", () => ({ executeThermalCalc: mocks.execute }));
vi.mock("./candidate-result.service.js", () => ({ publishCandidateResult: mocks.publish }));
import { calculateConversationModel, renderCalculationRecord } from "./conversation-calculation.service.js";
const schemeId = "00000000-0000-4000-8000-000000000001", targetLayerId = "00000000-0000-4000-8000-000000000002";
const request = { schemeId, productSpecId: null, targetLayerId, mode: "LAYERED" as const, thicknessMm: 15, evidence: "计算芯材15mm", thicknessEvidence: "芯材15mm" };
const context = () => ({ app: { db: {} }, user: { id: "u" }, conversation: { id: "c", projectId: null }, request: {},
  domainDecision: applyDomainPolicy(request.evidence, domainSemanticFixture(request.evidence, "THERMAL_CALCULATE", { calculationRequest: structuredClone(request) })) } as any);
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ id: "c", projectId: null }); mocks.system.mockResolvedValue({ id: "s" });
  mocks.model.mockResolvedValue({ systemId: "s", layers: [{ id: targetLayerId, layerType: "PRODUCT_LAYER" }], productOptions: [{ productSpecId: "spec" }] }); });
describe("计算输入与层角色门禁", () => {
  it.each(["current", "withdrawn", "expired", "other-project"])("缺计算模型时参考上下文%s只用于说明，不代填模型或执行新计算", async variant => {
    const ctx = context(); ctx.conversation.userId = "u"; ctx.conversation.clientApp = "c_app";
    ctx.domainDecision.semantic.calculationRequest.schemeId = null;
    ctx.taskState = { taskType: "GENERAL", lastReferenceLookup: { query: {}, projectId: variant === "other-project" ? "different" : null,
      createdAt: new Date(Date.now() - (variant === "expired" ? 25 * 3600_000 : 1000)).toISOString(), candidateQueryRevision: 2,
      candidates: [{ id: "actual", schemeCode: "ACTUAL", thicknessMm: 24, substrateMaterial: "钢筋混凝土", substrateThickness: 180,
        kValue: .25, productThermalResistance: 3, totalThermalResistance: 4, evidenceSource: "实际来源", evidenceRef: "SheetA" }] } };
    mocks.history.mockResolvedValue([]); mocks.current.mockResolvedValue(variant !== "withdrawn");
    const result = await calculateConversationModel(ctx);
    expect(result.valid).toBe(false); expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
    if (variant === "current") { expect(result.answer).toContain("24mm"); expect(result.answer).toContain("0.25"); expect(result.answer).toContain("厚度作用层"); }
    else expect(result.answer).not.toContain("24mm");
  });
  it("缺模型或目标层不能执行，也不发布空候选覆盖旧上下文", async () => {
    for (const missing of [{ schemeId: null }, { targetLayerId: null }, { targetLayerId: "00000000-0000-4000-8000-000000000003" }]) {
      const ctx = context(); Object.assign(ctx.domainDecision.semantic.calculationRequest, missing);
      expect((await calculateConversationModel(ctx)).valid).toBe(false);
    }
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("否定计算和伪造厚度不获得执行授权", () => {
    const proposal = domainSemanticFixture(request.evidence, "THERMAL_CALCULATE", { calculationRequest: { ...request, thicknessMm: 20 } });
    expect(applyDomainPolicy(request.evidence, proposal).mutation).toBe("NONE");
    expect(applyDomainPolicy(request.evidence, { ...proposal, calculationRequest: request, effectRequest: { direct: true, polarity: "NEGATED", speechAct: "REQUEST", evidence: request.evidence } }).mutation).toBe("NONE");
  });
  it("来源版本与每层结果只读取冻结记录；芯材R不改叫产品整体R", () => {
    const answer = renderCalculationRecord({ id: "r", inputSnapshot: { mode: "LAYERED", thicknessMm: 15 }, resultSnapshot: { productResistance: 4.8, totalResistance: 5.3068, kValue: .1884 },
      provenanceSnapshot: { rule: { code: "RULE", version: 1, formulaVersion: "VICP-CALC-1" }, layers: [{ layerOrder: 1, layerName: "芯材", thicknessM: .015, lambda: .002, correctionFactor: 1.5625, evidenceRef: "Sheet1" }], steps: [{ key: "layer_1", value: 4.8 }] } });
    expect(answer).toContain("VICP-CALC-1"); expect(answer).toContain("产品层行热阻 R=4.8"); expect(answer).not.toContain("产品整体热阻 R=4.8");
    expect(answer).toContain("| 芯材 | 15 | 0.002 | 1.5625 | 4.8 |"); expect(answer).toContain("Sheet1");
  });
});
