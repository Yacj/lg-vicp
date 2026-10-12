import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 阶段1仅记录未修复合同。P0_EXPECT_FIXED=1 将已知失败改为普通断言，输出真实红灯。
const pendingFix = process.env.P0_EXPECT_FIXED === "1" ? it : it.fails;
const mocks = vi.hoisted(() => ({ generate: vi.fn(), runtime: vi.fn(), audit: vi.fn() }));
vi.mock("ai", () => ({ generateObject: mocks.generate }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: mocks.runtime }));
vi.mock("../audit-logs/audit-log.service.js", () => ({ writeAuditLog: mocks.audit }));
import { parseSolutionAction } from "./solution-action-semantic.service.js";
import { emptySolution, refreshSolution, referenceSolutionCandidate } from "./solution-workflow.js";
import { normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";
import { resolveQueryEntities, type QueryEntity } from "../thermal/thermal-entity-resolver.js";
import { validateCandidateAgainstQueryState } from "../thermal/thermal-query-state.js";

const candidates = [1, 2, 3].map((index) => ({ id: `row-${index}`, schemeCode: `A1-${index}`,
  systemId: "thin-i", thicknessMm: [18, 20, 25][index - 1], kValue: [0.303, 0.295, 0.31][index - 1] }));
const lookup = () => ({ query: { systemId: "thin-i", filters: [{ metric: "K" as const, targetValue: 0.3, mode: "APPROX" as const }] },
  candidates: structuredClone(candidates), createdAt: new Date().toISOString(), candidateQueryRevision: 7, projectId: null });
const payload = () => refreshSolution(emptySolution(), lookup().query, candidates.map(referenceSolutionCandidate));
const ctx = { app: { db: {}, log: { warn: vi.fn() } }, request: {}, user: { id: "u" },
  conversation: { id: "c", scene: "general_chat" } } as any;
beforeEach(() => { vi.resetAllMocks(); mocks.runtime.mockRejectedValue(new Error("受控模拟：动作模型不可用")); });

describe("P0静态审计：动作故障不得拦截非动作（没有真实模型/SSE）", () => {
  pendingFix.each(["第一个原页", "第一个完整表格", "A1-3 参数", "K是什么意思", "你好", "这个K怎么算"])(
    "已有候选时 %s 必须交还其领域路由", async (message) => {
      const state = payload(), frozen = structuredClone(state);
      const result = await parseSolutionAction(ctx, message, state);
      expect(state).toEqual(frozen);
      expect(result).toBeNull();
      expect(mocks.runtime).not.toHaveBeenCalled();
    });
  it.each(["你好", "第一个原页", "K是什么意思"])("无候选时 %s 已有隔离保护", async (message) => {
    expect(await parseSolutionAction(ctx, message, emptySolution())).toBeNull();
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it("真实选择在模型故障时只澄清，不猜测选择", async () => {
    const state = payload(), frozen = structuredClone(state);
    expect(await parseSolutionAction(ctx, "第一个留下", state)).toMatchObject({ parserSource: "UNAVAILABLE", clarification: expect.any(String) });
    expect(state).toEqual(frozen);
  });
});

describe("P0静态审计：查询生命周期与正式族约束", () => {
  it("首轮薄抹灰目标由正常名称目录收窄，金属面候选被正式ID约束拒绝", () => {
    const dictionary = { entities: [
      { field: "systemId", value: "thin-i", names: ["I型 VICP薄抹灰外保温系统"] },
      { field: "systemId", value: "thin-ii", names: ["II型 VICP薄抹灰外保温系统"] },
      { field: "systemId", value: "metal", names: ["金属面夹芯板系统"] }
    ] as QueryEntity[], aliases: [] };
    const result = normalizeConversationLookupQuery({}, "薄抹灰K0.3左右有哪些", undefined, dictionary);
    expect(result.lifecycle).toBe("NEW_QUERY");
    expect(result.query.systemIds).toEqual(["thin-i", "thin-ii"]);
    expect(validateCandidateAgainstQueryState({ systemId: "metal", kValue: 0.3 }, result.query).passed).toBe(false);
  });
  pendingFix("复杂正式名不能让显式薄抹灰族条件消失", () => {
    const dictionary = { entities: [
      { field: "systemId", value: "thin-i", names: ["I型 VICP真空绝热板薄抹灰外墙外保温系统"] },
      { field: "systemId", value: "metal", names: ["金属面夹芯板系统"] }
    ] as QueryEntity[], aliases: [] };
    const result = normalizeConversationLookupQuery({}, "薄抹灰K0.3左右有哪些", undefined, dictionary);
    // 可正确解析族ID，也可因正式映射缺失而澄清；绝不能返回无族限制的查询。
    const guarded = result.query.systemId === "thin-i" || result.query.systemIds?.includes("thin-i")
      || Boolean(result.query.unresolved?.length) || Boolean(result.needsClarification);
    expect(Boolean(guarded)).toBe(true);
  });
  it("同构造编号按体系消歧，只有编号仍需澄清", () => {
    const entities: QueryEntity[] = [
      { field: "schemeId", value: "scheme-thin", names: ["A1-3"], systemId: "thin-i" },
      { field: "schemeId", value: "scheme-metal", names: ["A1-3"], systemId: "metal" }
    ];
    expect(resolveQueryEntities("A1-3", { systemId: "thin-i" }, entities, []).schemeId).toBe("scheme-thin");
    expect(resolveQueryEntities("A1-3", {}, entities, []).unresolved?.length).toBeGreaterThan(0);
  });
  it("局部厚度追问保留族与K；完整新问题清理旧厚度", () => {
    const last = lookup();
    const refined = normalizeConversationLookupQuery({}, "那20mm以内", last);
    expect(refined.query).toMatchObject({ systemId: "thin-i", thicknessMax: 20, filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] });
    expect(refined.attributeQuestion).toBe(false);
    const fresh = normalizeConversationLookupQuery({}, "屋面K0.2左右有哪些方案", { ...last, query: { ...last.query, thicknessMax: 20 } },
      { entities: [{ field: "systemId", value: "roof", names: ["屋面保温系统"] }], aliases: [] });
    expect(fresh.lifecycle).toBe("NEW_QUERY");
    expect(fresh.query.systemId).toBe("roof");
    expect(fresh.query.thicknessMax).toBeUndefined();
  });
});
