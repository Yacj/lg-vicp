import "dotenv/config";
import { describe, expect, it } from "vitest";
import { resolveThermalToolReferenceScope, thermalToolWantsCompliance } from "./tools/thermal-calculate.tool.js";
import { normalizeThermalForModel } from "./tools/tool-result-normalizer.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";

/**
 * 阶段3：Thermal Tool 不得用关键词覆盖已验证的 Semantic 决策。
 *
 * 原实现：
 * - `referenceScope` 由 `/已选|选中的|保留的/` 决定，Semantic 给的 CURRENT_SELECTED 会被改写；
 * - 是否做合规核验由 `/达标|合规|符合.*标准/` 决定，与 intent/complianceCheck 无关。
 * 现在两处都先读结构化决策，仅当完全没有 Semantic（快速路径/模型不可用）时才用原封闭词表兜底。
 */

const semantic = (patch: { scope?: "LATEST_VISIBLE" | "CURRENT_SELECTED" | "CURRENT_CONFIRMED"; compliance?: boolean | null }) => ({
  semantic: {
    reference: { scope: patch.scope ?? "LATEST_VISIBLE" },
    complianceCheck: patch.compliance === null ? null : patch.compliance === undefined ? null : { required: patch.compliance }
  }
});

describe("引用作用域以 Semantic 为准", () => {
  it("Semantic 说 CURRENT_SELECTED，原话没有「已选」也照用", () => {
    expect(resolveThermalToolReferenceScope(semantic({ scope: "CURRENT_SELECTED" }), "帮我算这个方案")).toBe("CURRENT_SELECTED");
  });

  it("Semantic 说 LATEST_VISIBLE 时，原话里的「已选」不能改写它", () => {
    expect(resolveThermalToolReferenceScope(semantic({ scope: "LATEST_VISIBLE" }), "已选的那个方案算一下")).toBe("LATEST_VISIBLE");
  });

  it("完全无 Semantic 时才保留原封闭词表兜底", () => {
    expect(resolveThermalToolReferenceScope({}, "选中的方案算一下")).toBe("CURRENT_SELECTED");
    expect(resolveThermalToolReferenceScope({}, "算一下这个方案")).toBe("LATEST_VISIBLE");
  });
});

describe("达标判定以 Semantic 为准", () => {
  it("complianceCheck.required=false 时，原话出现「达标」也不触发合规核验", () => {
    expect(thermalToolWantsCompliance(semantic({ compliance: false }), "算一下这个方案是否达标")).toBe(false);
  });

  it("complianceCheck.required=true 时，原话不含达标字样也要求核验", () => {
    expect(thermalToolWantsCompliance(semantic({ compliance: true }), "按这个构造算一遍")).toBe(true);
  });

  it("完全无 Semantic 时才按原封闭词表判断", () => {
    expect(thermalToolWantsCompliance({}, "这个构造是否达标")).toBe(true);
    expect(thermalToolWantsCompliance({}, "算一下这个构造")).toBe(false);
  });

  it("complianceCheck 的原话证据必须连续可核验，否则拒绝而不是静默忽略", () => {
    const message = "按这个构造算一遍";
    const decision = applyDomainPolicy(message, domainSemanticFixture(message, "THERMAL_CALCULATE", {
      requestedEffect: "CALCULATE", effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message },
      complianceCheck: { required: true, evidence: "是否满足节能要求" } }), null);
    expect(decision.intent).toBe("CLARIFY");
    expect(decision.policyReason).toBe("EVIDENCE_INVALID");
  });
});

describe("计算结果的模型事实合同", () => {
  it("LAYERED 口径会随结果告知模型不得称产品整体热阻", () => {
    const data = normalizeThermalForModel({ valid: true, K: 0.188, R: 5.307, productResistance: 4.8,
      productResistanceScope: "PRODUCT_LAYER_ROWS_ONLY" });
    expect(data.productResistance).toBe(4.8);
    expect(data.productResistanceScope).toBe("PRODUCT_LAYER_ROWS_ONLY");
    expect(data.instruction).toContain("不得说成产品整体热阻");
  });

  it("没有口径时既不额外声明，也不丢弃产品层热阻数值", () => {
    const data = normalizeThermalForModel({ valid: true, K: 0.2, R: 5 });
    expect(data.productResistance).toBeUndefined();
    expect(data.instruction).not.toContain("产品整体热阻");
  });
});
