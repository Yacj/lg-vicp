import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), history: vi.fn(), query: vi.fn(), current: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: m.access }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: m.history }));
vi.mock("./solution-candidate-query.service.js", () => ({ querySolutionCandidates: m.query }));
vi.mock("./reference-candidate-source.service.js", () => ({ referenceRowsStillCurrent: m.current }));
import { explainCandidateAvailability, previousCandidateAvailability } from "./candidate-availability.service.js";
import { specThicknessConflict } from "../../shared/reference-data-conflict.js";
const conversation = { id: "c", userId: "u", projectId: null, clientApp: "c_app" }, now = Date.now();
const mismatch = { rowThicknessMm: 42, specCode: "SPEC-28", specThicknessMm: 28 };
const candidate = { id: "valid", schemeCode: "APPROVED", thicknessMm: 28 };
const lookup = () => ({ query: { substrateThickness: 180 }, candidates: [candidate], createdAt: new Date(now).toISOString(), candidateQueryRevision: 3, projectId: null });
const history = () => [{ id: "a", createdAt: new Date(now), metadata: { queryScope: conversation,
  backendDecision: { domainIntent: "REFERENCE_QUERY", referenceQueryRevisionAfter: 3, referenceQueryDiagnostics: { specThicknessMismatches: [mismatch] } } } }];
const ctx = () => ({ app: { db: { insert: vi.fn(), update: vi.fn() } }, conversation, user: { id: "u" }, taskState: { taskType: "GENERAL", lastReferenceLookup: lookup() } }) as any;
beforeEach(() => { vi.clearAllMocks(); m.access.mockResolvedValue({ projectId: null }); m.history.mockResolvedValue(history());
  m.current.mockResolvedValue(true); m.query.mockResolvedValue({ pages: { candidates: [candidate] }, queryDiagnostics: { specThicknessMismatches: [mismatch] } }); });
it.each(["COMPARE", "ACTION", "CLARIFY"])("%s说明当前核验的资料冲突，不换ID、不部分执行", async purpose => {
  const c = ctx(), before = structuredClone(c.taskState), result = await explainCandidateAvailability(c, purpose as any);
  expect(result?.answer).toContain("| 参考表中的保温厚度 | 42 mm |");
  expect(result?.answer).toContain("| 关联规格的板厚 | 28 mm | SPEC-28"); expect(result?.answer).toContain("APPROVED（28mm）");
  expect(result?.answer).toContain("候选卡片"); if (purpose === "ACTION") expect(result?.answer).toContain("还没有执行");
  expect(m.query.mock.calls[0][1]).toEqual(before.lastReferenceLookup.query); expect(c.taskState).toEqual(before);
  expect(c.app.db.insert).not.toHaveBeenCalled(); expect(c.app.db.update).not.toHaveBeenCalled();
});
it.each(["userId", "clientApp", "projectId"])("不披露其他%s下的历史诊断", field => {
  const rows = history(); rows[0]!.metadata.queryScope = { ...conversation, [field]: "other" };
  expect(previousCandidateAvailability(rows, conversation, lookup(), now)).toBeUndefined();
});
it("旧Revision、失效、过期、换话题均不得回捞", async () => {
  for (const patch of [{ candidateQueryRevision: 2 }, { candidateResultInvalid: true }, { createdAt: new Date(now - 25 * 3600_000).toISOString() }])
    expect(previousCandidateAvailability(history(), conversation, { ...lookup(), ...patch } as any, now)).toBeUndefined();
  const switched = { ...history()[0]!, metadata: { queryScope: conversation, backendDecision: { domainIntent: "GENERAL", referenceQueryRevisionAfter: 3 } } };
  expect(previousCandidateAvailability([switched, ...history()], conversation, lookup(), now)).toBeUndefined();
  const c = ctx(); c.candidateQueryRevision = 2;
  expect(await explainCandidateAvailability(c, "ACTION")).toBeUndefined(); expect(m.query).not.toHaveBeenCalled();
});
it("当前来源撤回或冲突已修订时不重放旧原因", async () => {
  m.current.mockResolvedValue(false); expect(await explainCandidateAvailability(ctx(), "ACTION")).toBeUndefined();
  m.current.mockResolvedValue(true); m.query.mockResolvedValue({ pages: { candidates: [candidate] }, queryDiagnostics: {} });
  expect(await explainCandidateAvailability(ctx(), "ACTION")).toBeUndefined();
  m.query.mockResolvedValue({ pages: { candidates: [] }, queryDiagnostics: { specThicknessMismatches: [mismatch] } });
  expect(await explainCandidateAvailability(ctx(), "COMPARE")).toBeUndefined();
});
it("后续比较/操作展示重新读取的两处来源，而不采用历史诊断作数据依据", async () => {
  const conflict = specThicknessConflict({ ...mismatch, evidenceSource: "当前热工表", evidenceRef: "Sheet B", setVersion: 4, specVersion: 2 });
  m.query.mockResolvedValue({ pages: { candidates: [candidate] },
    queryDiagnostics: { specThicknessMismatches: [mismatch], dataConflicts: [conflict] } });
  const context = ctx(), result = await explainCandidateAvailability(context, "ACTION");
  expect(result?.answer).toContain("当前热工表，Sheet B，版本 4");
  expect(result?.answer).toContain("SPEC-28，版本 2");
  expect(result?.diagnostics.dataConflicts).toEqual([conflict]);
  expect(context.app.db.insert).not.toHaveBeenCalled(); expect(context.app.db.update).not.toHaveBeenCalled();
});
it("只读保留使用当前来源指纹及真实人类名称，不给模型正式身份或升级候选", async () => {
  const conflict = specThicknessConflict({ ...mismatch, schemeCode: "READ-ONLY", schemeName: "另一种分层做法", evidenceSource: "当前表", setVersion: 3 });
  m.query.mockResolvedValue({ pages: { candidates: [candidate] }, queryDiagnostics: { specThicknessMismatches: [{ ...mismatch,
    schemeCode: "READ-ONLY", schemeName: "另一种分层做法" }], dataConflicts: [conflict] } });
  const result = await explainCandidateAvailability(ctx(), "READ");
  expect(result?.readOnlyCatalog).toMatchObject({ queryRevision: 3, references: [{ label: "另一种分层做法", thicknessMm: 42, conflict }] });
  expect(result?.readOnlyCatalog.references[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  m.current.mockResolvedValue(false);expect(await explainCandidateAvailability(ctx(), "READ")).toBeUndefined();
});
