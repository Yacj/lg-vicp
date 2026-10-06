import { describe, expect, it } from "vitest";
import { chooseEquivalentParams } from "./thermal-param-source.js";

describe("当量参数取值", () => {
  it("目录产品 λ 优先于 Legacy 参数", () => {
    expect(chooseEquivalentParams({
      catalogConductivity: 0.006,
      catalogCorrection: 1.25,
      parameterConductivity: 0.005,
      parameterCorrection: 1.25
    })).toEqual({ conductivity: 0.006, correctionFactor: 1.25, source: "CATALOG" });
  });

  it("已核实 Fact 优先于目录产品", () => {
    expect(chooseEquivalentParams({
      factConductivity: 0.004,
      factCorrection: 1.1,
      catalogConductivity: 0.005,
      catalogCorrection: 1.25
    })?.source).toBe("FACT");
  });
});
