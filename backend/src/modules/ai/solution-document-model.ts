import type { solutionSnapshots } from "../../db/schema.js";

/** 后续报告唯一输入契约。此转换不允许查询数据库、重算工程值或调用模型。 */
export function toSolutionDocumentModel(snapshot: typeof solutionSnapshots.$inferSelect) {
  const value = structuredClone(snapshot);
  return { schemaVersion: 1 as const, solutionSnapshotId: value.id, confirmedBy: value.confirmedBy, confirmedAt: value.confirmedAt,
    project: value.payload.projectSnapshot, requirements: value.payload.conditionsSnapshot, preferences: value.payload.preferencesSnapshot,
    queryState: value.payload.queryStateSnapshot, solutions: value.payload.candidates, alternatives: value.payload.alternatives,
    finalCandidateIds: value.payload.finalCandidateIds, selectedCandidateIds: value.payload.selectedCandidateIds,
    comparison: [...value.payload.candidates, ...value.payload.alternatives].map(candidate => ({ candidateId: candidate.candidateId,
      systemName: candidate.systemName, constructionCode: candidate.constructionCode, productId: candidate.productId, productSpecId: candidate.productSpecId,
      thicknessMm: candidate.thicknessMm, productThermalResistance: candidate.productThermalResistance,
      totalThermalResistance: candidate.totalThermalResistance, kValue: candidate.kValue, sourcePageId: candidate.sourcePageId })),
    referencePages: value.payload.referencePages,
    compliance: { status: "UNVERIFIED" as const, note: "未进行地区/项目合规性核验；本报告不构成地区达标、审图或施工验收结论。" },
    warnings: [...value.payload.warnings, ...value.payload.referencePages.flatMap(page => {
      const render = page.renderModel as { warnings?: unknown[] } | undefined;
      return Array.isArray(render?.warnings) ? render.warnings.filter((item): item is string => typeof item === "string")
        .map(warning => `原页警告（${String(page.documentTitle ?? page.sourcePageId)}）：${warning}`) : [];
    }), ...value.payload.candidates.flatMap(candidate => {
      const notes: string[] = [];
      if (candidate.publishedReferenceSource)
        notes.push(`${candidate.constructionCode ?? candidate.candidateId}：来源为冻结的已发布热工参考集版本${candidate.publishedReferenceSource.setVersion}、${candidate.publishedReferenceSource.reference}；没有关联原文件或图页，不能作为客户图集原页证明。`);
      else if (candidate.sourceType === "CALCULATED")
        notes.push(`${candidate.constructionCode ?? candidate.candidateId}：来源为冻结的正式计算记录，参数与公式见计算过程；未关联图集原页，不能作为图集查表证明。`);
      else if (!candidate.sourcePageId || !value.payload.referencePages.some(page => page.sourcePageId === candidate.sourcePageId))
        notes.push(`${candidate.constructionCode ?? candidate.candidateId}：缺少可追溯客户图集原页，不能作为图集参考方案来源证明。`);
      if (candidate.constructionCode === "VICP-SHEET-1" || candidate.schemeCode === "VICP-SHEET-1")
        notes.push("VICP-SHEET-1 为测试计算样例，不代表具有客户图集来源的正式参考方案。");
      return notes;
    })] };
}

export type SolutionDocumentModel = ReturnType<typeof toSolutionDocumentModel>;
