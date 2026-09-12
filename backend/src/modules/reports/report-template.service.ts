import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import {
  reportTemplates,
  type ReportTemplateSection
} from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { ReportError } from "../../shared/report-errors.js";
import { getPagination } from "../../shared/pagination.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import {
  assertEditable,
  assertKeyAvailable,
  createNextVersion,
  MD_ENTITIES,
  registerVersionedEntity,
  type MdReviewStatus
} from "../masterdata/md-workflow.service.js";

/**
 * 报告模板服务：版本化审核实体（发布后供模板报告生成引用）。
 * 章节配置（sectionsJson）在 B 端维护，模板发布后不可直接修改，通过 new-version 派生新草稿。
 */

// 模块加载时注册版本化实体元数据（masterdata 状态机按名取元数据，注册后即可复用 submit/approve/...）
registerVersionedEntity("reportTemplate", {
  table: reportTemplates,
  idColumn: reportTemplates.id,
  statusColumn: reportTemplates.status,
  versionColumn: reportTemplates.version,
  keyColumns: [reportTemplates.code],
  kind: "report_template",
  label: "报告模板"
});

const TEMPLATE_META = () => ({ table: reportTemplates, kind: "report_template" as const, label: "报告模板" });

/** 模板可编辑状态：草稿/审核中/已驳回（与 masterdata 版本化实体一致） */
const EDITABLE: MdReviewStatus[] = ["DRAFT", "PENDING_REVIEW", "REJECTED"];

export const REPORT_SECTION_KEYS = [
  "enterprise",
  "project",
  "standards",
  "candidates",
  "selection",
  "thermal",
  "nodes",
  "construction",
  "comparison",
  "acceptance",
  "sources",
  "disclaimer"
] as const;

export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

export interface ReportTemplateCreateInput {
  code: string;
  name: string;
  description?: string | null;
  sections: ReportTemplateSection[];
  changeNote?: string | null;
  requiresProject?: boolean;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

// ---------------------------------------------------------------- 章节配置校验

export interface StructureViolation {
  field: string;
  message: string;
}

/** 章节配置校验（不抛错，返回违规明细）：key 唯一、order 从 1 连续、DATA 无文案、TEXT 必填文案、至少一个启用 */
export function collectTemplateSectionViolations(sections: ReportTemplateSection[]): StructureViolation[] {
  const violations: StructureViolation[] = [];
  if (sections.length === 0) {
    return [{ field: "sections", message: "至少配置一个报告章节" }];
  }

  const keys = sections.map((section) => section.key);
  const uniqueKeys = new Set(keys);
  if (uniqueKeys.size !== keys.length) {
    violations.push({ field: "sections", message: "章节 key 不允许重复" });
  }
  const invalidKey = keys.find((key) => !(REPORT_SECTION_KEYS as readonly string[]).includes(key));
  if (invalidKey) {
    violations.push({ field: "sections", message: `未知章节 key：${invalidKey}` });
  }

  const orders = sections.map((section) => section.order).sort((a, b) => a - b);
  for (let index = 0; index < orders.length; index += 1) {
    if (orders[index] !== index + 1) {
      violations.push({ field: "sections", message: "章节顺序必须从 1 开始连续递增" });
      break;
    }
  }

  for (const section of sections) {
    if (section.sourceType === "DATA" && section.content?.trim()) {
      violations.push({ field: `sections.${section.key}`, message: "数据章节不允许配置固定文案" });
    }
    if (section.sourceType === "TEXT" && !section.content?.trim()) {
      violations.push({ field: `sections.${section.key}`, message: "文本章节必须填写文案内容" });
    }
  }
  if (!sections.some((section) => section.enabled)) {
    violations.push({ field: "sections", message: "至少启用一个章节" });
  }
  return violations;
}

/** 章节配置校验（create/update/submit/publish 前置，违规抛 400） */
export function validateTemplateSections(sections: ReportTemplateSection[]) {
  const violations = collectTemplateSectionViolations(sections);
  if (violations.length > 0) {
    throw new ReportError("REPORT_TEMPLATE_STRUCTURE_INVALID", violations.map((v) => v.message).join("；"));
  }
}

/** 模板结构校验（submit/publish 前置，与工厂 validate 钩子签名一致） */
export async function validateReportTemplateStructure(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(reportTemplates).where(eq(reportTemplates.id, id)).limit(1);
  if (!row) throw new ReportError("REPORT_TEMPLATE_NOT_FOUND", "报告模板不存在");
  validateTemplateSections(row.sectionsJson as ReportTemplateSection[]);
}

// ---------------------------------------------------------------- CRUD

export async function listReportTemplates(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: MdReviewStatus; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(reportTemplates.status, query.status) : undefined,
    query.keyword
      ? or(
          ilike(reportTemplates.code, `%${query.keyword}%`),
          ilike(reportTemplates.name, `%${query.keyword}%`)
        )
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(reportTemplates).where(where)
      .orderBy(desc(reportTemplates.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(reportTemplates).where(where)
  ]);
  return {
    items: items.map((item) => toTemplateDto(item)),
    total: totalRow?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function getReportTemplate(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(reportTemplates).where(eq(reportTemplates.id, id)).limit(1);
  if (!row) throw new ReportError("REPORT_TEMPLATE_NOT_FOUND", "报告模板不存在");
  return toTemplateDto(row);
}

/** 行 -> DTO：sectionsJson 映射为 sections 数组 */
export function toTemplateDto(row: (typeof reportTemplates.$inferSelect)) {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    name: row.name,
    description: row.description,
    sections: (row.sectionsJson ?? []) as ReportTemplateSection[],
    changeNote: row.changeNote,
    requiresProject: row.requiresProject,
    evidenceSource: row.evidenceSource,
    evidenceRef: row.evidenceRef,
    evidenceLevel: row.evidenceLevel,
    effectiveAt: row.effectiveAt,
    expiresAt: row.expiresAt,
    status: row.status,
    submittedById: row.submittedById,
    submittedAt: row.submittedAt,
    approvedById: row.approvedById,
    approvedAt: row.approvedAt,
    approvalNote: row.approvalNote,
    rejectedById: row.rejectedById,
    rejectedAt: row.rejectedAt,
    rejectReason: row.rejectReason,
    publishedById: row.publishedById,
    publishedAt: row.publishedAt,
    createdById: row.createdById,
    updatedById: row.updatedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export async function createReportTemplate(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: ReportTemplateCreateInput
) {
  validateTemplateSections(input.sections);
  await assertKeyAvailable(app.db, MD_ENTITIES.reportTemplate!, { code: input.code });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(reportTemplates).values({
      code: input.code,
      version: 1,
      name: input.name,
      description: input.description,
      sectionsJson: input.sections,
      evidenceSource: input.evidenceSource,
      evidenceRef: input.evidenceRef,
      evidenceLevel: input.evidenceLevel,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
      changeNote: input.changeNote,
      requiresProject: input.requiresProject ?? false,
      status: "DRAFT",
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "report_template", targetId: created!.id,
      afterJson: { code: created!.code, name: created!.name, version: created!.version }
    });
    return toTemplateDto(created!);
  });
}

export async function updateReportTemplate(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<ReportTemplateCreateInput>
) {
  const [existing] = await app.db.select().from(reportTemplates).where(eq(reportTemplates.id, id)).limit(1);
  if (!existing) throw new ReportError("REPORT_TEMPLATE_NOT_FOUND", "报告模板不存在");
  assertEditable(existing as Record<string, unknown>, TEMPLATE_META().label, EDITABLE);
  const sections = input.sections ?? (existing.sectionsJson as ReportTemplateSection[]);
  validateTemplateSections(sections);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(reportTemplates).set({
      code: input.code ?? existing.code,
      name: input.name ?? existing.name,
      description: input.description === undefined ? existing.description : input.description,
      sectionsJson: sections,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      requiresProject: input.requiresProject === undefined ? existing.requiresProject : input.requiresProject,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(reportTemplates.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "report_template", targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return toTemplateDto(updated!);
  });
}

export async function deleteReportTemplate(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await app.db.select().from(reportTemplates).where(eq(reportTemplates.id, id)).limit(1);
  if (!existing) throw new ReportError("REPORT_TEMPLATE_NOT_FOUND", "报告模板不存在");
  assertEditable(existing as Record<string, unknown>, TEMPLATE_META().label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(reportTemplates).where(eq(reportTemplates.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "report_template", targetId: id,
      beforeJson: { code: existing.code, version: existing.version }
    });
  });
  return { message: "报告模板草稿已删除" };
}

/** 派生模板新版本：PUBLISHED/DISABLED 版本 -> DRAFT 新行（version+1） */
export function createTemplateNextVersion(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, changeNote?: string
) {
  return createNextVersion(app, request, actor, "reportTemplate", id, changeNote);
}

/** 默认模板章节配置（种子与示例使用）：章节齐全、按任务清单顺序，免责声明为 TEXT 待甲方确认文案 */
export const DEFAULT_REPORT_SECTIONS: ReportTemplateSection[] = [
  { key: "enterprise", title: "企业介绍", enabled: true, order: 1, sourceType: "DATA" },
  { key: "project", title: "项目条件", enabled: true, order: 2, sourceType: "DATA" },
  { key: "standards", title: "引用标准与地区限值", enabled: true, order: 3, sourceType: "DATA" },
  { key: "construction", title: "构造方案", enabled: true, order: 4, sourceType: "DATA" },
  { key: "candidates", title: "候选方案", enabled: true, order: 5, sourceType: "DATA" },
  { key: "selection", title: "用户选择与理由", enabled: true, order: 6, sourceType: "DATA" },
  { key: "thermal", title: "热工计算", enabled: true, order: 7, sourceType: "DATA" },
  { key: "nodes", title: "节点图库", enabled: true, order: 8, sourceType: "DATA" },
  { key: "comparison", title: "材料对比", enabled: false, order: 9, sourceType: "DATA" },
  { key: "acceptance", title: "施工验收", enabled: true, order: 10, sourceType: "DATA" },
  { key: "sources", title: "来源", enabled: true, order: 11, sourceType: "DATA" },
  { key: "disclaimer", title: "免责声明", enabled: true, order: 12, sourceType: "TEXT", content: "本报告由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。（免责声明正式措辞待甲方确认）" }
];