import { describe, expect, it } from "vitest";
import { inferReportType } from "./report-type-inference.js";

describe("报告类型自动推断", () => {
  it("已确认对比上下文时直接 material_compare，不弹类型选择", () => {
    const inferred = inferReportType({
      uiAction: "GENERATE_REPORT",
      currentState: {
        taskType: "COMPARISON",
        selectedProductIds: ["p1", "p2"],
        comparisonContext: { productIds: ["p1", "p2"] }
      },
      message: "确认并生成报告"
    });
    expect(inferred).toMatchObject({ status: "RESOLVED", reportType: "material_compare", source: "COMPARISON_CONTEXT" });
  });

  it("用户说把刚才的对比生成报告时推断 material_compare", () => {
    const inferred = inferReportType({
      currentState: {
        taskType: "COMPARISON",
        selectedProductIds: ["vicp", "eps"],
        comparisonContext: { productIds: ["vicp", "eps"] }
      },
      message: "把刚才的对比生成报告"
    });
    expect(inferred.status).toBe("RESOLVED");
    if (inferred.status === "RESOLVED") expect(inferred.reportType).toBe("material_compare");
  });

  it("自然语言明确综合技术方案", () => {
    const inferred = inferReportType({ message: "帮我出一份综合技术方案报告" });
    expect(inferred).toMatchObject({ status: "RESOLVED", reportType: "technical_scheme" });
  });

  it("无法判断时进入结构化 REPORT_TYPE 选择，而不是 Markdown 编号", () => {
    const inferred = inferReportType({ message: "帮我出一份报告" });
    expect(inferred.status).toBe("NEEDS_SELECTION");
    if (inferred.status === "NEEDS_SELECTION") {
      expect(inferred.request.selectionKind).toBe("REPORT_TYPE");
      expect(inferred.request.multiple).toBe(false);
      expect(inferred.request.options.length).toBeGreaterThan(1);
      expect(JSON.stringify(inferred.request)).not.toMatch(/1\s+综合/);
    }
  });

  it("兼容旧 PRODUCT_COMPARISON 编码", () => {
    const inferred = inferReportType({ explicitReportType: "PRODUCT_COMPARISON" });
    expect(inferred).toMatchObject({ status: "RESOLVED", reportType: "material_compare" });
  });
});
