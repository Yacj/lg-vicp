import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq } from "drizzle-orm";
import { professionalReviews, reports, standardDocuments } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { ReviewError } from "../../shared/review-errors.js";
import { getPagination } from "../../shared/pagination.js";
import { approveEntity, rejectEntity, MD_ENTITIES } from "../masterdata/md-workflow.service.js";
import {
  approveTemplateReport,
  rejectTemplateReport
} from "../reports/report-review.service.js";
import {
  approveDocument,
  rejectDocument,
  type StandardDeps
} from "../standard/standard.service.js";

/**
 * 统一审核中心服务：
 * - professional_reviews 为单一数据源（各域 transition 在状态变更同一事务内 upsert，见
 *   md-workflow.service.ts / standard.service.ts / report-review.service.ts）；
 * - 本服务只做队列读取与审核决议委托（approve/reject 调用各域既有审核服务，
 *   状态守卫、事务、审计、统一审核记录全部由被委托方完成，无审核分叉）；
 * - 实体类型白名单：主数据/构造/热工/比较/节点/报告模板（md-workflow 注册实体）
 *   + 地方标准文档（standard 自带流转）+ 模板报告（报告模块审核）。
 */

export interface EntityReviewer {
  /** 实体中文名（队列展示） */
  label: string;
  /** 实体数据预览（详情页） */
  detail: (app: FastifyInstance, entityId: string) => Promise<unknown>;
  approve: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string, note?: string) => Promise<unknown>;
  reject: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string, reason: string) => Promise<unknown>;
}

/** md-workflow 注册实体 -> 审核中心委托（approve/reject 复用版本化状态机） */
function mdReviewer(entity: string, label: string): EntityReviewer {
  return {
    label,
    detail: async (app, entityId) => {
      const meta = MD_ENTITIES[entity];
      if (!meta) return null;
      const [row] = await app.db.select().from(meta.table).where(eq(meta.idColumn as never, entityId)).limit(1);
      return row ?? null;
    },
    approve: (app, request, actor, id, note) => approveEntity(app, request, actor, entity, id, note),
    reject: (app, request, actor, id, reason) => rejectEntity(app, request, actor, entity, id, reason)
  };
}

/** md-workflow 已注册实体（kind 复用审计 targetType，与 professional_reviews.entityType 一致） */
const MD_REVIEW_ENTITIES: ReadonlyArray<readonly [kind: string, entity: string, label: string]> = [
  ["md_enterprise_profile", "enterpriseProfile", "企业内容"],
  ["md_product_series", "productSeries", "产品系列"],
  ["md_product_spec", "productSpec", "产品规格"],
  ["md_product_parameter", "productParameter", "产品性能参数"],
  ["md_material", "material", "材料"],
  ["md_material_parameter_version", "materialParameterVersion", "材料参数版本"],
  ["construction_insulation_system", "insulationSystem", "保温系统"],
  ["construction_scheme", "constructionScheme", "构造方案"],
  ["thermal_reference_set", "thermalReferenceSet", "图集热工参考集"],
  ["thermal_calc_rule", "thermalCalcRule", "热工计算规则"],
  ["thermal_standard_limit", "thermalStandardLimit", "地区标准限值"],
  ["comparison_version", "comparisonVersion", "材料对比版本"],
  ["node_drawing", "nodeDrawing", "节点图"],
  ["report_template", "reportTemplate", "报告模板"]
];

/** 标准模块依赖（审核中心调用标准文档审核时注入） */
function standardDeps(app: FastifyInstance): StandardDeps {
  return { db: app.db, storage: app.storage };
}

const STANDARD_DOCUMENT_REVIEWER: EntityReviewer = {
  label: "地方标准文档",
  detail: async (app, entityId) => {
    const [row] = await app.db.select().from(standardDocuments).where(eq(standardDocuments.id, entityId)).limit(1);
    return row ?? null;
  },
  approve: (app, request, actor, id, note) => approveDocument(standardDeps(app), request, actor, id, note),
  reject: (app, request, actor, id, reason) => rejectDocument(standardDeps(app), request, actor, id, reason)
};

/** 模板报告审核：状态守卫/事务/审计在报告模块内完成（projects 级权限由路由层校验） */
const REPORT_REVIEWER: EntityReviewer = {
  label: "模板报告",
  detail: async (app, entityId) => {
    const [row] = await app.db.select().from(reports).where(eq(reports.id, entityId)).limit(1);
    return row ?? null;
  },
  approve: (app, request, actor, id, note) => approveTemplateReport(app, request, actor, id, note),
  reject: (app, request, actor, id, reason) => rejectTemplateReport(app, request, actor, id, reason)
};

export const ENTITY_REVIEWERS: Record<string, EntityReviewer> = Object.fromEntries(
  MD_REVIEW_ENTITIES.map(([kind, entity, label]) => [kind, mdReviewer(entity, label)])
);
ENTITY_REVIEWERS["standard_document"] = STANDARD_DOCUMENT_REVIEWER;
ENTITY_REVIEWERS["report"] = REPORT_REVIEWER;

// ---------------------------------------------------------------- 队列读取

export interface ReviewQueueQuery {
  page: number;
  pageSize: number;
  entityType?: string;
  status?: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
}

export async function listReviewQueue(app: FastifyInstance, query: ReviewQueueQuery) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.entityType ? eq(professionalReviews.entityType, query.entityType) : undefined,
    query.status ? eq(professionalReviews.status, query.status) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(professionalReviews).where(where)
      .orderBy(desc(professionalReviews.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(professionalReviews).where(where)
  ]);
  return {
    items: items.map((item) => ({
      ...item,
      label: ENTITY_REVIEWERS[item.entityType]?.label ?? item.entityType
    })),
    total: totalRow?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function getReviewDetail(app: FastifyInstance, entityType: string, entityId: string) {
  const [record] = await app.db.select().from(professionalReviews)
    .where(and(
      eq(professionalReviews.entityType, entityType),
      eq(professionalReviews.entityId, entityId)
    )).limit(1);
  if (!record) throw new ReviewError("REVIEW_RECORD_NOT_FOUND");
  const reviewer = ENTITY_REVIEWERS[entityType];
  if (!reviewer) throw new ReviewError("REVIEW_ENTITY_UNSUPPORTED");
  return {
    record: {
      ...record,
      label: reviewer.label
    },
    entity: await reviewer.detail(app, entityId)
  };
}

// ---------------------------------------------------------------- 审核决议（委托各域审核服务）

async function requirePendingRecord(app: FastifyInstance, entityType: string, entityId: string) {
  const [record] = await app.db.select().from(professionalReviews)
    .where(and(
      eq(professionalReviews.entityType, entityType),
      eq(professionalReviews.entityId, entityId)
    )).limit(1);
  if (!record) throw new ReviewError("REVIEW_RECORD_NOT_FOUND");
  if (record.status !== "PENDING_REVIEW") throw new ReviewError("REVIEW_ENTITY_NOT_PENDING");
  return record;
}

export async function approveReview(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  entityType: string, entityId: string, approvalNote?: string
) {
  const reviewer = ENTITY_REVIEWERS[entityType];
  if (!reviewer) throw new ReviewError("REVIEW_ENTITY_UNSUPPORTED");
  await requirePendingRecord(app, entityType, entityId);
  return reviewer.approve(app, request, actor, entityId, approvalNote);
}

export async function rejectReview(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  entityType: string, entityId: string, rejectReason: string
) {
  const reviewer = ENTITY_REVIEWERS[entityType];
  if (!reviewer) throw new ReviewError("REVIEW_ENTITY_UNSUPPORTED");
  await requirePendingRecord(app, entityType, entityId);
  return reviewer.reject(app, request, actor, entityId, rejectReason);
}