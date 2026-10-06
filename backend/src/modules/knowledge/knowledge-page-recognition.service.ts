/**
 * 页面视觉识别：触发/重试/草稿/确认。
 * AI 结果仅为候选（REVIEW_REQUIRED）；Confirm 在单事务内写 page-aware chunks 与 thermal_reference_rows。
 */
import { generateObject } from "ai";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import type { AuthUser } from "../../shared/auth-user.js";
import { AppError, NotFoundError } from "../../shared/errors.js";
import type { DbExecutor } from "../../db/client.js";
import {
  PAGE_RECOGNITION_SYSTEM_PROMPT,
  assertKnowledgeVersionEditable,
  assertThermalReferenceSetEditable,
  isKnowledgeVersionEditable,
  isThermalReferenceSetEditable,
  mergePageMetadata,
  pageRecognitionResultSchema,
  readPageRecognitionMeta,
  resolveOptionThermalResistances,
  type PageRecognitionMetadata,
  type PageRecognitionResult
} from "../../shared/page-recognition.js";
import {
  constructionSchemes,
  knowledgeChunks,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgePages,
  productSpecs,
  thermalReferenceRows,
  thermalReferenceSets
} from "../../db/schema.js";
import { resolveDefaultVisionModel } from "../ai-config/ai-config.service.js";
import { languageModelSamplingOptions, getAiTaskRuntimePolicy } from "../ai-config/ai-task-runtime-policy.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { buildChunksFromPages, type AliasDictEntry } from "./knowledge-chunking.js";
import { normalizeSearchText } from "./knowledge.normalize.js";

const VISION_URL_TTL = 600;

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
      `page-${page.physicalPageNumber}.png`,
      3600
    );
  }
  let thermalSetEditable: boolean | null = null;
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
    confirmedAt: meta.confirmedAt ?? null,
    confirmedById: meta.confirmedById ?? null,
    lastRecognitionAt: meta.lastRecognitionAt ?? null,
    lastRecognitionError: meta.lastRecognitionError ?? null,
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
  const page = await requirePage(app.db, pageId);
  const version = await requireVersionForPage(app.db, page.versionId);
  assertKnowledgeVersionEditable(version);
  if (!page.pageImageObjectKey) {
    throw new AppError("PAGE_IMAGE_REQUIRED", "页面尚未绑定图片，无法识别", 400);
  }
  const meta = readPageRecognitionMeta(page.metadata);
  const patch: PageRecognitionMetadata = {
    recognitionStatus: "PENDING",
    lastRecognitionError: null
  };
  // 重新识别：不立即覆盖已确认数据；新结果进 structuredData / draftStructuredData 候选
  if (options?.reRecognize && meta.recognitionStatus === "CONFIRMED") {
    patch.confirmedStructuredData = meta.confirmedStructuredData ?? meta.structuredData;
    patch.confirmedAt = meta.confirmedAt;
    patch.confirmedById = meta.confirmedById;
  }
  await app.db.update(knowledgePages).set({
    metadata: mergePageMetadata(page.metadata, { ...meta, ...patch })
  }).where(eq(knowledgePages.id, pageId));

  await app.queues.pageRecognition.add(
    options?.reRecognize ? "re-recognize-page" : "recognize-page",
    { pageId, versionId: page.versionId, triggeredBy: actor.id, reRecognize: Boolean(options?.reRecognize) },
    { jobId: `page-recog-${pageId}-${Date.now()}`, removeOnComplete: true }
  );
  await writeAuditLog({
    db: app.db, request, actor,
    action: options?.reRecognize ? "knowledge.page_re_recognize_queued" : "knowledge.page_recognize_queued",
    targetType: "knowledge_page",
    targetId: pageId,
    afterJson: { versionId: page.versionId }
  });
  return { message: options?.reRecognize ? "已排队重新识别" : "已排队识别", pageId, status: "PENDING" };
}

/** Worker 调用：执行视觉结构化识别并落候选（不写正式热工行） */
export async function runPageRecognitionJob(
  app: Pick<FastifyInstance, "db" | "storage" | "log">,
  pageId: string
): Promise<{ status: string; pageId: string }> {
  const page = await requirePage(app.db, pageId);
  if (!page.pageImageObjectKey) {
    throw new AppError("PAGE_IMAGE_REQUIRED", "页面尚未绑定图片", 400);
  }
  const meta = readPageRecognitionMeta(page.metadata);
  await app.db.update(knowledgePages).set({
    metadata: mergePageMetadata(page.metadata, {
      ...meta,
      recognitionStatus: "PROCESSING",
      lastRecognitionError: null
    })
  }).where(eq(knowledgePages.id, pageId));

  try {
    const [doc] = await app.db.select({ title: knowledgeDocuments.title })
      .from(knowledgeDocuments).where(eq(knowledgeDocuments.id, page.documentId)).limit(1);
    const vision = await resolveDefaultVisionModel(app.db);
    const imageUrl = await app.storage.createDownloadUrl(
      page.pageImageObjectKey,
      `page-${page.physicalPageNumber}.png`,
      VISION_URL_TTL
    );

    const result = await generateObject({
      model: vision.languageModel,
      schema: pageRecognitionResultSchema,
      messages: [
        { role: "system", content: PAGE_RECOGNITION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `文档标题：${doc?.title ?? "未知"}`,
                `当前 pageLabel：${page.pageLabel ?? ""}`,
                `当前 physicalPageNumber：${page.physicalPageNumber}`,
                "请识别本页完整图片，输出 PageRecognitionResult JSON。",
                "options 必须分别填写 productThermalResistance 与 totalThermalResistance，不要输出 rValue。"
              ].join("\n")
            },
            { type: "image", image: new URL(imageUrl) }
          ]
        }
      ],
      ...languageModelSamplingOptions("VISION"),
      abortSignal: AbortSignal.timeout(getAiTaskRuntimePolicy("VISION").timeoutMs)
    });

    const parsed = pageRecognitionResultSchema.parse(result.object);
    const warnings = [
      ...(parsed.warnings ?? []),
      ...(meta.imageWarnings ?? [])
    ];

    const nextMeta = mergePageMetadata(page.metadata, {
      ...meta,
      recognitionStatus: "REVIEW_REQUIRED",
      recognitionModel: vision.modelRef.id,
      recognitionConfidence: null,
      recognitionWarnings: warnings,
      structuredData: parsed,
      draftStructuredData: parsed,
      // 保留已确认快照，避免重识别静默覆盖正式数据
      confirmedStructuredData: meta.confirmedStructuredData,
      confirmedAt: meta.confirmedAt,
      confirmedById: meta.confirmedById,
      lastRecognitionAt: new Date().toISOString(),
      lastRecognitionError: null
    });

    await app.db.update(knowledgePages).set({
      parsedText: parsed.fullText || page.parsedText,
      pageTitle: parsed.pageTitle?.trim() || page.pageTitle,
      pageLabel: parsed.pageLabel?.trim() || page.pageLabel,
      metadata: nextMeta
    }).where(eq(knowledgePages.id, pageId));

    return { status: "REVIEW_REQUIRED", pageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await app.db.update(knowledgePages).set({
      metadata: mergePageMetadata(page.metadata, {
        ...readPageRecognitionMeta(page.metadata),
        recognitionStatus: "FAILED",
        lastRecognitionError: message,
        lastRecognitionAt: new Date().toISOString()
      })
    }).where(eq(knowledgePages.id, pageId));
    throw error;
  }
}

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
  const page = await requirePage(app.db, pageId);
  const version = await requireVersionForPage(app.db, page.versionId);
  assertKnowledgeVersionEditable(version);
  const meta = readPageRecognitionMeta(page.metadata);
  if (meta.recognitionStatus === "PROCESSING") {
    throw new AppError("PAGE_RECOGNITION_BUSY", "页面正在识别中，请稍后再编辑", 400);
  }
  const structuredData = input.structuredData
    ? pageRecognitionResultSchema.parse(input.structuredData)
    : meta.structuredData;
  const nextMeta = mergePageMetadata(page.metadata, {
    ...meta,
    structuredData: structuredData ?? null,
    draftStructuredData: structuredData ?? null,
    recognitionStatus: meta.recognitionStatus === "CONFIRMED"
      ? "REVIEW_REQUIRED"
      : (meta.recognitionStatus ?? "REVIEW_REQUIRED")
  });
  const [updated] = await app.db.update(knowledgePages).set({
    pageLabel: input.pageLabel !== undefined ? input.pageLabel : page.pageLabel,
    pageTitle: input.pageTitle !== undefined ? input.pageTitle : page.pageTitle,
    parsedText: input.parsedText !== undefined ? input.parsedText : page.parsedText,
    metadata: nextMeta
  }).where(eq(knowledgePages.id, pageId)).returning();

  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.page_recognition_draft_saved",
    targetType: "knowledge_page",
    targetId: pageId,
    afterJson: { recognitionStatus: nextMeta.recognitionStatus }
  });
  return { page: updated!, recognition: await getPageRecognition(app, pageId) };
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
): Promise<{ upserted: number; warnings: string[]; skipped: number }> {
  const warnings: string[] = [];
  const [set] = await db.select().from(thermalReferenceSets)
    .where(eq(thermalReferenceSets.id, thermalSetId)).limit(1);
  if (!set) throw new AppError("THERMAL_SET_NOT_FOUND", "热工参考集不存在", 400);
  assertThermalReferenceSetEditable(set);

  // 只清当前页绑定行，不碰整个 set
  await db.delete(thermalReferenceRows).where(eq(thermalReferenceRows.sourcePageId, page.id));

  let upserted = 0;
  let skipped = 0;
  for (const system of structured.systems ?? []) {
    const code = system.constructionCode?.trim();
    if (!code) {
      warnings.push(`系统「${system.systemName ?? "未命名"}」缺少 constructionCode，跳过热工同步`);
      skipped += 1;
      continue;
    }
    const [scheme] = await db.select().from(constructionSchemes)
      .where(and(
        eq(constructionSchemes.schemeCode, code),
        eq(constructionSchemes.status, "PUBLISHED")
      )).limit(1);
    if (!scheme) {
      warnings.push(`未找到已发布构造方案 schemeCode=${code}`);
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

      const specConditions = [
        eq(productSpecs.status, "PUBLISHED"),
        eq(productSpecs.thicknessMm, thicknessMm)
      ];
      if (system.specClass) {
        specConditions.push(eq(productSpecs.specClass, system.specClass));
      }
      const [spec] = await db.select().from(productSpecs).where(and(...specConditions)).limit(1);
      if (!spec) {
        warnings.push(`构造 ${code} 厚度 ${thicknessMm}mm 未匹配已发布产品规格`);
        skipped += 1;
        continue;
      }

      const evidenceRef = `page:${page.pageLabel ?? page.physicalPageNumber}`;
      await db.insert(thermalReferenceRows).values({
        setId: thermalSetId,
        schemeId: scheme.id,
        productSpecId: spec.id,
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
  return { upserted, warnings, skipped };
}

export async function confirmPageRecognition(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  pageId: string,
  input?: { thermalSetId?: string | null; structuredData?: PageRecognitionResult }
) {
  const page = await requirePage(app.db, pageId);
  const version = await requireVersionForPage(app.db, page.versionId);
  assertKnowledgeVersionEditable(version);

  const meta = readPageRecognitionMeta(page.metadata);
  const structured = pageRecognitionResultSchema.parse(
    input?.structuredData ?? meta.structuredData ?? meta.draftStructuredData ?? meta.confirmedStructuredData
  );
  if (!structured.fullText?.trim() && !page.parsedText?.trim()) {
    throw new AppError("PAGE_RECOGNITION_INCOMPLETE", "确认前需要页面全文（fullText/parsedText）", 400);
  }

  // 预检：有 thermalSetId 时先校验可编辑，避免事务中途失败
  if (input?.thermalSetId) {
    const [set] = await app.db.select().from(thermalReferenceSets)
      .where(eq(thermalReferenceSets.id, input.thermalSetId)).limit(1);
    if (!set) throw new AppError("THERMAL_SET_NOT_FOUND", "热工参考集不存在", 400);
    assertThermalReferenceSetEditable(set);
  }

  const fullText = structured.fullText?.trim() || page.parsedText || "";
  const pageForChunks = {
    ...page,
    pageLabel: structured.pageLabel?.trim() || page.pageLabel,
    pageTitle: structured.pageTitle?.trim() || page.pageTitle,
    parsedText: fullText
  };

  const result = await app.db.transaction(async (tx) => {
    const chunkCount = await rebuildPageAwareChunks(tx, pageForChunks, fullText);

    let thermal = { upserted: 0, warnings: [] as string[], skipped: 0 };
    if (input?.thermalSetId) {
      thermal = await syncThermalRowsFromConfirmedPage(tx, actor, page, structured, input.thermalSetId);
    } else if ((structured.systems?.length ?? 0) > 0) {
      thermal.warnings.push("未提供 thermalSetId：已确认页面与 chunks，未同步 thermal_reference_rows");
    }

    const nextMeta = mergePageMetadata(page.metadata, {
      ...meta,
      recognitionStatus: "CONFIRMED",
      structuredData: structured,
      draftStructuredData: structured,
      confirmedStructuredData: structured,
      confirmedAt: new Date().toISOString(),
      confirmedById: actor.id,
      recognitionWarnings: [
        ...(structured.warnings ?? []),
        ...thermal.warnings
      ]
    });

    await tx.update(knowledgePages).set({
      parsedText: fullText,
      pageLabel: structured.pageLabel?.trim() || page.pageLabel,
      pageTitle: structured.pageTitle?.trim() || page.pageTitle,
      pageLabelVerified: true,
      metadata: nextMeta
    }).where(eq(knowledgePages.id, pageId));

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
        thermalSetId: input?.thermalSetId ?? null
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

export { isKnowledgeVersionEditable, isThermalReferenceSetEditable };
