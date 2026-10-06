/**
 * 方案对比确定性规则（纯函数，无 IO）。
 * K 值合格、排序、pass/fail 只能由本文件实现，禁止 Prompt / LLM 改写。
 *
 * 业务规则：
 * - 有 targetK 时：passed = kValue != null && kValue <= targetK（边界相等合格）
 * - 合格方案按 K 从大到小，即最接近 targetK 优先
 * - 无 K 值不得估算；无 targetK 时不伪造合格判定
 */
export type CompareKSource = "REFERENCE_TABLE" | "THERMAL_ENGINE" | "MISSING";

export type CompareSourceRef = {
  type: "THERMAL_REFERENCE_ROW" | "THERMAL_CALC_RECORD" | "CONSTRUCTION_SCHEME" | "CATALOG_PRODUCT";
  id: string;
  label: string;
};

export type CompareCandidateDraft = {
  id: string;
  name: string;
  thickness?: number | null;
  kValue?: number | null;
  kSource?: CompareKSource;
  reasons?: string[];
  sourceRefs?: CompareSourceRef[];
};

export type CompareCandidate = {
  id: string;
  name: string;
  thickness?: number | null;
  kValue?: number | null;
  passed: boolean;
  rank?: number;
  reasons: string[];
  sourceRefs: CompareSourceRef[];
  kSource: CompareKSource;
};

export type ComparisonResult = {
  targetK: number | null;
  candidates: CompareCandidate[];
  recommendedOrder: string[];
};

export type CompareSolutionsInput = {
  projectId?: string;
  targetK?: number;
  solutionIds?: string[];
  productIds?: string[];
};

const K_EPS = 1e-9;

export function isKPassing(kValue: number | null | undefined, targetK: number | null | undefined): boolean {
  if (targetK == null || !Number.isFinite(targetK)) return false;
  if (kValue == null || !Number.isFinite(kValue)) return false;
  return kValue <= targetK + K_EPS;
}

function kGap(targetK: number, kValue: number): number {
  return targetK - kValue;
}

/**
 * 对已加载的候选做合格判定与排序。不读取数据库、不调用模型。
 * 不合格方案保留在 candidates 中，但不进入 recommendedOrder。
 */
export function rankCompareCandidates(
  targetK: number | null | undefined,
  drafts: CompareCandidateDraft[]
): ComparisonResult {
  const normalizedTarget = targetK != null && Number.isFinite(targetK) ? targetK : null;
  const prepared: CompareCandidate[] = drafts.map((draft) => {
    const kSource = draft.kSource ?? (draft.kValue == null ? "MISSING" : "REFERENCE_TABLE");
    const reasons = [...(draft.reasons ?? [])];
    let passed = false;
    if (draft.kValue == null || !Number.isFinite(draft.kValue)) {
      reasons.push("缺少传热系数 K，禁止估算或补造");
    } else if (normalizedTarget == null) {
      reasons.push("未提供目标传热系数，无法判定是否合格");
    } else if (isKPassing(draft.kValue, normalizedTarget)) {
      passed = true;
      reasons.push(`K=${draft.kValue} ≤ 目标 ${normalizedTarget}，合格`);
    } else {
      reasons.push(`K=${draft.kValue} > 目标 ${normalizedTarget}，不合格`);
    }
    return {
      id: draft.id,
      name: draft.name,
      thickness: draft.thickness ?? null,
      kValue: draft.kValue ?? null,
      passed,
      reasons,
      sourceRefs: draft.sourceRefs ?? [],
      kSource
    };
  });

  const passing = prepared.filter((item) => item.passed);
  const failing = prepared.filter((item) => !item.passed);
  if (normalizedTarget != null) {
    passing.sort((a, b) => {
      const gapDiff = kGap(normalizedTarget, a.kValue!) - kGap(normalizedTarget, b.kValue!);
      if (Math.abs(gapDiff) > K_EPS) return gapDiff;
      const thicknessA = a.thickness ?? Number.POSITIVE_INFINITY;
      const thicknessB = b.thickness ?? Number.POSITIVE_INFINITY;
      return thicknessA - thicknessB || a.name.localeCompare(b.name, "zh-CN");
    });
  }
  passing.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    targetK: normalizedTarget,
    candidates: [...passing, ...failing],
    recommendedOrder: passing.map((item) => item.id)
  };
}

/** 冻结对比结果中的工程数值，供解释层使用；调用方不得回写。 */
export function freezeComparisonResult(result: ComparisonResult): ComparisonResult {
  return {
    targetK: result.targetK,
    recommendedOrder: [...result.recommendedOrder],
    candidates: result.candidates.map((item) => ({
      ...item,
      reasons: [...item.reasons],
      sourceRefs: item.sourceRefs.map((ref) => ({ ...ref }))
    }))
  };
}
