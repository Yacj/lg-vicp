import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  asyncTasks,
  knowledgeDocuments,
  productSpecs,
  projects,
  reportSnapshots,
  reportTemplates,
  reports,
  schemeDocuments,
  thermalCalcRecords,
  thermalCandidateSelections,
  thermalStandardLimits,
  type ReportTemplateSection
} from "../../db/schema.js";
import { QUEUE_NAMES } from "../../queues/queues.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { NotFoundError } from "../../shared/errors.js";
import { getPagination } from "../../shared/pagination.js";
import { ReportError } from "../../shared/report-errors.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { publishedReferenceConditions, effectiveRangeConditions } from "../construction/construction-structure.service.js";
import { listPublishedEnterpriseProfiles, listPublishedProductParameters } from "../masterdata/md-read.service.js";
import { listPublishedNodesWithLinks } from "../nodes/node.service.js";
import { assertReportProjectRequirement } from "./report-access.js";
import {
  applyReportSettingsToSections,
  DEFAULT_REPORT_SETTINGS,
  loadReportSettingsValues,
  type ReportSettingsValues
} from "./report-settings.service.js";
import { toTemplateDto } from "./report-template.service.js";
import { resolveReportType, templateBackedReportTypeCodes, type ReportTypeDefinition } from "./report-types.js";

/**
 * 模板报告数据快照组装与报告创建：
 * - 普通调用按 reportType 自动选用内部预置模板；templateId 仅兼容旧接口。
 * - 数值只来自已确认候选（thermal_candidate_selections）与计算记录（thermal_calc_records）的冻结快照，
 *   不向 AI 索要数值、不重新计算；
 * - 企业/标准限值/节点/施工验收引用等静态章节来自 PUBLISHED + 生效中读取，在生成时点冻结进 dataJson；
 * - 报告设置在生成时点冻结，历史报告不随后台设置漂移；Worker 只做确定性渲染。
 */

export interface TemplateReportInput {
  reportType?: string;
  projectId?: string | null;
  conversationId?: string | null;
  selectionId?: string;
  /** 兼容旧接口：显式指定内部模板。普通业务不传。 */
  templateId?: string;
  /** 数据生效时点（默认当前时间），用于已发布数据生效窗判定 */
  asOfDate?: Date;
  settings?: ReportSettingsValues;
}

async function resolvePublishedTemplate(
  app: FastifyInstance,
  input: { templateId?: string; templateCode?: string | null; asOfDate: Date }
) {
  if (input.templateId) {
    const [row] = await app.db.select().from(reportTemplates)
      .where(and(
        eq(reportTemplates.id, input.templateId),
        ...publishedReferenceConditions(reportTemplates, input.asOfDate)
      )).limit(1);
    return row ?? null;
  }
  if (input.templateCode) {
    const [row] = await app.db.select().from(reportTemplates)
      .where(and(
        eq(reportTemplates.code, input.templateCode),
        ...publishedReferenceConditions(reportTemplates, input.asOfDate)
      ))
      .orderBy(desc(reportTemplates.version)).limit(1);
    return row ?? null;
  }
  return null;
}

/** 快照组装（只读，不落库）：返回 dataJson 与模板版本信息 */
export async function assembleReportSnapshot(app: FastifyInstance, input: TemplateReportInput) {
  const asOfDate = input.asOfDate ?? new Date();
  const typeDef: ReportTypeDefinition | null = input.reportType ? resolveReportType(input.reportType) : null;
  const settings = input.settings ?? DEFAULT_REPORT_SETTINGS;
  const projectId = input.projectId ?? null;

  if (typeDef) {
    assertReportProjectRequirement({ requiresProject: typeDef.requiresProject, projectId });
  }

  const project = projectId
    ? (await app.db.select().from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt))).limit(1))[0] ?? null
    : null;
  if (projectId && !project) throw new NotFoundError("项目不存在");

  let selection = input.selectionId
    ? (await app.db.select().from(thermalCandidateSelections)
        .where(eq(thermalCandidateSelections.id, input.selectionId)).limit(1))[0] ?? null
    : null;
  if (input.selectionId && !selection) throw new ReportError("REPORT_SELECTION_NOT_FOUND");
  if (selection && projectId && selection.projectId !== projectId) {
    throw new ReportError("REPORT_SELECTION_PROJECT_MISMATCH");
  }
  if (!selection && typeDef?.needsSelection) {
    if (!projectId) throw new ReportError("REPORT_PROJECT_REQUIRED");
    const [latest] = await app.db.select().from(thermalCandidateSelections)
      .where(eq(thermalCandidateSelections.projectId, projectId))
      .orderBy(desc(thermalCandidateSelections.createdAt)).limit(1);
    if (!latest) throw new ReportError("REPORT_SELECTION_NOT_FOUND", "请先确认候选方案后再生成该报告类型");
    selection = latest;
  }

  const template = await resolvePublishedTemplate(app, {
    templateId: input.templateId,
    templateCode: typeDef?.templateCode,
    asOfDate
  });
  if (!template) throw new ReportError("REPORT_TEMPLATE_NOT_PUBLISHED");
  if ((typeDef?.requiresProject || template.requiresProject) && !projectId) {
    throw new ReportError("REPORT_PROJECT_REQUIRED");
  }

  const candidate = ((selection?.candidateJson ?? {}) as Record<string, any>);
  const scheme = (candidate.scheme ?? {}) as Record<string, any>;
  const system = (candidate.system ?? {}) as Record<string, any>;
  const productSpec = (candidate.productSpec ?? {}) as Record<string, any>;
  const query = ((selection?.queryJson ?? {}) as Record<string, any>);

  // 热工计算记录：与确认候选同一 requestId 且属于本项目的记录（查表模式可能无记录，允许为空）
  const calcRecords = selection?.requestId && projectId
    ? await app.db.select().from(thermalCalcRecords)
        .where(and(
          eq(thermalCalcRecords.requestId, selection.requestId),
          eq(thermalCalcRecords.projectId, projectId)
        ))
        .orderBy(asc(thermalCalcRecords.createdAt))
    : [];

  // 企业介绍章节：已发布企业内容（最新版本）+ 候选产品规格与已发布参数
  const profiles = await listPublishedEnterpriseProfiles(app.db);
  const enterprise = profiles[0] ?? null;
  const [publishedSpec] = productSpec?.id
    ? await app.db.select().from(productSpecs)
        .where(and(
          eq(productSpecs.id, String(productSpec.id)),
          ...publishedReferenceConditions(productSpecs, asOfDate)
        )).limit(1)
    : [];
  const productParameters = productSpec?.id
    ? await listPublishedProductParameters(app.db, { specId: String(productSpec.id) })
    : [];

  // 引用标准与地区限值章节：按查询条件中的地区（regionCode）取已发布且生效中的限值（最新版本）
  const regionCode = typeof query.regionCode === "string" ? query.regionCode : undefined;
  const [standardLimit] = regionCode
    ? await app.db.select().from(thermalStandardLimits)
        .where(and(
          eq(thermalStandardLimits.regionCode, regionCode),
          ...publishedReferenceConditions(thermalStandardLimits, asOfDate)
        ))
        .orderBy(desc(thermalStandardLimits.version)).limit(1)
    : [];

  // 节点图库章节：选中保温系统的已发布且生效中节点（含已发布方案关联）
  const nodes = system?.id
    ? await listPublishedNodesWithLinks(app.db, { systemId: String(system.id) })
    : [];

  // 施工验收章节：选中方案挂接的已发布知识文档引用（正文内容以来源引用呈现，无引用时章节标注待补充）
  const schemeId = scheme?.id ? String(scheme.id) : undefined;
  const acceptanceDocs = schemeId
    ? await app.db.select().from(schemeDocuments)
        .where(and(
          eq(schemeDocuments.targetType, "SCHEME"),
          eq(schemeDocuments.targetId, schemeId),
          ...effectiveRangeConditions(schemeDocuments, asOfDate)
        ))
        .orderBy(asc(schemeDocuments.updatedAt))
    : [];
  const knowledgeDocumentIds = [...new Set(
    acceptanceDocs.map((doc) => doc.knowledgeDocumentId).filter((id): id is string => Boolean(id))
  )];
  const knowledgeDocs = knowledgeDocumentIds.length > 0
    ? await app.db.select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title })
        .from(knowledgeDocuments).where(inArray(knowledgeDocuments.id, knowledgeDocumentIds))
    : [];
  const acceptance = acceptanceDocs.map((doc) => ({
    ...doc,
    documentTitle: doc.knowledgeDocumentId
      ? knowledgeDocs.find((item) => item.id === doc.knowledgeDocumentId)?.title ?? null
      : null
  }));

  // 来源章节：聚合候选证据/计算记录/标准限值/节点/施工验收引用的来源条目（不吞掉来源与页码）
  const sources: Array<Record<string, unknown>> = [];
  if (candidate.evidence && typeof candidate.evidence === "object") {
    sources.push({
      type: "candidate",
      source: (candidate.evidence as Record<string, unknown>).source ?? null,
      ref: (candidate.evidence as Record<string, unknown>).ref ?? null,
      note: "用户确认的候选方案证据（行/集/方案版本见候选章节）"
    });
  }
  for (const record of calcRecords) {
    const rule = (record.ruleJson ?? {}) as Record<string, unknown>;
    const standard = (record.standardJson ?? {}) as Record<string, unknown>;
    sources.push({
      type: "calc",
      calcId: record.id,
      mode: record.mode,
      rule: rule.evidenceSource ?? rule.name ?? null,
      ruleRef: rule.evidenceRef ?? null,
      standard: standard.evidenceSource ?? standard.basisName ?? null,
      standardRef: standard.clauseRef ?? null,
      createdAt: record.createdAt
    });
  }
  if (standardLimit) {
    sources.push({
      type: "standard",
      source: standardLimit.evidenceSource ?? standardLimit.basisName,
      ref: standardLimit.clauseRef,
      evidenceLevel: standardLimit.evidenceLevel,
      basisCode: standardLimit.basisCode,
      limitKValue: standardLimit.limitKValue,
      version: standardLimit.version
    });
  }
  for (const node of nodes) {
    sources.push({
      type: "node",
      nodeId: node.id,
      nodeCode: node.code,
      source: node.evidenceSource,
      ref: node.evidenceRef,
      evidenceLevel: node.evidenceLevel,
      atlasPage: node.atlasPage
    });
  }
  for (const doc of acceptanceDocs) {
    sources.push({
      type: "acceptance",
      source: doc.evidenceSource,
      ref: doc.evidenceRef,
      evidenceLevel: doc.evidenceLevel,
      atlasPage: doc.atlasPage,
      knowledgeDocumentId: doc.knowledgeDocumentId
    });
  }

  // 免责声明与章节：按生成时点的报告设置裁剪（冻结进快照，历史不漂移）
  const rawSections = (template.sectionsJson ?? []) as ReportTemplateSection[];
  const sections = applyReportSettingsToSections(rawSections, settings);
  const disclaimerSection = sections.find((section) => section.key === "disclaimer" && section.sourceType === "TEXT");
  const disclaimerText = disclaimerSection?.content?.trim() || null;
  const title = settings.coverTitle
    ?? (project ? `${template.name}（${project.name}）` : template.name);

  const dataJson = {
    title,
    generatedAt: new Date().toISOString(),
    asOfDate: asOfDate.toISOString(),
    reportType: typeDef?.code ?? input.reportType ?? "TEMPLATE",
    settings: {
      ...settings,
      companyLogoFileId: enterprise && typeof (enterprise as { logoFileId?: unknown }).logoFileId === "string"
        ? (enterprise as { logoFileId: string }).logoFileId
        : null
    },
    template: {
      id: template.id,
      code: template.code,
      version: template.version,
      name: template.name,
      sections
    },
    project: project
      ? {
        id: project.id,
        name: project.name,
        description: project.description,
        region: project.region,
        buildingType: project.buildingType,
        visibility: project.visibility,
        status: project.status,
        createdAt: project.createdAt
      }
      : null,
    enterprise,
    productSpec: publishedSpec ?? null,
    productParameters,
    standardLimit,
    selection: selection
      ? {
        id: selection.id,
        query: selection.queryJson,
        candidate: selection.candidateJson,
        selectionReason: selection.selectionReason,
        selectedById: selection.selectedById,
        createdAt: selection.createdAt
      }
      : null,
    calcRecords,
    nodes,
    acceptance,
    sources,
    disclaimerText
  };

  return { dataJson, template, asOfDate };
}

/** 生成模板报告：快照组装 -> reports + report_snapshots 同事务落库 -> 投递生成队列 */
export async function generateTemplateReport(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: TemplateReportInput
) {
  const settings = input.settings ?? await loadReportSettingsValues(app);
  const storedType = input.reportType ?? "TEMPLATE";
  const { dataJson, template, asOfDate } = await assembleReportSnapshot(app, { ...input, settings });

  const result = await app.db.transaction(async (tx) => {
    const [report] = await tx.insert(reports).values({
      projectId: input.projectId ?? null,
      conversationId: input.conversationId ?? null,
      reportType: storedType,
      contentJson: null,
      status: "DRAFT",
      templateVersion: String(template.version),
      createdById: actor.id
    }).returning();
    await tx.insert(reportSnapshots).values({
      reportId: report!.id,
      templateId: template.id,
      templateVersion: template.version,
      asOfDate,
      dataJson,
      generatedById: actor.id
    });
    const [task] = await tx.insert(asyncTasks).values({
      queueName: QUEUE_NAMES.REPORT_GENERATION,
      jobType: "generate_report",
      businessType: "report",
      businessId: report!.id,
      payload: { reportId: report!.id }
    }).returning();
    await writeAuditLog({
      db: tx, request, actor, projectId: input.projectId ?? undefined,
      action: AUDIT_ACTIONS.REPORT_SNAPSHOT_CREATED, targetType: "report", targetId: report!.id,
      afterJson: {
        reportId: report!.id,
        reportType: storedType,
        templateId: template.id,
        templateCode: template.code,
        templateVersion: template.version,
        selectionId: input.selectionId ?? null,
        asOfDate: asOfDate.toISOString(),
        taskId: task!.id
      }
    });
    return { report: report!, task: task! };
  });

  try {
    const job = await app.queues.reportGeneration.add(
      "generate_report",
      { taskId: result.task.id, reportId: result.report.id },
      { jobId: result.task.id }
    );
    await app.db.update(asyncTasks).set({ bullJobId: String(job.id), updatedAt: new Date() })
      .where(eq(asyncTasks.id, result.task.id));
  } catch (error) {
    await app.db.update(reports).set({ status: "FAILED", errorMessage: "报告任务投递失败", updatedAt: new Date() })
      .where(eq(reports.id, result.report.id));
    await app.db.update(asyncTasks).set({ status: "FAILED", errorMessage: "报告任务投递失败", updatedAt: new Date() })
      .where(eq(asyncTasks.id, result.task.id));
    throw error;
  }

  return { report: result.report, taskId: result.task.id, template: toTemplateDto(template) };
}

/** 读取报告快照（历史报告完整还原数据源） */
export async function getReportSnapshot(app: FastifyInstance, reportId: string) {
  const [snapshot] = await app.db.select().from(reportSnapshots)
    .where(eq(reportSnapshots.reportId, reportId)).limit(1);
  if (!snapshot) throw new ReportError("REPORT_SNAPSHOT_NOT_FOUND");
  return snapshot;
}

/** 模板报告列表（平台端）：按项目过滤，含历史 TEMPLATE 与预置模板类报告类型 */
export async function listTemplateReports(
  app: FastifyInstance,
  query: { page: number; pageSize: number; projectId: string; status?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const conditions = and(
    eq(reports.projectId, query.projectId),
    inArray(reports.reportType, templateBackedReportTypeCodes()),
    isNull(reports.deletedAt),
    query.status ? eq(reports.status, query.status as never) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(reports).where(conditions)
      .orderBy(desc(reports.createdAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(reports).where(conditions)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}