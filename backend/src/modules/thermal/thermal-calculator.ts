/**
 * 确定性热工计算引擎——纯函数 calculator（无 IO、无随机、无外部依赖）。
 * - 公式族由 rules.formulaVersion 标识（当前仅 VICP-CALC-1），升级公式必须派生新版本规则。
 * - 中间过程一律不取整，仅最终 K 值 / 总热阻按规则 precision + roundingMode 取整展示；
 *   判定基于取整后的展示值（与报审口径一致），原始值与取整值同时写入结果。
 * - 计算失败返回字段级 errors（[{field, code, message}]），不抛异常、不吞错误信息。
 * - 禁止事项：本文件不含任何产品参数 / 图集 K 值 / 标准限值的默认值，全部由调用方传入。
 */

export const FORMULA_VERSION = "VICP-CALC-1" as const;

export type RoundingMode = "HALF_UP" | "HALF_EVEN" | "TRUNCATE" | "NONE";
export type CompareField = "K_VALUE" | "TOTAL_RESISTANCE";
export type CompareOperator = "LTE" | "GTE";
export type CalcMode = "EQUIVALENT" | "LAYERED";

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/** 已解析的计算规则（服务层从已发布规则行读取，禁止调用方直接构造数值） */
export interface ResolvedRules {
  ruleId: string;
  ruleVersion: number;
  ruleCode: string;
  formulaVersion: string;
  interiorSurfaceResistance: number;
  exteriorSurfaceResistance: number;
  precision: number;
  roundingMode: RoundingMode;
  compareField: CompareField;
  compareOperator: CompareOperator;
  includeNonProductLayers: boolean;
  includeSurfaceResistances: boolean;
}

/** 构造层计算输入：厚度单位为米；λ 与修正系数来自已发布材料参数版本 */
export interface CalcLayer {
  layerOrder: number;
  layerType: "BASE_LAYER" | "PRODUCT_LAYER" | "FIXING_LAYER" | "VARIABLE_LAYER";
  layerName: string;
  materialId: string | null;
  thicknessM: number;
  lambda: number | null;
  correctionFactor: number | null;
  /** 材料参数来源（页码/条款），随快照保存 */
  evidenceRef?: string | null;
}

/** 整体当量法产品参数：当量导热系数与修正系数来自已发布产品参数（规则配置 parameterCode） */
export interface EquivalentParams {
  conductivity: number;
  correctionFactor: number;
}

export interface StandardLimitInput {
  limitKValue: number;
}

export interface CalcStep {
  key: string;
  label: string;
  /** 原始数值（不取整） */
  value: number;
  /** 取整后的数值（按规则 precision/roundingMode；NONE 时与原始值相同） */
  rounded: number;
  formula: string;
}

export interface CalcOutcome {
  valid: boolean;
  errors: FieldError[];
  productResistance: number | null;
  productResistanceRounded: number | null;
  totalResistance: number | null;
  totalResistanceRounded: number | null;
  kValue: number | null;
  kValueRounded: number | null;
  compliant: boolean | null;
  limitKValue: number | null;
  steps: CalcStep[];
  /** 公式族与各步公式表达式（追溯快照用） */
  formulas: Record<string, string>;
}

// ---------------------------------------------------------------- 取整（确定性实现）

/**
 * 按精度与取整模式处理正数数值。
 * - HALF_UP：四舍五入（Number.EPSILON 校正浮点表示误差，如 1.005 -> 1.01）；
 * - HALF_EVEN：银行家舍入（IEEE 754 默认，0.5 进偶；不加 EPSILON，避免破坏 0.5 边界）；
 * - TRUNCATE：直接截断小数位；
 * - NONE：不取整。
 */
export function roundBy(value: number, precision: number, mode: RoundingMode): number {
  if (mode === "NONE") return value;
  const factor = 10 ** precision;
  switch (mode) {
    case "TRUNCATE": {
      const corrected = value + Number.EPSILON * Math.max(1, Math.abs(value) * factor);
      return Math.trunc(corrected * factor) / factor;
    }
    case "HALF_UP": {
      const corrected = value + Number.EPSILON * Math.max(1, Math.abs(value) * factor);
      return Math.round(corrected * factor) / factor;
    }
    case "HALF_EVEN": {
      const scaled = value * factor;
      const floored = Math.floor(scaled);
      const diff = scaled - floored;
      const rounded = diff < 0.5 ? floored : diff > 0.5 ? floored + 1 : floored % 2 === 0 ? floored : floored + 1;
      return rounded / factor;
    }
  }
}

/** 合格判定：K 值 / 总热阻按规则比较方向与限值比较，返回 null 表示缺少限值不判定 */
export function judgeCompliance(
  value: number,
  limit: number,
  field: CompareField,
  operator: CompareOperator
): boolean {
  const comparable = value;
  if (field === "K_VALUE") {
    return operator === "LTE" ? comparable <= limit : comparable >= limit;
  }
  return operator === "GTE" ? comparable >= limit : comparable <= limit;
}

// ---------------------------------------------------------------- 校验

function positiveError(field: string, label: string): FieldError {
  return { field, code: "CALC_VALUE_INVALID", message: `${label}必须为大于 0 的数值` };
}

/** 收集输入字段级错误；合法输入返回空数组 */
export function collectInputErrors(input: {
  mode: CalcMode;
  rules: ResolvedRules;
  layers: CalcLayer[];
  equivalentParams?: EquivalentParams;
}): FieldError[] {
  const errors: FieldError[] = [];
  const { rules, layers } = input;

  if (rules.formulaVersion !== FORMULA_VERSION) {
    errors.push({
      field: "rules.formulaVersion",
      code: "CALC_FORMULA_UNSUPPORTED",
      message: `规则引用的公式版本 ${rules.formulaVersion} 不受当前计算引擎支持`
    });
  }
  if (rules.precision < 0 || rules.precision > 8) {
    errors.push({ field: "rules.precision", code: "CALC_RULE_INVALID", message: "规则精度必须在 0 到 8 位小数之间" });
  }
  if (rules.interiorSurfaceResistance < 0 || rules.exteriorSurfaceResistance < 0) {
    errors.push({ field: "rules.surfaceResistance", code: "CALC_RULE_INVALID", message: "内外表面换热阻不能为负数" });
  }

  for (const layer of layers) {
    const f = (suffix: string) => `layers[${layer.layerOrder}].${suffix}`;
    if (layer.thicknessM <= 0) {
      errors.push(positiveError(f("thicknessM"), `构造层「${layer.layerName}」厚度`));
    }
    if (layer.layerType === "PRODUCT_LAYER" && input.mode === "EQUIVALENT") {
      // 产品层在整体当量法下使用当量参数，λ 不做要求
      continue;
    }
    if (layer.lambda === null || layer.lambda <= 0) {
      errors.push(positiveError(f("lambda"), `构造层「${layer.layerName}」导热系数`));
    }
    if (layer.correctionFactor !== null && layer.correctionFactor <= 0) {
      errors.push(positiveError(f("correctionFactor"), `构造层「${layer.layerName}」修正系数`));
    }
  }

  if (input.mode === "EQUIVALENT") {
    const eq = input.equivalentParams;
    if (!eq) {
      errors.push({ field: "equivalentParams", code: "CALC_PARAM_MISSING", message: "整体当量法缺少当量导热系数与修正系数（未配置已发布产品参数）" });
    } else {
      if (eq.conductivity <= 0) errors.push(positiveError("equivalentParams.conductivity", "当量导热系数"));
      if (eq.correctionFactor <= 0) errors.push(positiveError("equivalentParams.correctionFactor", "当量修正系数"));
    }
  }

  return errors;
}

// ---------------------------------------------------------------- 计算

/** 单层热阻：R = δ(m) / (λ × 修正系数)；修正系数为空视为 1 */
export function layerResistance(layer: CalcLayer): number {
  const correction = layer.correctionFactor === null ? 1 : layer.correctionFactor;
  return layer.thicknessM / (layer.lambda! * correction);
}

const FORMULAS = {
  layerResistance: "R = δ / (λ × a)",
  equivalentProductResistance: "R = δ_total / (λ_eq × a_eq)",
  productResistance: "R = Σ(产品层热阻)",
  nonProductResistance: "R = Σ(其余构造层热阻)",
  totalResistance: "R_total = ΣR + R_i + R_e",
  kValue: "K = 1 / R_total",
  judgment: "按规则 compareField/compareOperator 与限值比较"
} as const;

/**
 * 执行确定性计算（EQUIVALENT / LAYERED 共用入口，mode 决定产品层取数方式）：
 * - EQUIVALENT：产品层整体用当量导热系数与修正系数计算；
 * - LAYERED：产品层按自身材料参数逐层计算；
 * - 其余构造层（基层/固定层等）按 includeNonProductLayers 并入；
 * - 内外表面换热阻按 includeSurfaceResistances 并入。
 * 输入校验失败时返回 valid=false + 字段级 errors，result 字段为 null。
 */
export function calculateThermal(input: {
  mode: CalcMode;
  rules: ResolvedRules;
  layers: CalcLayer[];
  equivalentParams?: EquivalentParams;
  standardLimit?: StandardLimitInput | null;
}): CalcOutcome {
  const { mode, rules, layers, standardLimit } = input;
  const errors = collectInputErrors(input);
  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      productResistance: null,
      productResistanceRounded: null,
      totalResistance: null,
      totalResistanceRounded: null,
      kValue: null,
      kValueRounded: null,
      compliant: null,
      limitKValue: null,
      steps: [],
      formulas: { ...FORMULAS }
    };
  }

  const steps: CalcStep[] = [];
  let productResistance = 0;
  let nonProductResistance = 0;
  let productResistanceFormula: string = FORMULAS.productResistance;
  let productLambdaLabel = "";

  for (const layer of layers) {
    if (layer.layerType === "PRODUCT_LAYER") {
      if (mode === "EQUIVALENT") {
        const eq = input.equivalentParams!;
        const r = layer.thicknessM / (eq.conductivity * eq.correctionFactor);
        productResistance = r;
        productResistanceFormula = FORMULAS.equivalentProductResistance;
        productLambdaLabel = `（当量导热系数 ${eq.conductivity} × 修正系数 ${eq.correctionFactor}）`;
        steps.push({
          key: `product_${layer.layerOrder}`,
          label: `产品层「${layer.layerName}」整体当量热阻${productLambdaLabel}`,
          value: r,
          rounded: roundBy(r, rules.precision, rules.roundingMode),
          formula: FORMULAS.equivalentProductResistance
        });
      } else {
        const r = layerResistance(layer);
        productResistance += r;
        steps.push({
          key: `layer_${layer.layerOrder}`,
          label: `产品层「${layer.layerName}」热阻（δ=${layer.thicknessM}m，λ=${layer.lambda}，a=${layer.correctionFactor ?? 1}）`,
          value: r,
          rounded: roundBy(r, rules.precision, rules.roundingMode),
          formula: FORMULAS.layerResistance
        });
      }
      continue;
    }
    if (!rules.includeNonProductLayers) continue;
    const r = layerResistance(layer);
    nonProductResistance += r;
    steps.push({
      key: `layer_${layer.layerOrder}`,
      label: `构造层「${layer.layerName}」热阻（δ=${layer.thicknessM}m，λ=${layer.lambda}，a=${layer.correctionFactor ?? 1}）`,
      value: r,
      rounded: roundBy(r, rules.precision, rules.roundingMode),
      formula: FORMULAS.layerResistance
    });
  }

  let totalResistance = productResistance + nonProductResistance;
  let totalFormula = `${FORMULAS.totalResistance}（ΣR = 产品层 ${productResistance.toFixed(8)}${rules.includeNonProductLayers ? ` + 其余层 ${nonProductResistance.toFixed(8)}` : ""}）`;
  if (rules.includeSurfaceResistances) {
    totalResistance += rules.interiorSurfaceResistance + rules.exteriorSurfaceResistance;
    totalFormula += `（R_i=${rules.interiorSurfaceResistance} + R_e=${rules.exteriorSurfaceResistance}）`;
  }
  steps.push({
    key: "total_resistance",
    label: "总热阻汇总",
    value: totalResistance,
    rounded: roundBy(totalResistance, rules.precision, rules.roundingMode),
    formula: totalFormula
  });

  const kValue = totalResistance > 0 ? 1 / totalResistance : Number.NaN;
  steps.push({
    key: "k_value",
    label: "传热系数",
    value: kValue,
    rounded: roundBy(kValue, rules.precision, rules.roundingMode),
    formula: FORMULAS.kValue
  });

  const kValueRounded = roundBy(kValue, rules.precision, rules.roundingMode);
  const totalRounded = roundBy(totalResistance, rules.precision, rules.roundingMode);
  const compareValue = rules.compareField === "K_VALUE" ? kValueRounded : totalRounded;
  const compliant = standardLimit ? judgeCompliance(compareValue, standardLimit.limitKValue, rules.compareField, rules.compareOperator) : null;
  if (standardLimit) {
    steps.push({
      key: "judgment",
      label: `合格判定：${rules.compareField === "K_VALUE" ? "K 值" : "总热阻"} ${rules.compareOperator === "LTE" ? "≤" : "≥"} ${standardLimit.limitKValue} → ${compliant ? "合格" : "不合格"}`,
      value: compareValue,
      rounded: compareValue,
      formula: FORMULAS.judgment
    });
  }

  return {
    valid: true,
    errors: [],
    productResistance,
    productResistanceRounded: roundBy(productResistance, rules.precision, rules.roundingMode),
    totalResistance,
    totalResistanceRounded: totalRounded,
    kValue,
    kValueRounded,
    compliant,
    limitKValue: standardLimit?.limitKValue ?? null,
    steps,
    formulas: { ...FORMULAS }
  };
}