/**
 * 热工计算过程人读展示（纯函数，无 IO）：
 * - 数值一律来自 thermal_calc_records 冻结快照（steps/layers/result/standard 列），
 *   不重新计算、不读实时后台参数，历史记录展示不随后台参数漂移；
 * - 只输出用户可读的步骤/分层/证据，剥离内部数据库 ID 与调试字段；
 * - 禁止 AI 或本模块自行计算 K 值。
 */

export interface ThermalCalcStepPresentation {
  key: string;
  label: string;
  formula?: string | null;
  value?: number | string | null;
  unit?: string | null;
}

export interface ThermalCalcLayerPresentation {
  order: number;
  materialName: string;
  thicknessMm: number;
  lambda?: number | null;
  correctionFactor?: number | null;
}

export interface ThermalCalculationPresentation {
  mode: "REFERENCE_TABLE" | "EQUIVALENT" | "LAYERED";
  resultK: number | null;
  compliant: boolean | null;
  totalResistance?: number | null;
  limitKValue?: number | null;
  steps: ThermalCalcStepPresentation[];
  layers: ThermalCalcLayerPresentation[];
  evidence?: {
    title?: string;
    ref?: string;
    level?: string | null;
  } | null;
}

/** 计算记录 DTO 的宽松快照形状（JSONB 列内容，防御式解析；字段名与 thermalCalcRecordDto 一致） */
export interface ThermalCalcRecordLike {
  mode: string;
  layers?: unknown;
  standard?: unknown;
  steps?: unknown;
  result?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** 依据步骤 key 推断展示单位（快照中无单位列，按确定性 key 映射，不猜测数值） */
function stepUnit(key: string): string | null {
  if (key === "k_value") return "W/(m²·K)";
  if (key === "total_resistance" || key.startsWith("layer_") || key.startsWith("product_")) return "(m²·K)/W";
  return null;
}

const REFERENCE_TABLE_NOTE = "图集查表：直接读取已发布图集参考行（不插值、不重复计算）";

export function buildThermalCalcPresentation(record: ThermalCalcRecordLike): ThermalCalculationPresentation {
  const mode = record.mode === "EQUIVALENT" || record.mode === "LAYERED" ? record.mode : "REFERENCE_TABLE";
  const result = asRecord(record.result);
  const standard = asRecord(record.standard);

  if (mode === "REFERENCE_TABLE") {
    const candidates = asArray(result.candidates).map(asRecord);
    // 查表可能命中多条参考行（不同图集集）；取第一条（服务端已按集 priority 排序）作为结果展示，全部候选由响应层返回
    const first = candidates[0] ?? {};
    const resultK = asNumber(first.kValueRounded) ?? asNumber(first.kValue);
    const totalResistance = asNumber(first.totalThermalResistanceRounded) ?? asNumber(first.totalThermalResistance);
    const steps: ThermalCalcStepPresentation[] = [
      {
        key: "reference_table",
        label: REFERENCE_TABLE_NOTE,
        value: resultK,
        unit: "W/(m²·K)"
      }
    ];
    if (candidates.length > 0 && result.compliant != null) {
      steps.push({
        key: "judgment",
        label: `合格判定：${result.compliant ? "合格" : "不合格"}`,
        value: resultK,
        unit: "W/(m²·K)"
      });
    }
    return {
      mode,
      resultK,
      compliant: typeof result.compliant === "boolean" ? result.compliant : null,
      totalResistance,
      limitKValue: asNumber(standard.limitKValue),
      steps,
      layers: [],
      evidence: {
        title: asString(first.evidenceSource) ?? asString(standard.basisName) ?? asString(standard.basisCode) ?? undefined,
        ref: asString(first.evidenceRef) ?? asString(standard.clauseRef) ?? undefined,
        level: asString(first.evidenceLevel) ?? asString(standard.evidenceLevel)
      }
    };
  }

  // EQUIVALENT / LAYERED：步骤与分层全部来自冻结快照
  const steps = asArray(record.steps).map(asRecord).map((step) => {
    const key = asString(step.key) ?? "";
    const value = asNumber(step.rounded) ?? asNumber(step.value);
    return {
      key,
      label: asString(step.label) ?? "",
      formula: asString(step.formula),
      value: value != null ? value : asString(step.value),
      unit: stepUnit(key)
    };
  });

  const layers = asArray(record.layers).map(asRecord).map((layer) => ({
    order: asNumber(layer.layerOrder) ?? 0,
    materialName: asString(layer.layerName) ?? "未命名构造层",
    thicknessMm: (asNumber(layer.thicknessM) ?? 0) * 1000,
    lambda: asNumber(layer.lambda),
    correctionFactor: asNumber(layer.correctionFactor)
  }));

  return {
    mode,
    resultK: asNumber(result.kValueRounded) ?? asNumber(result.kValue),
    compliant: typeof result.compliant === "boolean" ? result.compliant : null,
    totalResistance: asNumber(result.totalResistanceRounded) ?? asNumber(result.totalResistance),
    limitKValue: asNumber(result.limitKValue) ?? asNumber(standard.limitKValue),
    steps,
    layers,
    evidence: {
      title: asString(standard.basisName) ?? asString(standard.basisCode) ?? undefined,
      ref: asString(standard.clauseRef) ?? undefined,
      level: asString(standard.evidenceLevel)
    }
  };
}
