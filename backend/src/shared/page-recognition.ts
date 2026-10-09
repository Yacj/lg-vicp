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
  /** 管理员人工选择的已发布产品规格；AI 不应生成此字段。 */
  productSpecId: z.string().uuid().nullable().optional(),
  /** 可选的产品目录约束，用于缩小规格候选；AI 不应猜测。 */
  catalogProductId: z.string().uuid().nullable().optional(),
  thicknessMm: z.number().nullable().optional(),
  productThermalResistance: z.number().nullable().optional(),
  totalThermalResistance: z.number().nullable().optional(),
  kValue: z.number().nullable().optional(),
  /** @deprecated 仅兼容历史 recognition draft；新识别不再输出 */
  rValue: z.number().nullable().optional()
});

export const pageRecognitionSystemSchema = z.object({
  /** 管理员人工选择的已发布构造方案；AI 不应生成此字段。 */
  schemeId: z.string().uuid().nullable().optional(),
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

export function buildRecognitionDraft(input: {
  structuredData?: PageRecognitionResult | null;
  fallback?: PageRecognitionResult | null;
  pageLabel?: string | null;
  pageTitle?: string | null;
  parsedText?: string | null;
}): PageRecognitionResult {
  const base = pageRecognitionResultSchema.parse(input.structuredData ?? input.fallback ?? { fullText: "", systems: [] });
  return pageRecognitionResultSchema.parse({
    ...base,
    pageLabel: input.pageLabel !== undefined ? input.pageLabel : base.pageLabel,
    pageTitle: input.pageTitle !== undefined ? input.pageTitle : base.pageTitle,
    fullText: input.parsedText !== undefined ? (input.parsedText ?? "") : base.fullText
  });
}

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
  lastRecognitionErrorCode?: string | null;
  /** 当前有效识别任务标识，用于 single-flight 与阻止旧 Worker 覆盖。 */
  recognitionRunId?: string | null;
  /** 识别任务入队时间（ISO）：stale 对账据此判断 PENDING/PROCESSING 是否长期无对应队列任务。 */
  recognitionQueuedAt?: string | null;
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
  "notes 只记录提取方式等说明；warnings 只记录需要人工核对的原图歧义、数值冲突或异常。正常的分层厚度、多厚度 options、字段来源说明和禁止补算不属于 warnings。",
  "必须区分三种数值，禁止混用：",
  "1) productThermalResistance：保温产品/保温层自身热阻（产品层热阻）；",
  "2) totalThermalResistance：外墙主断面总传热阻 R；",
  "3) kValue：传热系数 K。",
  "productThermalResistance 与 totalThermalResistance 不是同一字段；页面只明确出现其中一个时，另一个必须返回 null。",
  "禁止根据公式由产品层热阻推算总传热阻，或由总传热阻推算产品层热阻，或自行计算 K。",
  "不要修正 R、不要判断业务是否合规、不要自动发布正式数据。",
  "必须保持 thicknessMm / productThermalResistance / totalThermalResistance / kValue 的同行对应关系。",
  "一个页面存在多个构造时分成多个 systems[] 元素；同一构造多厚度必须进入 options[]。",
  "读取合并单元格表格时，先按构造编号分组，再将厚度列的每一行与同一水平行的产品层热阻、外墙主断面总传热阻和传热系数对应；同一构造的合并单元格值可用于该组各行，不得把相邻构造的数值串行。",
  "同一产品层有多个厚度档时，layers[] 中该层的 thicknessMm 和 rValue 填 null；每档厚度及该层热阻写入 options[] 的 thicknessMm 和 productThermalResistance。该层共同的 lambda、alpha 仍保留在 layers[]。这种正常表格结构不要写入 warnings。",
  "表格中若分别列出构造层热阻与外墙主断面总传热阻，前者只属于对应构造层或产品层，后者只写入 options[].totalThermalResistance；逐档抄录原数值，不补算、不四舍五入。",
  "只输出一个完整 JSON 对象，不要 Markdown 代码块、解释文字或额外字段。",
  "顶层字段仅为 pageLabel、pageTitle、fullText、systems、notes、warnings；fullText 保留页面可读原文，不要在各构造中重复全文。",
  "systems[] 元素仅使用 systemName、specClass、constructionCode、baseMaterial、baseThicknessMm、layers、options。",
  "layers[] 元素仅使用 order、name、thicknessMm、lambda、alpha、rValue；这里的 rValue 仅表示该构造层自身热阻。",
  "options[] 元素仅使用 thicknessMm、productThermalResistance、totalThermalResistance、kValue，禁止使用 rValue。",
  "fullText 必须是字符串；layers[].name 必须是非空字符串；specClass 只能是 I、II、III 或 null。",
  "厚度、热阻、K、lambda、alpha 和 order 必须是 JSON 数字或 null，不要把单位写入数字，也不要输出数字字符串；notes 与 warnings 必须是字符串数组。",
  "没有的数值填 null，没有的数组填 []；不要输出 physicalPageNumber、systemCode、constructionLayers、layerName、thickness、thermalConductivity、correctionFactor、thermalResistance 等别名。"
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

/**
 * 页面是否存在「排队中或执行中」的识别任务。
 * - PROCESSING：Worker 正在识别；
 * - PENDING + recognitionRunId：任务已入队但 Worker 尚未开始（或已失败回退前）。
 * 二者期间都必须禁止人工写回识别数据，否则排队中的 Worker 会静默覆盖人工结果。
 */
export function isPageRecognitionBusy(meta: PageRecognitionMetadata): boolean {
  return meta.recognitionStatus === "PROCESSING"
    || (meta.recognitionStatus === "PENDING" && Boolean(meta.recognitionRunId));
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
    lastRecognitionErrorCode: null,
    recognitionRunId: null,
    recognitionQueuedAt: null,
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
    lastRecognitionErrorCode: typeof metadata.lastRecognitionErrorCode === "string"
      ? metadata.lastRecognitionErrorCode : null,
    recognitionRunId: typeof metadata.recognitionRunId === "string" ? metadata.recognitionRunId : null,
    recognitionQueuedAt: typeof metadata.recognitionQueuedAt === "string" ? metadata.recognitionQueuedAt : null,
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

/**
 * 页面文件自然排序：page-1 < page-2 < page-10（不依赖浏览器选择顺序）。
 * ZIP 导入与普通批量上传共用同一套规则，避免两套页序逻辑。
 */
export function naturalPageSort<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b), undefined, { numeric: true, sensitivity: "base" }));
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

export function isThermalReferenceSetEditable(status: string): boolean {
  return status === "DRAFT";
}
