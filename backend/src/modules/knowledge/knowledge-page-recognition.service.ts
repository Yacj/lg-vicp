/**
 * 页面视觉识别：触发/重试/草稿/确认。
 * AI 结果仅为候选（REVIEW_REQUIRED）；Confirm 在单事务内写 page-aware chunks 与 thermal_reference_rows。
 */
import { generateObject, NoObjectGeneratedError } from "ai";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AuthUser } from "../../shared/auth-user.js";
import { AppError, NotFoundError } from "../../shared/errors.js";
import type { DbExecutor } from "../../db/client.js";
import {
  PAGE_RECOGNITION_SYSTEM_PROMPT,
  buildRecognitionDraft,
  assertThermalReferenceSetEditable,
  isPageRecognitionBusy,
  isThermalReferenceSetEditable,
  mergePageMetadata,
  pageRecognitionResultSchema,
  readPageRecognitionMeta,
  resolveOptionThermalResistances,
  type PageRecognitionMetadata,
  type PageRecognitionResult
} from "../../shared/page-recognition.js";
import { assertKnowledgeVersionEditable, isKnowledgeVersionEditable } from "./knowledge-version-guard.js";
import { getPageImageDownloadName } from "./knowledge-page-image.js";
import { renderKnowledgePage } from "./knowledge-page-renderer.js";
import {
  constructionSchemes,
  knowledgeChunks,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgePages,
  productSpecs,
  schemeProductOptions,
  thermalReferenceRows,
  thermalReferenceSets
} from "../../db/schema.js";
import { resolveDefaultVisionModel } from "../ai-config/ai-config.service.js";
import { languageModelSamplingOptions, getAiTaskRuntimePolicy } from "../ai-config/ai-task-runtime-policy.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { buildChunksFromPages, type AliasDictEntry } from "./knowledge-chunking.js";
import { markPageContentMutation, purgePageDerivedIndex, type PurgePageIndexResult } from "./knowledge-page-index.service.js";
import { normalizeSearchText } from "./knowledge.normalize.js";
import { normalizePageRecognitionAnnotations, pageRecognitionSchemaIssues, repairPageRecognitionText } from "./knowledge-page-recognition-output.js";

const VISION_URL_TTL = 600;

export function describePageRecognitionFailure(error: unknown, schemaIssues: string[] = []): { code: string; message: string } {
  if (NoObjectGeneratedError.isInstance(error)) {
    return {
      code: "PAGE_RECOGNITION_OUTPUT_INVALID",
      message: `模型识别结果格式不符合要求${schemaIssues.length ? `（字段：${schemaIssues.join("、")}）` : ""}，请重试或人工填写识别草稿`
    };
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return { code: "PAGE_RECOGNITION_TIMEOUT", message: "页面识别超时，请重试" };
  }
  if (error instanceof Error && error.name === "AI_APICallError") {
    const responseBody = "responseBody" in error && typeof error.responseBody === "string" ? error.responseBody : "";
    const statusCode = "statusCode" in error ? error.statusCode : null;
    if (statusCode === 402 || /insufficient[\s_-]*balance|余额不足/i.test(`${error.message} ${responseBody}`)) {
      return {
        code: "PAGE_RECOGNITION_BALANCE_INSUFFICIENT",
        message: "图片识别服务余额不足，请联系平台管理员处理后重试"
      };
    }
  }
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: "PAGE_RECOGNITION_FAILED", message: "页面识别服务未能完成处理，请稍后重试" };
}

export function buildPageRecognitionPrompt(input: {
  documentTitle: string | null;
  pageLabel: string | null;
  physicalPageNumber: number;
  imageUrl: string;
}) {
  return {
    instructions: PAGE_RECOGNITION_SYSTEM_PROMPT,
    messages: [{
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: [
            `文档标题：${input.documentTitle ?? "未知"}`,
            `当前 pageLabel：${input.pageLabel ?? ""}`,
            `当前 physicalPageNumber：${input.physicalPageNumber}`,
            "请识别本页完整图片，输出 PageRecognitionResult JSON。",
            "options 必须分别填写 productThermalResistance 与 totalThermalResistance，不要输出 rValue。"
          ].join("\n")
        },
        { type: "image" as const, image: new URL(input.imageUrl) }
      ]
    }]
  };
}

function mappingError(
  code: "PAGE_RECOGNITION_MAPPING_AMBIGUOUS" | "PAGE_RECOGNITION_MAPPING_INVALID",
  message: string,
  details: Record<string, unknown>
): never {
  throw new AppError(code, message, 400, details);
}

function isPublishedEffective(row: { status: string; effectiveAt?: Date | null; expiresAt?: Date | null }): boolean {
  const now = new Date();
  return row.status === "PUBLISHED"
    && (!row.effectiveAt || row.effectiveAt <= now)
    && (!row.expiresAt || row.expiresAt >= now);
}

async function resolveSchemeMapping(
  db: DbExecutor,
  system: PageRecognitionResult["systems"][number]
) {
  const code = system.constructionCode?.trim();
  if (system.schemeId) {
    const [scheme] = await db.select().from(constructionSchemes)
      .where(eq(constructionSchemes.id, system.schemeId)).limit(1);
    if (!scheme || !isPublishedEffective(scheme) || (code && scheme.schemeCode !== code)) {
      mappingError("PAGE_RECOGNITION_MAPPING_INVALID", "人工选择的构造方案与识别数据不兼容", {
        mappingStatus: "NOT_FOUND",
        schemeId: system.schemeId,
        constructionCode: code ?? null
      });
    }
    return scheme;
  }
  if (!code) return null;
  const candidates = (await db.select().from(constructionSchemes).where(and(
    eq(constructionSchemes.schemeCode, code),
    eq(constructionSchemes.status, "PUBLISHED")
  )).limit(21)).filter(isPublishedEffective);
  if (candidates.length > 1) {
    mappingError("PAGE_RECOGNITION_MAPPING_AMBIGUOUS", `构造编号 ${code} 匹配到多个已发布方案，请人工选择`, {
      mappingStatus: "AMBIGUOUS",
      constructionCode: code,
      schemeCandidates: candidates.map((item) => ({
        id: item.id,
        schemeCode: item.schemeCode,
        name: item.name,
        systemId: item.systemId,
        version: item.version
      }))
    });
  }
  return candidates[0] ?? null;
}

async function resolveProductSpecMapping(
  db: DbExecutor,
  schemeId: string,
  system: PageRecognitionResult["systems"][number],
  option: NonNullable<PageRecognitionResult["systems"][number]["options"]>[number],
  thicknessMm: number
) {
  const conditions = [
    eq(productSpecs.status, "PUBLISHED"),
    eq(productSpecs.thicknessMm, thicknessMm)
  ];
  if (system.specClass) conditions.push(eq(productSpecs.specClass, system.specClass));
  if (option.catalogProductId) conditions.push(eq(productSpecs.catalogProductId, option.catalogProductId));
  if (option.productSpecId) conditions.push(eq(productSpecs.id, option.productSpecId));
  const specs = (await db.select().from(productSpecs).where(and(...conditions)).limit(21)).filter(isPublishedEffective);
  const optionRows = specs.length > 0
    ? await db.select().from(schemeProductOptions).where(and(
        eq(schemeProductOptions.schemeId, schemeId),
        inArray(schemeProductOptions.productSpecId, specs.map((item) => item.id))
      ))
    : [];
  const allowedIds = new Set(optionRows.map((item) => item.productSpecId));
  const candidates = specs.filter((item) => allowedIds.has(item.id));
  if (option.productSpecId && candidates.length !== 1) {
    mappingError("PAGE_RECOGNITION_MAPPING_INVALID", "人工选择的产品规格不存在、未发布或不属于该构造方案", {
      mappingStatus: "NOT_FOUND",
      schemeId,
      productSpecId: option.productSpecId,
      thicknessMm,
      specClass: system.specClass ?? null
    });
  }
  if (candidates.length > 1) {
    mappingError("PAGE_RECOGNITION_MAPPING_AMBIGUOUS", `厚度 ${thicknessMm}mm 匹配到多个产品规格，请人工选择`, {
      mappingStatus: "AMBIGUOUS",
      schemeId,
      thicknessMm,
      specClass: system.specClass ?? null,
      productSpecCandidates: candidates.map((item) => ({
        id: item.id,
        catalogProductId: item.catalogProductId,
        specCode: item.specCode,
        specClass: item.specClass,
        thicknessMm: item.thicknessMm,
        version: item.version
      }))
    });
  }
  return candidates[0] ?? null;
}

async function requirePage(db: DbExecutor, pageId: string) {
  const [page] = await db.select().from(knowledgePages).where(eq(knowledgePages.id, pageId)).limit(1);
  if (!page) throw new NotFoundError("页面不存在");
  return page;
}

async function requireVersionForPage(db: DbExecutor, versionId: string) {
  const [version] = await db.select().from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");
  return version;
}

export async function getPageRecognition(app: FastifyInstance, pageId: string) {
  const page = await requirePage(app.db, pageId);
  const version = await requireVersionForPage(app.db, page.versionId);
  const meta = readPageRecognitionMeta(page.metadata);
  let pageImageUrl: string | null = null;
  if (page.pageImageObjectKey) {
    pageImageUrl = await app.storage.createDownloadUrl(
      page.pageImageObjectKey,
      getPageImageDownloadName(page.pageImageObjectKey, page.physicalPageNumber),
      3600
    );
  }
  let thermalSetEditable: boolean | null = null;
  const linkedRows = await app.db.select({ setId: thermalReferenceRows.setId })
    .from(thermalReferenceRows).where(eq(thermalReferenceRows.sourcePageId, page.id));
  if (linkedRows.length > 0) {
    const setIds = [...new Set(linkedRows.map((row) => row.setId))];
    const linkedSets = await app.db.select({ id: thermalReferenceSets.id, status: thermalReferenceSets.status })
      .from(thermalReferenceSets).where(inArray(thermalReferenceSets.id, setIds));
    thermalSetEditable = linkedSets.length === setIds.length
      && linkedSets.every((set) => isThermalReferenceSetEditable(set.status));
  }
  return {
    pageId: page.id,
    versionId: page.versionId,
    documentId: page.documentId,
    physicalPageNumber: page.physicalPageNumber,
    pageLabel: page.pageLabel,
    pageTitle: page.pageTitle,
    parsedText: page.parsedText,
    pageImageUrl,
    recognitionStatus: meta.recognitionStatus ?? null,
    recognitionModel: meta.recognitionModel ?? null,
    recognitionConfidence: meta.recognitionConfidence ?? null,
    recognitionWarnings: meta.recognitionWarnings ?? [],
    structuredData: meta.structuredData ?? null,
    draftStructuredData: meta.draftStructuredData ?? meta.structuredData ?? null,
    confirmedStructuredData: meta.confirmedStructuredData ?? null,
    renderModel: renderKnowledgePage(page),
    confirmedAt: meta.confirmedAt ?? null,
    confirmedById: meta.confirmedById ?? null,
    confirmedBy: meta.confirmedById ?? null,
    lastRecognitionAt: meta.lastRecognitionAt ?? null,
    lastRecognitionError: meta.lastRecognitionError ?? null,
    lastRecognitionErrorCode: meta.lastRecognitionErrorCode ?? null,
    recognitionRunId: meta.recognitionRunId ?? null,
    reviewIssues: assessBatchConfirmSafety(meta.draftStructuredData ?? meta.structuredData ?? { fullText: "", systems: [] }).reasons,
    imageWarnings: meta.imageWarnings ?? [],
    versionStatus: version.status,
    versionEditable: isKnowledgeVersionEditable(version.status),
    thermalSetEditable
  };
}

export async function enqueuePageRecognition(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  pageId: string,
  options?: { reRecognize?: boolean }
) {
  const runId = randomUUID();
  const outcome = await app.db.transaction(async (tx) => {
    await tx.execute(sql`select id from knowledge_pages where id = ${pageId} for update`);
    const lockedPage = await requirePage(tx, pageId);
    const version = await requireVersionForPage(tx, lockedPage.versionId);
    assertKnowledgeVersionEditable(version);
    if (!lockedPage.pageImageObjectKey) {
      throw new AppError("PAGE_IMAGE_REQUIRED", "页面尚未绑定图片，无法识别", 400);
    }
    const meta = readPageRecognitionMeta(lockedPage.metadata);
    if (isPageRecognitionBusy(meta)) {
      throw new AppError("PAGE_RECOGNITION_IN_PROGRESS", "该页面已有识别任务正在排队或执行", 409, {
        errorCode: "PAGE_RECOGNITION_IN_PROGRESS",
        pageId,
        recognitionStatus: meta.recognitionStatus ?? "PENDING",
        recognitionRunId: meta.recognitionRunId ?? null
      });
    }
    const patch: PageRecognitionMetadata = {
      recognitionStatus: "PENDING",
      recognitionRunId: runId,
      recognitionQueuedAt: new Date().toISOString(),
      lastRecognitionError: null,
      lastRecognitionErrorCode: null
    };
    if (options?.reRecognize && meta.recognitionStatus === "CONFIRMED") {
      patch.confirmedStructuredData = meta.confirmedStructuredData ?? meta.structuredData;
      patch.confirmedAt = meta.confirmedAt;
      patch.confirmedById = meta.confirmedById;
    }
    await tx.update(knowledgePages).set({
      metadata: mergePageMetadata(lockedPage.metadata, { ...meta, ...patch })
    }).where(eq(knowledgePages.id, pageId));
    // 已确认页重新识别 = 识别重置（CONFIRMED → PENDING）：
    // 旧正式 page-aware index 必须「立即」退出当前版本的可测试索引——
    // 先清理该页派生的 chunks / page_blocks / 可编辑热工行，再登记 Page Mutation，
    // 否则会出现「页面显示正在重新识别，但 AI / Knowledge Test 仍命中旧正式正文」的语义不一致。
    // 已发布 / 已停用热工集不可变：其引用行不删除（lockedThermalRows 仅统计）。
    let purged: PurgePageIndexResult | null = null;
    if (meta.recognitionStatus === "CONFIRMED") {
      purged = await purgePageDerivedIndex(tx, lockedPage);
      await markPageContentMutation(tx, lockedPage.versionId);
    }
    return { page: lockedPage, purged };
  });
  const page = outcome.page;

  try {
    await app.queues.pageRecognition.add(
      options?.reRecognize ? "re-recognize-page" : "recognize-page",
      { pageId, versionId: page.versionId, triggeredBy: actor.id, reRecognize: Boolean(options?.reRecognize), recognitionRunId: runId },
      { jobId: `page-recog-${pageId}`, removeOnComplete: true, removeOnFail: true }
    );
  } catch (error) {
    const latest = await requirePage(app.db, pageId);
    const latestMeta = readPageRecognitionMeta(latest.metadata);
    if (latestMeta.recognitionRunId === runId) {
      await app.db.update(knowledgePages).set({
        metadata: mergePageMetadata(latest.metadata, {
          ...latestMeta,
          recognitionStatus: "FAILED",
          recognitionRunId: runId,
          recognitionQueuedAt: null,
          lastRecognitionError: "识别任务入队失败",
          lastRecognitionErrorCode: "PAGE_RECOGNITION_QUEUE_FAILED"
        })
      }).where(eq(knowledgePages.id, pageId));
    }
    throw error;
  }
  await writeAuditLog({
    db: app.db, request, actor,
    action: options?.reRecognize ? "knowledge.page_re_recognize_queued" : "knowledge.page_recognize_queued",
    targetType: "knowledge_page",
    targetId: pageId,
    afterJson: {
      versionId: page.versionId,
      recognitionRunId: runId,
      indexInvalidated: outcome.purged != null,
      ...(outcome.purged ? {
        chunksDeleted: outcome.purged.chunksDeleted,
        blocksDeleted: outcome.purged.blocksDeleted,
        thermalRowsDeleted: outcome.purged.thermalRowsDeleted,
        lockedThermalRows: outcome.purged.lockedThermalRows
      } : {})
    }
  });
  return { message: options?.reRecognize ? "已排队重新识别" : "已排队识别", pageId, status: "PENDING" };
}

/** Worker 调用：执行视觉结构化识别并落候选（不写正式热工行） */
export async function runPageRecognitionJob(
  app: Pick<FastifyInstance, "db" | "storage" | "log">,
  pageId: string,
  recognitionRunId: string
): Promise<{ status: string; pageId: string }> {
  const page = await requirePage(app.db, pageId);
  let meta = readPageRecognitionMeta(page.metadata);
  if (!meta.recognitionRunId && meta.recognitionStatus === "PENDING") {
    const claimed = await app.db.update(knowledgePages).set({
      metadata: mergePageMetadata(page.metadata, { ...meta, recognitionRunId })
    }).where(and(
      eq(knowledgePages.id, pageId),
      sql`(${knowledgePages.metadata}->>'recognitionRunId') is null`
    )).returning({ id: knowledgePages.id });
    if (claimed.length > 0) meta = { ...meta, recognitionRunId };
  }
  if (meta.recognitionRunId !== recognitionRunId) {
    app.log.warn({ pageId, recognitionRunId, activeRunId: meta.recognitionRunId }, "忽略已失效的页面识别任务");
    return { status: "STALE", pageId };
  }
  const version = await requireVersionForPage(app.db, page.versionId);
  assertKnowledgeVersionEditable(version);
  if (!page.pageImageObjectKey) {
    throw new AppError("PAGE_IMAGE_REQUIRED", "页面尚未绑定图片", 400);
  }
  const started = await app.db.update(knowledgePages).set({
    metadata: mergePageMetadata(page.metadata, {
      ...meta,
      recognitionStatus: "PROCESSING",
      recognitionRunId,
      lastRecognitionError: null,
      lastRecognitionErrorCode: null
    })
  }).where(and(
    eq(knowledgePages.id, pageId),
    sql`${knowledgePages.metadata}->>'recognitionRunId' = ${recognitionRunId}`
  )).returning({ id: knowledgePages.id });
  if (started.length === 0) {
    app.log.warn({ pageId, recognitionRunId }, "识别启动前任务已失效，跳过执行");
    return { status: "STALE", pageId };
  }

  try {
    const [doc] = await app.db.select({ title: knowledgeDocuments.title })
      .from(knowledgeDocuments).where(eq(knowledgeDocuments.id, page.documentId)).limit(1);
    const vision = await resolveDefaultVisionModel(app.db);
    const imageUrl = await app.storage.createDownloadUrl(
      page.pageImageObjectKey,
      getPageImageDownloadName(page.pageImageObjectKey, page.physicalPageNumber),
      VISION_URL_TTL
    );

    const result = await generateObject({
      model: vision.languageModel,
      schema: pageRecognitionResultSchema,
      experimental_repairText: async ({ text }) => repairPageRecognitionText(text),
      ...buildPageRecognitionPrompt({
        documentTitle: doc?.title ?? null,
        pageLabel: page.pageLabel,
        physicalPageNumber: page.physicalPageNumber,
        imageUrl
      }),
      ...languageModelSamplingOptions("PAGE_RECOGNITION"),
      abortSignal: AbortSignal.timeout(getAiTaskRuntimePolicy("PAGE_RECOGNITION").timeoutMs)
    });

    const [latestPage] = await app.db.select().from(knowledgePages)
      .where(eq(knowledgePages.id, pageId)).limit(1);
    const latestRunMeta = readPageRecognitionMeta(latestPage?.metadata);
    if (!latestPage || latestRunMeta.recognitionRunId !== recognitionRunId || latestRunMeta.recognitionStatus !== "PROCESSING") {
      app.log.warn({ pageId, recognitionRunId }, "识别完成时任务已失效，丢弃旧结果");
      return { status: "STALE", pageId };
    }
    const [latestVersion] = await app.db.select().from(knowledgeDocumentVersions)
      .where(eq(knowledgeDocumentVersions.id, latestPage.versionId)).limit(1);
    if (!latestVersion) throw new NotFoundError("文档版本不存在");
    assertKnowledgeVersionEditable(latestVersion);

    const parsed = pageRecognitionResultSchema.parse(result.object);
    const hadLegacyRValue = parsed.systems.some((system) =>
      system.options?.some((option) => option.rValue != null)
    );
    const candidate = normalizePageRecognitionAnnotations({
      ...parsed,
      systems: parsed.systems.map((system) => ({
        ...system,
        options: system.options?.map(({ rValue: _legacyRValue, ...option }) => option)
      })),
      warnings: [
        ...(parsed.warnings ?? []),
        ...(hadLegacyRValue ? ["模型输出了旧字段 rValue，已移除；请分别确认产品层热阻与总传热阻"] : [])
      ]
    });
    const warnings = [
      ...(candidate.warnings ?? []),
      ...(meta.imageWarnings ?? [])
    ];

    const latestMeta = readPageRecognitionMeta(latestPage.metadata);
    const nextMeta = mergePageMetadata(latestPage.metadata, {
      ...latestMeta,
      recognitionStatus: "REVIEW_REQUIRED",
      recognitionRunId,
      recognitionModel: vision.modelRef.id,
      recognitionConfidence: null,
      recognitionWarnings: warnings,
      structuredData: candidate,
      draftStructuredData: candidate,
      // 保留已确认快照，避免重识别静默覆盖正式数据
      confirmedStructuredData: latestMeta.confirmedStructuredData,
      confirmedAt: latestMeta.confirmedAt,
      confirmedById: latestMeta.confirmedById,
      lastRecognitionAt: new Date().toISOString(),
      lastRecognitionError: null,
      lastRecognitionErrorCode: null
    });

    await app.db.update(knowledgePages).set({ metadata: nextMeta }).where(and(
      eq(knowledgePages.id, pageId),
      sql`${knowledgePages.metadata}->>'recognitionRunId' = ${recognitionRunId}`
    ));

    return { status: "REVIEW_REQUIRED", pageId };
  } catch (error) {
    const schemaIssues = NoObjectGeneratedError.isInstance(error)
      ? pageRecognitionSchemaIssues(error.text)
      : [];
    if (NoObjectGeneratedError.isInstance(error)) {
      app.log.warn({
        pageId,
        recognitionRunId,
        finishReason: error.finishReason,
        responseLength: error.text?.length ?? 0,
        schemaIssues
      }, "页面视觉识别输出未通过结构校验");
    }
    const failure = describePageRecognitionFailure(error, schemaIssues);
    app.log.warn({ pageId, recognitionRunId, errorCode: failure.code, errorName: error instanceof Error ? error.name : null }, "页面视觉识别失败");
    const [latestPage] = await app.db.select().from(knowledgePages).where(eq(knowledgePages.id, pageId)).limit(1);
    const latestMeta = readPageRecognitionMeta(latestPage?.metadata);
    const [latestVersion] = latestPage ? await app.db.select().from(knowledgeDocumentVersions)
      .where(eq(knowledgeDocumentVersions.id, latestPage.versionId)).limit(1) : [];
    if (latestPage && latestMeta.recognitionRunId === recognitionRunId && latestVersion && isKnowledgeVersionEditable(latestVersion.status)) {
      await app.db.update(knowledgePages).set({
        metadata: mergePageMetadata(latestPage.metadata, {
          ...latestMeta,
          recognitionStatus: "FAILED",
          recognitionRunId,
          lastRecognitionError: failure.message,
          lastRecognitionErrorCode: failure.code,
          lastRecognitionAt: new Date().toISOString()
        })
      }).where(and(eq(knowledgePages.id, pageId), sql`${knowledgePages.metadata}->>'recognitionRunId' = ${recognitionRunId}`));
    }
    throw error;
  }
}

/**
 * 保存人工识别草稿。
 *
 * 并发约束（与 enqueuePageRecognition 对同一 knowledge_pages 行串行化）：
 * - 事务内 SELECT ... FOR UPDATE 重新读取最新 metadata，禁止用预检时的旧快照整体写回，
 *   否则会把并发 enqueue 刚写入的 PENDING + recognitionRunId 覆盖掉；
 * - 识别任务「排队中（PENDING + recognitionRunId）」或「执行中（PROCESSING）」时拒绝写入，
 *   否则排队中的 Worker 启动后会把人工草稿改回 PROCESSING 并在识别完成后静默覆盖；
 * - 其余状态保持既有业务行为（REVIEW_REQUIRED / FAILED / CONFIRMED / 无识别均允许保存，落 REVIEW_REQUIRED）。
 */
export async function savePageRecognitionDraft(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  pageId: string,
  input: {
    structuredData?: PageRecognitionResult;
    pageLabel?: string | null;
    pageTitle?: string | null;
    parsedText?: string | null;
  }
) {
  const updated = await app.db.transaction(async (tx) => {
    await tx.execute(sql`select id from knowledge_pages where id = ${pageId} for update`);
    const [lockedPage] = await tx.select().from(knowledgePages).where(eq(knowledgePages.id, pageId)).limit(1);
    if (!lockedPage) throw new NotFoundError("页面不存在");
    const [lockedVersion] = await tx.select().from(knowledgeDocumentVersions)
      .where(eq(knowledgeDocumentVersions.id, lockedPage.versionId)).limit(1);
    if (!lockedVersion) throw new NotFoundError("文档版本不存在");
    assertKnowledgeVersionEditable(lockedVersion);

    const meta = readPageRecognitionMeta(lockedPage.metadata);
    if (isPageRecognitionBusy(meta)) {
      app.log.warn({
        pageId,
        versionId: lockedPage.versionId,
        recognitionStatus: meta.recognitionStatus ?? null,
        recognitionRunId: meta.recognitionRunId ?? null,
        operation: "save_recognition_draft"
      }, "拒绝保存页面识别草稿：识别任务正在排队或执行");
      throw new AppError(
        "PAGE_RECOGNITION_BUSY",
        "页面识别任务正在排队或执行，请等待识别完成后再编辑",
        409,
        {
          errorCode: "PAGE_RECOGNITION_BUSY",
          pageId,
          recognitionStatus: meta.recognitionStatus ?? "PENDING",
          recognitionRunId: meta.recognitionRunId ?? null
        }
      );
    }

    const structuredData = buildRecognitionDraft({
      structuredData: input.structuredData,
      fallback: meta.draftStructuredData ?? meta.structuredData ?? meta.confirmedStructuredData,
      pageLabel: input.pageLabel !== undefined ? input.pageLabel : (input.structuredData?.pageLabel ?? meta.draftStructuredData?.pageLabel ?? lockedPage.pageLabel),
      pageTitle: input.pageTitle !== undefined ? input.pageTitle : (input.structuredData?.pageTitle ?? meta.draftStructuredData?.pageTitle ?? lockedPage.pageTitle),
      parsedText: input.parsedText !== undefined ? input.parsedText : (input.structuredData?.fullText ?? meta.draftStructuredData?.fullText ?? meta.structuredData?.fullText ?? lockedPage.parsedText ?? "")
    });
    // 保留 recognitionRunId：REVIEW_REQUIRED 后的 runId 仅用于审计，Worker 完成态校验要求 status=PROCESSING，不会被再次消费。
    const nextMeta = mergePageMetadata(lockedPage.metadata, {
      ...meta,
      structuredData: structuredData ?? null,
      draftStructuredData: structuredData ?? null,
      recognitionStatus: "REVIEW_REQUIRED"
    });
    const [saved] = await tx.update(knowledgePages).set({
      pageLabel: structuredData.pageLabel ?? null,
      pageTitle: structuredData.pageTitle ?? null,
      parsedText: structuredData.fullText,
      pageLabelVerified: input.pageLabel !== undefined ? Boolean(input.pageLabel) : lockedPage.pageLabelVerified,
      metadata: nextMeta
    }).where(eq(knowledgePages.id, pageId)).returning();
    if (!saved) throw new NotFoundError("页面不存在");
    // 已确认页保存新草稿 = 识别重置（CONFIRMED → REVIEW_REQUIRED）：正式正文退出正式索引，
    // 必须先清理该页派生索引（chunks / page_blocks / 可编辑热工行）再登记 Page Mutation，
    // 避免出现「索引仍含旧正文、状态却已非 CONFIRMED」的漂移，或草稿正文被误当作正式内容检索。
    // 已发布 / 已停用热工集不可变：其引用行不删除。
    if (meta.recognitionStatus === "CONFIRMED") {
      await purgePageDerivedIndex(tx, lockedPage);
      await markPageContentMutation(tx, lockedPage.versionId);
    }
    return saved;
  });

  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.page_recognition_draft_saved",
    targetType: "knowledge_page",
    targetId: pageId,
    afterJson: { recognitionStatus: "REVIEW_REQUIRED" }
  });
  return { page: updated, recognition: await getPageRecognition(app, pageId) };
}

async function rebuildPageAwareChunks(
  db: DbExecutor,
  page: typeof knowledgePages.$inferSelect,
  text: string
) {
  await db.execute(sql`
    DELETE FROM knowledge_chunks
    WHERE version_id = ${page.versionId}
      AND metadata->>'pageId' = ${page.id}
  `);

  const aliases: AliasDictEntry[] = [];
  const chunks = buildChunksFromPages(
    [{ page: page.physicalPageNumber, text }],
    aliases
  );

  if (chunks.length === 0 && text.trim()) {
    chunks.push({
      content: text.trim().slice(0, 1200),
      sourcePage: page.physicalPageNumber,
      pageEnd: page.physicalPageNumber,
      headingLevel: 0,
      contentType: "PARAGRAPH",
      sourceSection: page.pageTitle ?? null,
      searchText: normalizeSearchText(text),
      keywords: [],
      aliasTerms: [],
      citationAnchor: null,
      metadata: {}
    });
  }

  const [maxRow] = await db.select({
    maxIndex: sql<number>`coalesce(max(${knowledgeChunks.chunkIndex}), -1)`
  }).from(knowledgeChunks).where(eq(knowledgeChunks.versionId, page.versionId));
  let chunkIndex = Number(maxRow?.maxIndex ?? -1) + 1;

  for (const chunk of chunks) {
    await db.insert(knowledgeChunks).values({
      documentId: page.documentId,
      versionId: page.versionId,
      chunkIndex: chunkIndex++,
      content: chunk.content,
      sourcePage: page.physicalPageNumber,
      pageEnd: page.physicalPageNumber,
      sourceSection: chunk.sourceSection ?? page.pageTitle,
      headingLevel: chunk.headingLevel,
      contentType: chunk.contentType,
      searchText: chunk.searchText || normalizeSearchText(chunk.content),
      keywords: chunk.keywords,
      aliasTerms: chunk.aliasTerms,
      citationAnchor: chunk.citationAnchor,
      metadata: {
        ...(chunk.metadata ?? {}),
        pageId: page.id,
        physicalPageNumber: page.physicalPageNumber,
        pageLabel: page.pageLabel,
        documentId: page.documentId,
        versionId: page.versionId,
        pageAware: true
      }
    });
  }
  return chunks.length;
}

/**
 * 同步当前页 thermal_reference_rows：先删本 pageId 旧行，再按确认数据写入。
 * 仅 DRAFT 集可写；product/total R 分别映射，禁止互为 fallback。
 */
export async function syncThermalRowsFromConfirmedPage(
  db: DbExecutor,
  actor: AuthUser,
  page: typeof knowledgePages.$inferSelect,
  structured: PageRecognitionResult,
  thermalSetId: string
): Promise<{ upserted: number; warnings: string[]; skipped: number; mappingIssues: Array<Record<string, unknown>> }> {
  const warnings: string[] = [];
  const mappingIssues: Array<Record<string, unknown>> = [];
  const [set] = await db.select().from(thermalReferenceSets)
    .where(eq(thermalReferenceSets.id, thermalSetId)).limit(1);
  if (!set) throw new AppError("THERMAL_SET_NOT_FOUND", "热工参考集不存在", 400);
  assertThermalReferenceSetEditable(set);

  // 只清当前页绑定行，不碰整个 set
  await db.delete(thermalReferenceRows).where(and(
    eq(thermalReferenceRows.sourcePageId, page.id),
    eq(thermalReferenceRows.setId, thermalSetId)
  ));

  let upserted = 0;
  let skipped = 0;
  for (const system of structured.systems ?? []) {
    if (!(system.options?.length)) continue;
    const code = system.constructionCode?.trim();
    if (!code) {
      warnings.push(`系统「${system.systemName ?? "未命名"}」缺少 constructionCode，跳过热工同步`);
      mappingIssues.push({ mappingStatus: "NOT_FOUND", kind: "SCHEME", constructionCode: null });
      skipped += 1;
      continue;
    }
    const scheme = await resolveSchemeMapping(db, system);
    if (!scheme) {
      warnings.push(`未找到已发布构造方案 schemeCode=${code}`);
      mappingIssues.push({ mappingStatus: "NOT_FOUND", kind: "SCHEME", constructionCode: code });
      skipped += 1;
      continue;
    }

    for (const opt of system.options ?? []) {
      const resolved = resolveOptionThermalResistances(opt);
      warnings.push(...resolved.warnings.map((w) => `构造 ${code}: ${w}`));
      if (resolved.skipFormalWrite) {
        skipped += 1;
        continue;
      }

      const thicknessMm = resolved.thicknessMm!;
      const productThermalResistance = resolved.productThermalResistance!;
      const totalThermalResistance = resolved.totalThermalResistance!;
      const kValue = resolved.kValue!;

      const spec = await resolveProductSpecMapping(db, scheme.id, system, opt, thicknessMm);
      if (!spec) {
        warnings.push(`构造 ${code} 厚度 ${thicknessMm}mm 未匹配属于该方案的已发布产品规格`);
        mappingIssues.push({
          mappingStatus: "NOT_FOUND",
          kind: "PRODUCT_SPEC",
          schemeId: scheme.id,
          constructionCode: code,
          thicknessMm,
          specClass: system.specClass ?? null
        });
        skipped += 1;
        continue;
      }

      const evidenceRef = `page:${page.pageLabel ?? page.physicalPageNumber}`;
      await db.insert(thermalReferenceRows).values({
        setId: thermalSetId,
        schemeId: scheme.id,
        productSpecId: spec.id,
        catalogProductId: spec.catalogProductId,
        thicknessMm,
        productThermalResistance,
        totalThermalResistance,
        kValue,
        sourceDocumentId: page.documentId,
        sourcePageId: page.id,
        sourcePageLabel: page.pageLabel,
        sortOrder: upserted,
        rawThickness: String(thicknessMm),
        rawProductResistance: String(productThermalResistance),
        rawTotalResistance: String(totalThermalResistance),
        rawKValue: String(kValue),
        evidenceSource: "knowledge_page_recognition",
        evidenceRef,
        evidenceLevel: "B",
        createdById: actor.id,
        updatedById: actor.id
      });
      upserted += 1;
    }
  }
  return { upserted, warnings, skipped, mappingIssues };
}

export async function confirmPageRecognition(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  pageId: string,
    input?: { thermalSetId?: string | null }
) {
  const page = await requirePage(app.db, pageId);
  const version = await requireVersionForPage(app.db, page.versionId);
  assertKnowledgeVersionEditable(version);

  const result = await app.db.transaction(async (tx) => {
    // 事务内重新读取并校验，避免预检后版本/页面状态被并发修改。
    await tx.execute(sql`select id from knowledge_pages where id = ${pageId} for update`);
    const [lockedPage] = await tx.select().from(knowledgePages).where(eq(knowledgePages.id, pageId)).limit(1);
    if (!lockedPage) throw new NotFoundError("页面不存在");
    const [lockedVersion] = await tx.select().from(knowledgeDocumentVersions)
      .where(eq(knowledgeDocumentVersions.id, lockedPage.versionId)).limit(1);
    if (!lockedVersion) throw new NotFoundError("文档版本不存在");
    assertKnowledgeVersionEditable(lockedVersion);
    if (input?.thermalSetId) {
      const [lockedSet] = await tx.select().from(thermalReferenceSets)
        .where(eq(thermalReferenceSets.id, input.thermalSetId)).limit(1);
      if (!lockedSet) throw new AppError("THERMAL_SET_NOT_FOUND", "热工参考集不存在", 400);
      assertThermalReferenceSetEditable(lockedSet);
    }
    const currentMeta = readPageRecognitionMeta(lockedPage.metadata);
    if (currentMeta.recognitionStatus !== "REVIEW_REQUIRED") {
      const code = currentMeta.recognitionStatus === "CONFIRMED"
        ? "PAGE_RECOGNITION_ALREADY_CONFIRMED"
        : "PAGE_RECOGNITION_NOT_READY";
      throw new AppError(code, currentMeta.recognitionStatus === "CONFIRMED"
        ? "该页面识别结果已经确认"
        : `页面识别状态为 ${currentMeta.recognitionStatus ?? "PENDING"}，仅 REVIEW_REQUIRED 可确认`, 409, {
        pageId,
        recognitionStatus: currentMeta.recognitionStatus ?? "PENDING"
      });
    }
    const currentStructured = pageRecognitionResultSchema.parse(currentMeta.draftStructuredData);
    if (!currentStructured.fullText?.trim()) {
      throw new AppError("PAGE_RECOGNITION_INCOMPLETE", "确认前需要页面全文（fullText/parsedText）", 400);
    }
    const currentText = currentStructured.fullText ?? "";
    const currentPageForChunks = {
      ...lockedPage,
      pageLabel: currentStructured.pageLabel?.trim() ?? null,
      pageTitle: currentStructured.pageTitle?.trim() ?? null,
      parsedText: currentText
    };
    const chunkCount = await rebuildPageAwareChunks(tx, currentPageForChunks, currentText);

    let thermal = { upserted: 0, warnings: [] as string[], skipped: 0, mappingIssues: [] as Array<Record<string, unknown>> };
    if (input?.thermalSetId) {
      thermal = await syncThermalRowsFromConfirmedPage(tx, actor, { ...lockedPage, pageLabel: currentPageForChunks.pageLabel }, currentStructured, input.thermalSetId);
    } else if (currentStructured.systems?.some((system) => (system.options?.length ?? 0) > 0)) {
      thermal.warnings.push("页面已确认并可用于资料问答；未选择可编辑的热工参考集，参考档位尚未同步到方案查询");
    }

    const nextMeta = mergePageMetadata(lockedPage.metadata, {
      ...currentMeta,
      recognitionStatus: "CONFIRMED",
      structuredData: currentStructured,
      draftStructuredData: currentStructured,
      confirmedStructuredData: currentStructured,
      confirmedAt: new Date().toISOString(),
      confirmedById: actor.id,
      recognitionWarnings: [
        ...(currentStructured.warnings ?? []),
        ...thermal.warnings
      ]
    });

    await tx.update(knowledgePages).set({
      parsedText: currentText,
      pageLabel: currentStructured.pageLabel?.trim() ?? null,
      pageTitle: currentStructured.pageTitle?.trim() ?? null,
      pageLabelVerified: true,
      metadata: nextMeta
    }).where(eq(knowledgePages.id, pageId));

    // 单页 Confirm 只产出「即时 page-aware chunk」用于人工即时测试；
    // 正式发布索引必须由版本级 rebuild 统一重建，因此这里统一登记一次 Page Mutation
    // （contentRevision++ / indexDirty=true），供 rebuild 的 CAS 与发布门禁比对。
    await markPageContentMutation(tx, page.versionId);

    await writeAuditLog({
      db: tx, request, actor,
      action: "knowledge.page_recognition_confirmed",
      targetType: "knowledge_page",
      targetId: pageId,
      afterJson: {
        chunkCount,
        thermalUpserted: thermal.upserted,
        thermalSkipped: thermal.skipped,
        thermalWarnings: thermal.warnings,
        thermalSetId: input?.thermalSetId ?? null,
        versionIndexDirty: true
      }
    });

    return { chunkCount, thermal };
  });

  const recognition = await getPageRecognition(app, pageId);
  if (input?.thermalSetId) {
    recognition.thermalSetEditable = true;
  }

  return {
    message: "页面识别已确认",
    pageId,
    recognitionStatus: "CONFIRMED" as const,
    chunkCount: result.chunkCount,
    thermal: result.thermal,
    recognition
  };
}

/**
 * 批量确认安全评估：仅「无风险页」允许批量自动确认。
 * 风险包括：缺少全文、结构未通过 schema、构造/产品映射歧义、热工字段不完整（无法写入正式热工行）。
 * 热工页更严格：存在构造编号缺失或 R/K 不完整时禁止批量，继续人工逐页确认。
 */
export function assessBatchConfirmSafety(structured: PageRecognitionResult): { safe: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!structured.fullText?.trim()) reasons.push("缺少页面全文（fullText/parsedText）");
  for (const system of structured.systems ?? []) {
    const options = system.options ?? [];
    const code = system.constructionCode?.trim() || system.systemName || "未命名构造";
    const hasThermal = options.some((opt) => opt.thicknessMm != null
      || opt.productThermalResistance != null
      || opt.totalThermalResistance != null
      || opt.kValue != null
      || opt.rValue != null);
    if (hasThermal && !system.constructionCode?.trim()) {
      reasons.push(`系统「${system.systemName ?? "未命名"}」缺少 constructionCode，存在构造映射歧义`);
    }
    const thicknesses = options.map((opt) => opt.thicknessMm).filter((value): value is number => value != null && Number.isFinite(value));
    if (new Set(thicknesses).size !== thicknesses.length) reasons.push(`构造 ${code} 存在重复厚度选项`);
    if (thicknesses.length >= 4) {
      const sorted = [...thicknesses].sort((a, b) => a - b);
      const maximum = sorted.at(-1)!;
      const previous = sorted.at(-2)!;
      const median = sorted[Math.floor(sorted.length / 2)]!;
      if (maximum > previous * 2 && maximum > median * 2.5) {
        reasons.push(`构造 ${code} 的 ${maximum}mm 厚度与同组其他选项差异明显，请对照原图核对`);
      }
    }
    for (const opt of options) {
      const resolved = resolveOptionThermalResistances(opt);
      if ([opt.thicknessMm, opt.productThermalResistance, opt.totalThermalResistance, opt.kValue]
        .some((value) => value != null && (!Number.isFinite(value) || value <= 0))) {
        reasons.push(`构造 ${code} 存在非正数或无效热工数值`);
      }
      if (resolved.skipFormalWrite) {
        reasons.push(...resolved.warnings);
      }
    }
  }
  return { safe: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export async function assessBatchConfirmMapping(
  db: DbExecutor,
  page: typeof knowledgePages.$inferSelect,
  structured: PageRecognitionResult,
  thermalSetId: string | null
): Promise<string[]> {
  if (!structured.systems.some((system) => (system.options?.length ?? 0) > 0)) return [];
  if (!thermalSetId) return ["存在热工选项，但尚未选择可编辑的热工参考集"];
  const [set] = await db.select().from(thermalReferenceSets).where(eq(thermalReferenceSets.id, thermalSetId)).limit(1);
  if (!set || !isThermalReferenceSetEditable(set.status) || set.atlasDocumentId !== page.documentId) {
    return ["所选热工参考集不存在、不可编辑或不属于当前资料"];
  }
  const reasons: string[] = [];
  for (const system of structured.systems) {
    if (!(system.options?.length)) continue;
    try {
      const scheme = await resolveSchemeMapping(db, system);
      if (!scheme) {
        reasons.push(`构造 ${system.constructionCode ?? "未填写编号"} 未匹配到已发布方案`);
        continue;
      }
      for (const opt of system.options) {
        if (opt.thicknessMm == null) continue;
        const spec = await resolveProductSpecMapping(db, scheme.id, system, opt, opt.thicknessMm);
        if (!spec) reasons.push(`构造 ${system.constructionCode ?? "未填写编号"} 的 ${opt.thicknessMm}mm 未匹配已发布产品规格`);
      }
    } catch (error) {
      reasons.push(error instanceof AppError ? error.message : "正式构造或产品规格映射校验失败");
    }
  }
  return [...new Set(reasons)];
}

export interface BatchConfirmInput {
  pageIds?: string[];
  /**
   * true（默认）：只确认「无风险页」，风险页进入 skipped 并给出原因；
   * false：尝试确认全部 REVIEW_REQUIRED 页面，确认失败页进入 failed 并给出原因。
   *
   * 两种模式都是 **per-page result**，不再存在 all-or-nothing 语义
   * （此前协议宣称 all-or-nothing，实现却是每页独立事务，属于协议与实现不一致）。
   */
  confirmSafeOnly?: boolean;
  thermalSetId?: string | null;
}

/** 批量确认逐页结果项（B 端可直接展示失败/跳过原因） */
export interface BatchConfirmPageResult {
  pageId: string;
  physicalPageNumber: number;
  code: string;
  reason: string;
}

export interface BatchConfirmResult {
  requested: number;
  confirmed: number;
  chunkCount: number;
  versionIndexDirty: boolean;
  /** 已成功确认的页面 */
  success: Array<{ pageId: string; physicalPageNumber: number; chunkCount: number; thermalUpserted: number; thermalSkipped: number }>;
  /** 尝试确认但失败的页面（confirmSafeOnly=false 时才会尝试风险页） */
  failed: BatchConfirmPageResult[];
  /** 未尝试确认的页面（状态不符 / 安全条件不满足） */
  skipped: BatchConfirmPageResult[];
}

/**
 * 批量确认页面识别（降低 92 页逐页点击成本）。
 * 安全条件：REVIEW_REQUIRED + fullText 非空 + 结构通过 schema + 无映射歧义 + 热工字段完整。
 *
 * 语义：逐页独立确认，单页失败不影响其他页；返回 success / failed / skipped 三组逐页结果。
 * 不静默确认任何风险页（confirmSafeOnly=true 时风险页只跳过并给出原因）。
 */
export async function batchConfirmPageRecognition(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  input: BatchConfirmInput
): Promise<BatchConfirmResult> {
  const version = await requireVersionForPage(app.db, versionId);
  assertKnowledgeVersionEditable(version);
  const confirmSafeOnly = input.confirmSafeOnly ?? true;
  const pages = input.pageIds && input.pageIds.length > 0
    ? await app.db.select().from(knowledgePages).where(and(
      eq(knowledgePages.versionId, versionId),
      inArray(knowledgePages.id, input.pageIds)
    ))
    : await app.db.select().from(knowledgePages).where(and(
      eq(knowledgePages.versionId, versionId),
      sql`${knowledgePages.metadata}->>'recognitionStatus' = 'REVIEW_REQUIRED'`
    ));
  if (pages.length === 0) {
    throw new AppError("PAGE_BATCH_CONFIRM_EMPTY", "没有可批量确认的页面", 400);
  }

  const success: BatchConfirmResult["success"] = [];
  const failed: BatchConfirmPageResult[] = [];
  const skipped: BatchConfirmPageResult[] = [];
  let chunkCount = 0;

  for (const page of pages) {
    const meta = readPageRecognitionMeta(page.metadata);
    if (meta.recognitionStatus !== "REVIEW_REQUIRED") {
      skipped.push({
        pageId: page.id,
        physicalPageNumber: page.physicalPageNumber,
        code: "PAGE_NOT_REVIEW_REQUIRED",
        reason: `识别状态为 ${meta.recognitionStatus ?? "PENDING"}，仅 REVIEW_REQUIRED 可确认`
      });
      continue;
    }
    let structured: PageRecognitionResult;
    try {
      structured = pageRecognitionResultSchema.parse(meta.draftStructuredData);
    } catch {
      const reason = "结构化候选未通过 schema 校验";
      if (confirmSafeOnly) {
        skipped.push({ pageId: page.id, physicalPageNumber: page.physicalPageNumber, code: "PAGE_DRAFT_SCHEMA_INVALID", reason });
      } else {
        failed.push({ pageId: page.id, physicalPageNumber: page.physicalPageNumber, code: "PAGE_DRAFT_SCHEMA_INVALID", reason });
      }
      continue;
    }
    const safety = assessBatchConfirmSafety(structured);
    const mappingReasons = confirmSafeOnly && safety.safe
      ? await assessBatchConfirmMapping(app.db, page, structured, input.thermalSetId ?? null)
      : [];
    if (confirmSafeOnly && (!safety.safe || mappingReasons.length > 0)) {
      skipped.push({
        pageId: page.id,
        physicalPageNumber: page.physicalPageNumber,
        code: "PAGE_UNSAFE",
        reason: [...safety.reasons, ...mappingReasons].join("；")
      });
      continue;
    }

    // 逐页独立事务（confirmPageRecognition 内部）；单页失败不影响其他页，也不回滚已成功页。
    try {
      const needsThermalSet = structured.systems.some((system) => (system.options?.length ?? 0) > 0);
      const confirmed = await confirmPageRecognition(app, request, actor, page.id, { thermalSetId: needsThermalSet ? input.thermalSetId ?? null : null });
      chunkCount += confirmed.chunkCount;
      success.push({
        pageId: page.id,
        physicalPageNumber: page.physicalPageNumber,
        chunkCount: confirmed.chunkCount,
        thermalUpserted: confirmed.thermal.upserted,
        thermalSkipped: confirmed.thermal.skipped
      });
    } catch (error) {
      const code = error instanceof AppError ? error.code : "PAGE_CONFIRM_FAILED";
      const reason = error instanceof Error ? error.message : String(error);
      app.log.warn({ pageId: page.id, versionId, code, reason }, "批量确认单页失败，已记录并继续");
      failed.push({ pageId: page.id, physicalPageNumber: page.physicalPageNumber, code, reason });
    }
  }

  return {
    requested: pages.length,
    confirmed: success.length,
    chunkCount,
    versionIndexDirty: success.length > 0,
    success,
    failed,
    skipped
  };
}

export { isKnowledgeVersionEditable, isThermalReferenceSetEditable };
