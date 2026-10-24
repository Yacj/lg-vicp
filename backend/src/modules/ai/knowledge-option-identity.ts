import { createHash } from "node:crypto";
import type { KnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";

/**
 * 知识库档位的只读身份。
 *
 * 约束（对应 P0-B 要求）：
 * - 不依赖页面内的数组序号：`optionId` 只在当前快照内可复算，不能跨版本当身份；
 * - 不依赖可能重复的构造编码：编码 + 基层 + 基层厚度 + 屋面形态 + 部位一起参与键；
 * - 每次使用都必须用当前确认快照重新解析并核验 revision；不唯一时显式返回歧义，不做猜测。
 */
export type RenderConstruction = KnowledgePageRenderModel["constructions"][number];
export type RenderOption = RenderConstruction["options"][number];

const canonical = (value: string | null | undefined) => (value ?? "").normalize("NFKC").replace(/\s/g, "").replace(/^外墙/i, "").toUpperCase();

/** 构造的内容键：编码可重复，所以必须叠加基层/厚度/屋面形态/部位；空编码用构造名兜底。 */
export function constructionKey(construction: RenderConstruction): string {
  const code = canonical(construction.constructionCode);
  const base = canonical(construction.baseMaterial);
  const baseThickness = construction.baseThicknessMm == null ? "" : String(construction.baseThicknessMm);
  const roof = canonical(construction.roofForm);
  const placement = canonical(construction.placement);
  const fallback = canonical(construction.systemName ?? construction.rawConstructionLabel);
  return [code || fallback, base, baseThickness, roof, placement].join("|");
}

/** 档位指纹只用于核对"同一条数据"，不参与身份推断。 */
export function optionFingerprint(option: RenderOption): string {
  return createHash("sha256").update(JSON.stringify([option.thicknessMm, option.productThermalResistance,
    option.totalThermalResistance, option.kValue, option.sourceRowLabel ?? null])).digest("hex").slice(0, 16);
}

export interface KnowledgeOptionIdentity {
  pageId: string;
  documentId: string;
  versionId: string;
  confirmedRevision: string;
  /** 快照是否带可复算的确认指纹；76/79 页为 v1 快照，无指纹时只能按内容核对。 */
  revisionVerified: boolean;
  constructionKey: string;
  constructionCode: string | null;
  thicknessMm: number | null;
  optionFingerprint: string;
}

/** 只读展示用的稳定标识；不含数组序号，可凭快照重算核验。 */
export function knowledgeOptionIdentity(input: {
  pageId: string; documentId: string; versionId: string; revision: string;
  construction: RenderConstruction; option: RenderOption;
}): KnowledgeOptionIdentity {
  return {
    pageId: input.pageId, documentId: input.documentId, versionId: input.versionId,
    confirmedRevision: input.revision, revisionVerified: Boolean(input.revision),
    constructionKey: constructionKey(input.construction),
    constructionCode: input.construction.constructionCode ?? null,
    thicknessMm: input.option.thicknessMm ?? null, optionFingerprint: optionFingerprint(input.option)
  };
}

export type ResolveOutcome =
  | { status: "RESOLVED"; construction: RenderConstruction; option: RenderOption }
  | { status: "CONSTRUCTION_NOT_FOUND"; candidates: string[] }
  | { status: "THICKNESS_NOT_FOUND"; construction: RenderConstruction; availableThickness: Array<number | null> }
  | { status: "AMBIGUOUS"; options: Array<{ construction: RenderConstruction; option: RenderOption }> }
  | { status: "STALE_REVISION"; currentRevision: string | null }
  | { status: "REVISION_UNVERIFIABLE" };

/**
 * 用当前快照重验一个选择：先按内容键定位构造，再按厚度定位档位。
 * 同一键同一厚度出现多条时返回 AMBIGUOUS，由调用方要求用户补充信息，禁止任取第一条。
 */
export function resolveKnowledgeOption(model: KnowledgePageRenderModel, selection: {
  constructionCode?: string | null; constructionLabel?: string | null; thicknessMm: number | null;
  confirmedRevision?: string | null;
}): ResolveOutcome {
  const revision = model.confirmedRevision ?? null;
  if (selection.confirmedRevision && revision && selection.confirmedRevision !== revision) {
    return { status: "STALE_REVISION", currentRevision: revision };
  }
  // 客户端声称有快照指纹、但当前快照不带指纹时，不能默认"一致"。
  if (selection.confirmedRevision && !revision) return { status: "REVISION_UNVERIFIABLE" };
  const code = canonical(selection.constructionCode);
  const label = canonical(selection.constructionLabel);
  const matched = model.constructions.filter(item => {
    if (code && canonical(item.constructionCode) === code) return true;
    if (!code && label && (canonical(item.rawConstructionLabel) === label || canonical(item.systemName) === label)) return true;
    return false;
  });
  if (!matched.length) return { status: "CONSTRUCTION_NOT_FOUND", candidates: model.constructions.map(item => item.constructionCode ?? item.systemName ?? "未命名构造") };
  const hits = matched.flatMap(construction => construction.options
    .filter(option => selection.thicknessMm == null || option.thicknessMm === selection.thicknessMm)
    .map(option => ({ construction, option })));
  if (!hits.length) {
    return { status: "THICKNESS_NOT_FOUND", construction: matched[0]!,
      availableThickness: [...new Set(matched.flatMap(item => item.options.map(option => option.thicknessMm ?? null)))].sort((a, b) => (a ?? 0) - (b ?? 0)) };
  }
  if (hits.length > 1) return { status: "AMBIGUOUS", options: hits };
  return { status: "RESOLVED", construction: hits[0]!.construction, option: hits[0]!.option };
}
