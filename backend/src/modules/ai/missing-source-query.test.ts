import "dotenv/config";
import { describe, expect, it } from "vitest";
import { bindMissingQuerySource } from "./source-query-review.js";
import type { SemanticQuery } from "../thermal/semantic-query.js";
const source = { id: "00000000-0000-4000-8000-000000000001", name: "已发布热工表", code: "P", source: "客户工作表", reference: "Sheet1" };
const query: SemanticQuery = { queryMode: "NEW_QUERY", intent: "REFERENCE_LOOKUP", constraints: [], preferences: [], unresolved: [], confidence: .85 };
const verdict = { sourceReferenced: true, faithfulQuery: true, confidence: .95, evidence: "客户表", sourceLabels: [source.name] };
describe("备用解析不能静默丢掉来源限制", () => {
  it("Backend在当前来源中唯一绑定标签，保留原数值条件与未决项", () => {
    const actual = bindMissingQuerySource(verdict, "读客户表", query, [source]);
    expect(actual.sourceScope).toEqual({ kind: "REFERENCE_SET", ids: [source.id], evidence: "客户表" });
    expect(actual.constraints).toBe(query.constraints); expect(actual.unresolved).toBe(query.unresolved);
  });
  it.each([{ confidence: .89 }, { faithfulQuery: false }, { evidence: "未说过" }, { sourceLabels: ["不存在的来源"] }, { sourceLabels: [] }])("%j保持来源未决，不能宽查", change => {
    const actual = bindMissingQuerySource({ ...verdict, ...change }, "读客户表", query, [source]);
    expect(actual.sourceScope).toBeUndefined(); expect(actual.unresolved).toContainEqual(expect.objectContaining({ field: "sourceScope" }));
  });
  it("同名多来源不能猜测绑定", () => {
    const actual = bindMissingQuerySource(verdict, "读客户表", query, [source, { ...source, id: "other" }]);
    expect(actual.sourceScope).toBeUndefined(); expect(actual.unresolved.length).toBe(1);
  });
  it("用户未限定来源时保留原请求，不自动套用唯一的发布表", () => {
    const actual = bindMissingQuerySource({ sourceReferenced: false, faithfulQuery: true, confidence: .99, evidence: null, sourceLabels: [] }, "查全部资料", query, [source]);
    expect(actual).toBe(query);
  });
  it("高置信度提案自带来源ID也不能收窄未指定来源的查询，其他条件逐字段保留", () => {
    const proposed = { ...query, confidence: .99, sourceScope: { kind: "REFERENCE_SET" as const, ids: [source.id], evidence: "查屋面20mm档" } };
    const actual = bindMissingQuerySource({ sourceReferenced: false, faithfulQuery: true, confidence: .95, evidence: null, sourceLabels: [] }, "查屋面20mm档", proposed, [source]);
    expect(actual.sourceScope).toBeNull();expect(actual.constraints).toBe(proposed.constraints);expect(actual.confidence).toBe(.99);
    const pending = bindMissingQuerySource({ sourceReferenced: false, faithfulQuery: true, confidence: .89, evidence: null, sourceLabels: [] }, "查屋面20mm档", proposed, [source]);
    expect(pending.sourceScope).toEqual(proposed.sourceScope);expect(pending.unresolved).toContainEqual(expect.objectContaining({ field: "sourceScope" }));
  });
  it.each(["查询29mm厚的保温档位", "29mm"])("%s的工程证据不能当成限定某个来源的依据", evidence => {
    const message="查询29mm厚的保温档位";
    const condition={type:"THICKNESS" as const,operation:"SET" as const,field:null,entityText:null,resolvedText:null,metric:null,operator:"EXACT" as const,value:29,evidence:"29mm",hard:true as const,confidence:.99};
    const actual=bindMissingQuerySource({...verdict,evidence},message,{...query,constraints:[condition]},[source]);
    expect(actual.sourceScope).toBeUndefined();expect(actual.unresolved).toContainEqual(expect.objectContaining({field:"sourceScope"}));
  });
  it.each(["看Excel参考", "看PDF图集", "查客户表.xlsx", "读已发布热工表"])("%s不能被无证据的NONE覆盖", message => {
    const actual = bindMissingQuerySource({ sourceReferenced: false, faithfulQuery: true, confidence: .99, evidence: null, sourceLabels: [] }, message, query, [source]);
    expect(actual.unresolved).toContainEqual(expect.objectContaining({ field: "sourceScope" }));
  });
  it("明确不限文件来源的原话证据不会被格式线索阻止", () => {
    const message = "Excel和PDF都可以，不限定来源";
    const actual = bindMissingQuerySource({ sourceReferenced: false, faithfulQuery: true, confidence: .99, evidence: "不限定来源", sourceLabels: [] }, message, query, [source]);
    expect(actual).toBe(query);
  });
  it("新的合格来源复核只撤销该门禁旧诊断，不能保留旧拒绝或清除其他真实缺项", () => {
    const low = { sourceReferenced: false, faithfulQuery: true, confidence: .55, evidence: null, sourceLabels: [] };
    const pending = bindMissingQuerySource(low, "继续查询", query, [source]);
    const other = { field: "systemHint", reason: "体系仍待确认" };
    const reviewed = bindMissingQuerySource({ ...low, confidence: .95 }, "继续查询", { ...pending, unresolved: [...pending.unresolved, other] }, [source]);
    expect(reviewed.unresolved).toEqual([other]);
    expect(reviewed.confidence).toBe(query.confidence);
    expect(bindMissingQuerySource(low, "继续查询", pending, [source]).unresolved).toHaveLength(1);
    const uncertain = bindMissingQuerySource({ ...low, confidence: .95, sourceReferenced: true }, "指定那份资料", pending, [source]);
    expect(uncertain.unresolved).toHaveLength(1);expect(uncertain.sourceScope).toBeUndefined();
  });
});
