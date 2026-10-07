/**
 * 候选方案条件匹配引擎——纯函数（无 IO、无随机、无外部依赖）。
 * - 条件匹配返回命中/未命中/数据缺失三态明细，不抛异常、不吞来源与版本信息。
 * - 只做图集查表匹配：禁止插值、禁止猜测参数；厚度维度支持相邻已发布规格（neighborTolerance 控制）。
 * - K 查询语义由 kMode 显式区分（APPROX / MAX_LIMIT / MIN_LIMIT / EXACT），不再用同一个 targetK 包打天下：
 *   APPROX 不过滤 kValue ≤ targetK，只按 |kValue - targetK| 与容差窗口判定，保证 0.303 可命中「0.3 左右」。
 * - 排序只按后台规则：命中条件数 → K 模式距离升序（最接近目标优先，提供 targetK 时）→ 标准厚度升序 → 集 priority → 集版本降序；不宣称唯一最优。
 * - 禁止事项：本文件不含任何产品参数 / 图集 K 值 / 标准限值默认值，全部由调用方传入。
 */

import {
  DEFAULT_K_LOOKUP_MODE,
  normalizeThermalLookupQuery,
  getCandidateMetricValue,
  matchesMetric,
  metricRankingGap,
  type ThermalLookupQuery,
  type ThermalLookupMetric,
  type ThermalLookupMode
} from "./thermal-lookup-mode.js";

export type { ThermalLookupMode };

export type SpecClass = "I" | "II" | "III";

export type ConditionName =
  | "substrateMaterial"
  | "substrateThickness"
  | "system"
  | "specClass"
  | "thickness"
  | "targetK"
  | "targetResistance"
  | "targetValue"
  | "K"
  | "TOTAL_R"
  | "PRODUCT_R"
  | "buildingType";

export type MatchType = "EXACT" | "NEIGHBOR";

/** 候选查询条件（服务层解析后的形态；targetK 可能已由标准限值缺省填充） */
export interface CandidateQueryConditions extends ThermalLookupQuery {
  substrateMaterial?: string;
  substrateThickness?: number;
  systemId?: string;
  specClass?: SpecClass;
  /** 精确厚度（与 thicknessMin/Max 互斥，Zod 层约束） */
  thicknessMm?: number;
  thicknessMin?: number;
  thicknessMax?: number;
  targetK?: number;
  /**
   * K 查询语义（缺省 MAX_LIMIT，兼容历史「K ≤ 目标」口径）：
   * - APPROX：|kValue - targetK| ≤ kTolerance 命中，按差值升序；
   * - MAX_LIMIT：kValue ≤ targetK；MIN_LIMIT：kValue ≥ targetK；
   * - EXACT：|kValue - targetK| ≤ kTolerance（数值精度比较）。
   */
  kMode?: ThermalLookupMode;
  /** K 容差（APPROX/EXACT 有效）；缺省由 thermal-lookup-mode 集中默认值解析 */
  kTolerance?: number;
  targetResistance?: number;
  buildingType?: string;
}

/** 图集参考行 + 关联的方案/系统/规格/集冗余字段（服务层 join 已发布数据后构造） */
export interface CandidateRow {
  rowId: string;
  setId: string;
  setCode: string;
  setVersion: number;
  setPriority: number;
  setBuildingTypes: string[];
  schemeId: string;
  schemeCode: string;
  schemeVersion: number;
  systemId: string;
  systemCode: string | null;
  systemName: string | null;
  substrateMaterial: string;
  substrateThickness: number | null;
  atlasPage: string | null;
  productSpecId: string;
  specCode: string;
  specVersion: number;
  /** null = 未指定型号（客户 XLS 计算样例）；查询 I/II/III 时不得命中 */
  specClass: SpecClass | null;
  thicknessMm: number;
  productThermalResistance: number;
  totalThermalResistance: number;
  kValue: number;
  evidenceSource: string;
  evidenceRef: string;
  sourceDocumentId?: string | null;
  sourcePageId?: string | null;
  sourcePageLabel?: string | null;
  catalogProductId?: string | null;
}

export interface CandidateResult {
  candidateId: string;
  matchType: MatchType;
  /** 相邻档位距离（matchType=NEIGHBOR 时有值；同组厚度升序序列中与目标厚度的档位间隔） */
  neighborGap: number | null;
  matchedConditions: ConditionName[];
  unmatchedConditions: ConditionName[];
  missingConditions: ConditionName[];
  /** K 模式距离：APPROX/EXACT 为 abs(K-target)，MAX_LIMIT 为 target-K，MIN_LIMIT 为 K-target */
  ranking?: { kGap: number; metric?: ThermalLookupMetric; metricGap?: number; isClosestToTarget: boolean };
  scheme: {
    id: string;
    code: string;
    version: number;
    substrateMaterial: string;
    substrateThickness: number | null;
    atlasPage: string | null;
  };
  system: { id: string; code: string | null; name: string | null };
  productSpec: { id: string; specCode: string; specVersion: number; specClass: SpecClass | null };
  set: { id: string; code: string; version: number; priority: number; buildingTypes: string[] };
  result: { thicknessMm: number; productThermalResistance: number; totalThermalResistance: number; kValue: number };
  evidence: { source: string; ref: string };
  sourceDocumentId?: string | null;
  sourcePageId?: string | null;
  sourcePageLabel?: string | null;
  catalogProductId?: string | null;
}

export interface MatchOutcome {
  candidates: CandidateResult[];
  /** 查询提供了该条件，但全部行在该维度都缺数据（如所有方案未填基层厚度） */
  globalMissingConditions: ConditionName[];
}

export interface MatchOptions {
  /** 相邻已发布规格容差档数（0=禁止相邻匹配，默认 1） */
  neighborTolerance?: number;
}

/** 文本规范化：去除首尾空白与内部空白、统一小写（容忍「200mm钢筋混凝土」类写法差异） */
const normalizeText = (value: string): string => value.replace(/\s+/g, "").toLowerCase();

/** 双向包含匹配（行值包含查询值或查询值包含行值） */
const containsMatch = (rowValue: string, queryValue: string): boolean => {
  const a = normalizeText(rowValue);
  const b = normalizeText(queryValue);
  return a.includes(b) || b.includes(a);
};

const hasThicknessCondition = (q: CandidateQueryConditions): boolean =>
  q.thicknessMm !== undefined || q.thicknessMin !== undefined || q.thicknessMax !== undefined;

const thicknessMatches = (row: CandidateRow, q: CandidateQueryConditions): boolean => {
  if (q.thicknessMm !== undefined) return row.thicknessMm === q.thicknessMm;
  if (q.thicknessMin !== undefined && row.thicknessMm < q.thicknessMin) return false;
  if (q.thicknessMax !== undefined && row.thicknessMm > q.thicknessMax) return false;
  return hasThicknessCondition(q);
};

interface ConditionState {
  matched: ConditionName[];
  unmatched: ConditionName[];
  missing: ConditionName[];
}

/** 解析 K 查询模式（缺省 MAX_LIMIT，保持历史口径） */
export function resolveKLookupMode(q: CandidateQueryConditions): ThermalLookupMode {
  return q.mode ?? q.kMode ?? DEFAULT_K_LOOKUP_MODE;
}

/** K 维度是否命中：按查询模式区分「近似 / 上限 / 下限 / 精确」 */
export function kValueMatches(q: CandidateQueryConditions, kValue: number): boolean {
  const target = q.targetK;
  if (target === undefined) return false;
  const lookup = normalizeThermalLookupQuery({ targetK: target, mode: q.mode, kMode: q.kMode, tolerance: q.tolerance, kTolerance: q.kTolerance });
  return matchesMetric(kValue, target, lookup.mode, lookup.tolerance);
}

/**
 * K 排序距离（越小越优先，均为非负数）：
 * - APPROX / EXACT：绝对距离 |kValue - targetK|；
 * - MAX_LIMIT：targetK - kValue（越接近上限越优先）；
 * - MIN_LIMIT：kValue - targetK（越接近下限越优先）。
 */
export function kRankingGap(q: CandidateQueryConditions, kValue: number): number {
  return metricRankingGap(kValue, q.targetK!, resolveKLookupMode(q));
}

/** 单行条件三态判定：数据缺失（行该维度无值）不排除候选，仅标注 */
export function evaluateConditions(row: CandidateRow, q: CandidateQueryConditions): ConditionState {
  const matched: ConditionName[] = [];
  const unmatched: ConditionName[] = [];
  const missing: ConditionName[] = [];

  if (q.substrateMaterial !== undefined) {
    containsMatch(row.substrateMaterial, q.substrateMaterial) ? matched.push("substrateMaterial") : unmatched.push("substrateMaterial");
  }
  if (q.substrateThickness !== undefined) {
    if (row.substrateThickness === null) missing.push("substrateThickness");
    else Math.abs(row.substrateThickness - q.substrateThickness) <= 0.5 ? matched.push("substrateThickness") : unmatched.push("substrateThickness");
  }
  if (q.systemId !== undefined) {
    row.systemId === q.systemId ? matched.push("system") : unmatched.push("system");
  }
  if (q.specClass !== undefined) {
    // 未指定型号（null）不得被 I/II/III 查询命中
    row.specClass != null && row.specClass === q.specClass
      ? matched.push("specClass")
      : unmatched.push("specClass");
  }
  if (hasThicknessCondition(q)) {
    thicknessMatches(row, q) ? matched.push("thickness") : unmatched.push("thickness");
  }
  const lookup = normalizeThermalLookupQuery(q);
  for (const filter of lookup.filters) {
    // 新多条件按指标标注；旧接口保留原 condition 名称。
    const name: ConditionName = q.filters?.length ? filter.metric : filter.metric === q.metric ? "targetValue"
      : filter.metric === "K" ? "targetK" : "targetResistance";
    matchesMetric(getCandidateMetricValue(row, filter.metric), filter.targetValue, filter.mode, filter.tolerance)
      ? matched.push(name) : unmatched.push(name);
  }
  if (q.buildingType !== undefined) {
    if (row.setBuildingTypes.length === 0) missing.push("buildingType");
    else row.setBuildingTypes.some((t) => containsMatch(t, q.buildingType!)) ? matched.push("buildingType") : unmatched.push("buildingType");
  }

  return { matched, unmatched, missing };
}

/** 同组（集+方案+规格）厚度升序序列中，行厚度到目标厚度的档位间隔 */
function neighborGapBetween(sorted: number[], rowThickness: number, target: number): number {
  const j = sorted.indexOf(rowThickness);
  const i = sorted.findIndex((t) => t > target);
  const insertAt = i === -1 ? sorted.length : i;
  if (j < insertAt) return insertAt - j;
  return j - insertAt + 1;
}

function toCandidateResult(row: CandidateRow, matchType: MatchType, state: ConditionState, neighborGap: number | null): CandidateResult {
  return {
    candidateId: row.rowId,
    matchType,
    neighborGap,
    matchedConditions: state.matched,
    unmatchedConditions: state.unmatched,
    missingConditions: state.missing,
    scheme: {
      id: row.schemeId,
      code: row.schemeCode,
      version: row.schemeVersion,
      substrateMaterial: row.substrateMaterial,
      substrateThickness: row.substrateThickness,
      atlasPage: row.atlasPage
    },
    system: { id: row.systemId, code: row.systemCode, name: row.systemName },
    productSpec: { id: row.productSpecId, specCode: row.specCode, specVersion: row.specVersion, specClass: row.specClass },
    set: { id: row.setId, code: row.setCode, version: row.setVersion, priority: row.setPriority, buildingTypes: row.setBuildingTypes },
    result: {
      thicknessMm: row.thicknessMm,
      productThermalResistance: row.productThermalResistance,
      totalThermalResistance: row.totalThermalResistance,
      kValue: row.kValue
    },
    evidence: { source: row.evidenceSource, ref: row.evidenceRef },
    sourceDocumentId: row.sourceDocumentId ?? null,
    sourcePageId: row.sourcePageId ?? null,
    sourcePageLabel: row.sourcePageLabel ?? null
    ,catalogProductId: row.catalogProductId ?? null
  };
}

/**
 * 候选排序器（按查询条件构造，保持纯函数可测试）：
 * 1. EXACT 优先于 NEIGHBOR；
 * 2. 命中条件数降序；
 * 3. 提供 targetK 时按模式距离升序：
 *    - MAX_LIMIT：targetK - kValue 升序（甲方规则：满足 K ≤ 目标且最接近上限者优先）；
 *    - MIN_LIMIT：kValue - targetK 升序（最接近下限者优先）；
 *    - APPROX / EXACT：|kValue - targetK| 升序（最接近目标者优先）；
 * 4. 无 targetK 时跳过该层，维持厚度升序 → 集 priority → 集版本降序的原有排序。
 */
export function buildCandidateSorter(q: CandidateQueryConditions) {
  const typeRank = (m: MatchType) => (m === "EXACT" ? 0 : 1);
  const lookup = normalizeThermalLookupQuery(q);
  return (a: CandidateResult, b: CandidateResult): number => (
    typeRank(a.matchType) - typeRank(b.matchType) ||
    b.matchedConditions.length - a.matchedConditions.length ||
    (lookup.metric !== undefined && lookup.targetValue !== undefined
      ? metricRankingGap(getCandidateMetricValue(a.result, lookup.metric)!, lookup.targetValue, lookup.mode)
        - metricRankingGap(getCandidateMetricValue(b.result, lookup.metric)!, lookup.targetValue, lookup.mode)
      : 0) ||
    a.result.thicknessMm - b.result.thicknessMm ||
    a.set.priority - b.set.priority ||
    b.set.version - a.set.version
  );
}

/**
 * 候选匹配主函数：
 * - EXACT：所有已提供且数据齐全的条件全部命中（数据缺失条件允许并标注）；
 * - NEIGHBOR：仅精确厚度查询场景，同组无该厚度档时，其他条件满足的最近档（gap <= tolerance）；
 * - 区间/无厚度条件查询不产生相邻规格。
 */
export function matchThermalCandidates(rows: CandidateRow[], q: CandidateQueryConditions, options: MatchOptions = {}): MatchOutcome {
  const tolerance = options.neighborTolerance ?? 1;

  const exact: CandidateResult[] = [];
  const neighbors: CandidateResult[] = [];
  const rowsWithData = new Set<ConditionName>();

  // 分组：同 (集, 方案, 规格) 的厚度档位序列
  const groups = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    const key = `${row.setId}|${row.schemeId}|${row.productSpecId}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  for (const group of groups.values()) {
    const sorted = [...group.map((r) => r.thicknessMm)].sort((a, b) => a - b);
    const hasExactThickness = group.some((r) => thicknessMatches(r, q));

    for (const row of group) {
      // 数据可用性汇总（用于全局缺失标注）
      if (q.substrateThickness !== undefined && row.substrateThickness !== null) rowsWithData.add("substrateThickness");
      if (q.buildingType !== undefined && row.setBuildingTypes.length > 0) rowsWithData.add("buildingType");

      const state = evaluateConditions(row, q);
      // 厚度分类只能放宽厚度本身，不能跳过 K、型号、体系等其他约束。
      if (state.unmatched.some((condition) => condition !== "thickness")) continue;

      if (hasExactThickness) {
        // 组内已有厚度命中档：只取厚度命中的行（其余厚度档不进入候选）
        if (!thicknessMatches(row, q)) continue;
        exact.push(toCandidateResult(row, "EXACT", state, null));
      } else if (q.thicknessMm !== undefined && tolerance > 0) {
        // 精确厚度无命中：相邻已发布规格（gap <= tolerance，其余条件仍需满足）
        // 注：thickness 未命中是相邻场景的固有状态，不参与排除
        const nonThicknessUnmatched = state.unmatched.filter((c) => c !== "thickness");
        if (nonThicknessUnmatched.length > 0) continue;
        const gap = neighborGapBetween(sorted, row.thicknessMm, q.thicknessMm);
        if (gap > tolerance) continue;
        neighbors.push(toCandidateResult(row, "NEIGHBOR", state, gap));
      } else {
        // 区间或无厚度条件：全部行按条件匹配进入
        if (state.unmatched.length > 0) continue;
        exact.push(toCandidateResult(row, "EXACT", state, null));
      }
    }
  }

  const globalMissingConditions: ConditionName[] = [];
  if (q.substrateThickness !== undefined && !rowsWithData.has("substrateThickness")) globalMissingConditions.push("substrateThickness");
  if (q.buildingType !== undefined && !rowsWithData.has("buildingType")) globalMissingConditions.push("buildingType");

  const candidates = [...exact, ...neighbors].sort(buildCandidateSorter(q));
  // 目标 K 值排序信息（按查询模式）：
  //   MAX_LIMIT → kGap = targetK - kValue；MIN_LIMIT → kValue - targetK；APPROX/EXACT → |kValue - targetK|
  // isClosestToTarget 标记距离最小者（APPROX 下即最接近目标值者）。
  const lookup = normalizeThermalLookupQuery(q);
  if (lookup.metric !== undefined && lookup.targetValue !== undefined && candidates.length > 0) {
    const gaps = candidates.map((candidate) => metricRankingGap(getCandidateMetricValue(candidate.result, lookup.metric!)!, lookup.targetValue!, lookup.mode));
    const minGap = Math.min(...gaps);
    candidates.forEach((candidate, index) => {
      candidate.ranking = {
        kGap: Number(gaps[index]!.toFixed(4)),
        ...(q.metric || lookup.metric !== "K" ? { metric: lookup.metric, metricGap: Number(gaps[index]!.toFixed(4)) } : {}),
        isClosestToTarget: gaps[index] === minGap
      };
    });
  }
  return { candidates, globalMissingConditions };
}
