import { expect, it } from "vitest";
import { normalizeDomainSemanticShape } from "./domain-semantic-output.js";
import { domainTurnSemanticSchema } from "./ai-domain-semantic.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
it("λ定义的重复指标表示归一到已有概念字段，不开放λ构造查表", () => {
  const p = domainSemanticFixture("解释一下导热参数", "KNOWLEDGE_EXPLAIN", {
    factRead: { mode: "DEFINE", metric: "LAMBDA" as any, historyClaim: false, evidence: "解释一下导热参数", definitionSubjects: ["LAMBDA", "K"] } });
  expect(domainTurnSemanticSchema.parse(normalizeDomainSemanticShape(p)).factRead).toMatchObject({ metric: null, definitionSubjects: ["LAMBDA", "K"] });
  expect(p.factRead?.metric).toBe("LAMBDA");
  for (const mode of ["VERIFY", "COMPARE", "EXPLAIN"] as const)
    expect(domainTurnSemanticSchema.safeParse(normalizeDomainSemanticShape({ ...p, factRead: { ...p.factRead, mode } })).success).toBe(false);
  expect(domainTurnSemanticSchema.safeParse(normalizeDomainSemanticShape({ ...p, factRead: { ...p.factRead, definitionSubjects: ["K"] } })).success).toBe(false);
});
