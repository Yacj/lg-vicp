/**
 * 知识页面视觉识别：状态机、结构化候选 schema、Prompt。
 * AI 识别结果仅为候选；正式 thermal_reference_rows / page-aware chunks 仅在人工确认后写入。
 *
 * 热工选项必须区分两种 R：
 * - productThermalResistance：保温产品/保温层自身热阻
 * - totalThermalResistance：外墙主断面总传热阻 R
 * 二者不得视为同一字段，禁止公式补算。
 */
import { z } from "zod";
import { AppError } from "./errors.js";

export const PAGE_RECOGNITION_STATUSES = [
  "PENDING",
  "PROCESSING",
  "REVIEW_REQUIRED",
  "CONFIRMED",
  "FAILED"
] as const;

export type PageRecognitionStatus = (typeof PAGE_RECOGNITION_STATUSES)[number];

export const pageRecognitionLayerSchema = z.object({
  order: z.number().int().nullable().optional(),
  name: z.string().min(1),
  thicknessMm: z.number().nullable().optional(),
  lambda: z.number().nullable().optional(),
  alpha: z.number().nullable().optional(),
  /** 构造层自身热阻（层属性，不是 option 级产品/总 R） */
  rValue: z.number().nullable().optional()
});

/**
 * 热工选项：产品层热阻 ≠ 外墙主断面总传热阻。
 * 旧字段 rValue 仅作历史 draft 兼容，新识别结果禁止再写。
 */
export const pageRecognitionOptionSchema = z.object({
  thicknessMm: z.number().nullable().optional(),
  productThermalResistance: z.number().nullable().optional(),
  totalThermalResistance: z.number().nullable().optional(),
  kValue: z.number().nullable().optional(),
  /** @deprecated 仅兼容历史 recognition draft；新识别不再输出 */
  rValue: z.number().nullable().optional()
});

export const pageRecognitionSystemSchema = z.object({
  systemName: z.string().nullable().optional(),
  specClass: z.enum(["I", "II", "III"]).nullable().optional(),
  constructionCode: z.string().nullable().optional(),
  baseMaterial: z.string().nullable().optional(),
  baseThicknessMm: z.number().nullable().optional(),
  layers: z.array(pageRecognitionLayerSchema).optional(),
  options: z.array(pageRecognitionOptionSchema).optional()
});

export const pageRecognitionResultSchema = z.object({
  pageLabel: z.string().nullable().optional(),
  pageTitle: z.string().nullable().optional(),
  fullText: z.string().default(""),
  systems: z.array(pageRecognitionSystemSchema).default([]),
  notes: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional()
});

export type PageRecognitionResult = z.infer<typeof pageRecognitionResultSchema>;
export type PageRecognitionOption = z.infer<typeof pageRecognitionOptionSchema>;

/** knowledge_pages.metadata 中的页面识别扩展字段 */
export type PageRecognitionMetadata = {
  recognitionStatus?: PageRecognitionStatus;
  recognitionModel?: string | null;
  recognitionConfidence?: number | null;
  recognitionWarnings?: string[];
  /** 当前候选（含重新识别结果）；CONFIRMED 前不写正式热工行 */
  structuredData?: PageRecognitionResult | null;
  /** 与 structuredData 同义，便于 B 端展示草稿 */
  draftStructuredData?: PageRecognitionResult | null;
  /** 上次人工确认快照；重新识别时保留直到再次确认 */
  confirmedStructuredData?: PageRecognitionResult | null;
  confirmedAt?: string | null;
  confirmedById?: string | null;
  lastRecognitionAt?: string | null;
  lastRecognitionError?: string | null;
  imageWarnings?: string[];
  uploadSource?: "BATCH" | "ZIP" | "MANUAL" | "LIBREOFFICE" | string;
  originalFileName?: string | null;
};

export const PAGE_RECOGNITION_SYSTEM_PROMPT = [
  "你在读取建筑热工图集页面。",
  "只提取页面真实存在的数据。",
  "不要根据公式补算缺失值。",
  "不要根据上下文猜测模糊数字。",
  "无法确定时返回 null 并写 warnings。",
  "必须区分三种数值，禁止混用：",
  "1) productThermalResistance：保温产品/保温层自身热阻（产品层热阻）；",
  "2) totalThermalResistance：外墙主断面总传热阻 R；",
  "3) kValue：传热系数 K。",
  "productThermalResistance 与 totalThermalResistance 不是同一字段；页面只明确出现其中一个时，另一个必须返回 null。",
  "禁止根据公式由产品层热阻推算总传热阻，或由总传热阻推算产品层热阻，或自行计算 K。",
  "不要修正 R、不要判断业务是否合规、不要自动发布正式数据。",
  "必须保持 thickness / productThermalResistance / totalThermalResistance / K 的同行对应关系。",
  "一个页面存在多个构造时分成多个 system；同一构造多厚度必须进入 options[]。",
  "options 中不要再输出旧字段 rValue。",
  "必须输出结构化 JSON，字段遵循给定 schema；fullText 保留页面可读原文。"
].join("\n");

export type ResolvedOptionResistances = {
  productThermalResistance: number | null;
  totalThermalResistance: number | null;
  kValue: number | null;
  thicknessMm: number | null;
  warnings: string[];
  /** true：语义不明或字段不全，不得写入正式 thermal_reference_rows */
  skipFormalWrite: boolean;
};

/**
 * 解析 option 热阻映射。
 * - 新字段优先；
 * - 仅有旧 rValue 时不猜测语义，不自动写入两个正式 R；
 * - 禁止 total=product 或 product=total fallback。
 */
export function resolveOptionThermalResistances(opt: PageRecognitionOption): ResolvedOptionResistances {
  const thicknessMm = opt.thicknessMm ?? null;
  const kValue = opt.kValue ?? null;
  const hasProduct = opt.productThermalResistance != null;
  const hasTotal = opt.totalThermalResistance != null;
  const hasLegacyR = opt.rValue != null;
  const warnings: string[] = [];

  if (hasProduct || hasTotal) {
    if (hasLegacyR) {
      warnings.push("已使用拆分后的 productThermalResistance/totalThermalResistance，忽略旧字段 rValue");
    }
    const productThermalResistance = opt.productThermalResistance ?? null;
    const totalThermalResistance = opt.totalThermalResistance ?? null;
    const complete = thicknessMm != null
      && productThermalResistance != null
      && totalThermalResistance != null
      && kValue != null;
    if (!complete) {
      warnings.push("选项缺少 thickness / 产品层热阻 / 总传热阻 / K 中的完整字段，跳过正式热工行写入");
    }
    return {
      productThermalResistance,
      totalThermalResistance,
      kValue,
      thicknessMm,
      warnings,
      skipFormalWrite: !complete
    };
  }

  if (hasLegacyR) {
    warnings.push(
      "历史候选仅含 rValue，无法区分产品层热阻与外墙主断面总传热阻；请管理员重新填写后再确认，不会自动写入正式热工行"
    );
    return {
      productThermalResistance: null,
      totalThermalResistance: null,
      kValue,
      thicknessMm,
      warnings,
      skipFormalWrite: true
    };
  }

  warnings.push("选项缺少热阻字段，跳过正式热工行写入");
  return {
    productThermalResistance: null,
    totalThermalResistance: null,
    kValue,
    thicknessMm,
    warnings,
    skipFormalWrite: true
  };
}

export function emptyRecognitionMetadata(
  overrides: Partial<PageRecognitionMetadata> = {}
): PageRecognitionMetadata {
  return {
    recognitionStatus: "PENDING",
    recognitionModel: null,
    recognitionConfidence: null,
    recognitionWarnings: [],
    structuredData: null,
    draftStructuredData: null,
    confirmedStructuredData: null,
    confirmedAt: null,
    confirmedById: null,
    lastRecognitionAt: null,
    lastRecognitionError: null,
    imageWarnings: [],
    ...overrides
  };
}

export function readPageRecognitionMeta(
  metadata: Record<string, unknown> | null | undefined
): PageRecognitionMetadata {
  if (!metadata || typeof metadata !== "object") return emptyRecognitionMetadata();
  const status = metadata.recognitionStatus;
  const structured = metadata.structuredData && typeof metadata.structuredData === "object"
    ? (metadata.structuredData as PageRecognitionResult)
    : metadata.draftStructuredData && typeof metadata.draftStructuredData === "object"
      ? (metadata.draftStructuredData as PageRecognitionResult)
      : null;
  return {
    recognitionStatus: PAGE_RECOGNITION_STATUSES.includes(status as PageRecognitionStatus)
      ? (status as PageRecognitionStatus)
      : undefined,
    recognitionModel: typeof metadata.recognitionModel === "string" ? metadata.recognitionModel : null,
    recognitionConfidence: typeof metadata.recognitionConfidence === "number"
      ? metadata.recognitionConfidence
      : null,
    recognitionWarnings: Array.isArray(metadata.recognitionWarnings)
      ? metadata.recognitionWarnings.filter((item): item is string => typeof item === "string")
      : [],
    structuredData: structured,
    draftStructuredData: structured,
    confirmedStructuredData: metadata.confirmedStructuredData && typeof metadata.confirmedStructuredData === "object"
      ? (metadata.confirmedStructuredData as PageRecognitionResult)
      : null,
    confirmedAt: typeof metadata.confirmedAt === "string" ? metadata.confirmedAt : null,
    confirmedById: typeof metadata.confirmedById === "string" ? metadata.confirmedById : null,
    lastRecognitionAt: typeof metadata.lastRecognitionAt === "string" ? metadata.lastRecognitionAt : null,
    lastRecognitionError: typeof metadata.lastRecognitionError === "string"
      ? metadata.lastRecognitionError
      : null,
    imageWarnings: Array.isArray(metadata.imageWarnings)
      ? metadata.imageWarnings.filter((item): item is string => typeof item === "string")
      : [],
    uploadSource: typeof metadata.uploadSource === "string" ? metadata.uploadSource : undefined,
    originalFileName: typeof metadata.originalFileName === "string" ? metadata.originalFileName : null
  };
}

export function mergePageMetadata(
  existing: Record<string, unknown> | null | undefined,
  patch: PageRecognitionMetadata
): Record<string, unknown> {
  const next = {
    ...(existing ?? {}),
    ...patch
  };
  // 保持 draftStructuredData 与 structuredData 同步
  if (patch.structuredData !== undefined) {
    next.draftStructuredData = patch.structuredData;
  } else if (patch.draftStructuredData !== undefined) {
    next.structuredData = patch.draftStructuredData;
    next.draftStructuredData = patch.draftStructuredData;
  }
  return next;
}

/** 从文件名提取 pageLabel：page-021.png → 21；page_021.jpg → 021；纯数字文件名保留 */
export function extractPageLabelFromFileName(fileName: string): string | null {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const pageDash = /^page[-_\s]?0*(\d+)$/i.exec(base);
  if (pageDash?.[1]) return pageDash[1];
  const trailing = /(\d+)$/.exec(base);
  if (trailing?.[1]) return String(Number.parseInt(trailing[1], 10));
  return null;
}

export const PAGE_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const PAGE_IMAGE_MIN_WIDTH_HINT = 1200;
export const PAGE_IMAGE_MIME = new Set(["image/png", "image/jpeg"]);

/** ZIP 安全限制 */
export const ZIP_MAX_IMAGE_ENTRIES = 200;
export const ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 300 * 1024 * 1024;
export const ZIP_MANIFEST_MAX_BYTES = 1 * 1024 * 1024;

/** 热工参考集仅 DRAFT 可写（PUBLISHED 不可变） */
export function assertThermalReferenceSetEditable(set: { status: string }): void {
  if (set.status !== "DRAFT") {
    throw new AppError(
      "THERMAL_REFERENCE_SET_NOT_EDITABLE",
      "已发布热工参考集不可直接修改，请创建新版本后再操作",
      409,
      { errorCode: "THERMAL_REFERENCE_SET_NOT_EDITABLE", status: set.status }
    );
  }
}

/** 已发布/停用知识版本不可原地改页图与识别 */
export function assertKnowledgeVersionEditable(version: { status: string }): void {
  if (version.status === "PUBLISHED" || version.status === "DISABLED") {
    throw new AppError(
      "KNOWLEDGE_VERSION_NOT_EDITABLE",
      "已发布知识版本不可直接修改，请创建新版本后再操作",
      409,
      { errorCode: "KNOWLEDGE_VERSION_NOT_EDITABLE", status: version.status }
    );
  }
}

export function isKnowledgeVersionEditable(status: string): boolean {
  return status !== "PUBLISHED" && status !== "DISABLED";
}

export function isThermalReferenceSetEditable(status: string): boolean {
  return status === "DRAFT";
}
