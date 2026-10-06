/**
 * 当量法 λ/α 取值：已核实 Fact 优先，其次产品中心目录，最后 Legacy 产品参数。
 * K 与总热阻不从产品字段读取。
 */
export function chooseEquivalentParams(input: {
  factConductivity?: number | null;
  factCorrection?: number | null;
  catalogConductivity?: number | null;
  catalogCorrection?: number | null;
  parameterConductivity?: number | null;
  parameterCorrection?: number | null;
}): { conductivity: number; correctionFactor: number; source: "FACT" | "CATALOG" | "PARAMETER" } | null {
  if (input.factConductivity != null && input.factCorrection != null) {
    return { conductivity: input.factConductivity, correctionFactor: input.factCorrection, source: "FACT" };
  }
  if (input.catalogConductivity != null && input.catalogCorrection != null) {
    return { conductivity: input.catalogConductivity, correctionFactor: input.catalogCorrection, source: "CATALOG" };
  }
  if (input.parameterConductivity != null && input.parameterCorrection != null) {
    return { conductivity: input.parameterConductivity, correctionFactor: input.parameterCorrection, source: "PARAMETER" };
  }
  return null;
}
