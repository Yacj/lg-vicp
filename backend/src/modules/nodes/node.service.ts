import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  constructionSchemes,
  insulationSystems,
  nodeDrawings,
  nodeSchemeLinks
} from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { NodeError } from "../../shared/node-errors.js";
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
import {
  effectiveRangeConditions,
  publishedReferenceConditions
} from "../construction/construction-structure.service.js";

/**
 * 节点图库服务：节点大样图（版本化审核实体）+ 节点-方案关联（子表，随版本复制）。
 * - 节点检索：按 保温系统 + 部位 精确返回（已发布读取见 node-read.service.ts）。
 * - 结构校验：部位必填、高清图/CAD 至少一个、引用的保温系统与关联构造方案必须已发布且生效。
 */

// 模块加载时注册版本化实体元数据（masterdata 状态机按名取元数据，注册后即可复用 submit/approve/...）
registerVersionedEntity("nodeDrawing", {
  table: nodeDrawings,
  idColumn: nodeDrawings.id,
  statusColumn: nodeDrawings.status,
  versionColumn: nodeDrawings.version,
  keyColumns: [nodeDrawings.code],
  kind: "node_drawing",
  label: "节点图"
});

const NODE_META = () => ({ table: nodeDrawings, kind: "node_drawing" as const, label: "节点图" });

/** 子表可编辑状态：节点处于草稿/审核中/已驳回时允许增删改 */
const CHILD_EDITABLE: MdReviewStatus[] = ["DRAFT", "PENDING_REVIEW", "REJECTED"];

// ---------------------------------------------------------------- 节点图（版本化）

export interface NodeDrawingCreateInput {
  code: string;
  name: string;
  position: string;
  systemId?: string | null;
  atlasPage?: string | null;
  imageFileId?: string | null;
  cadFileId?: string | null;
  description?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
  changeNote?: string | null;
}

export async function listNodeDrawings(
  app: FastifyInstance,
  query: {
    page: number; pageSize: number; status?: MdReviewStatus; keyword?: string;
    systemId?: string; position?: string;
  }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(nodeDrawings.status, query.status) : undefined,
    query.systemId ? eq(nodeDrawings.systemId, query.systemId) : undefined,
    query.position ? eq(nodeDrawings.position, query.position) : undefined,
    query.keyword
      ? or(
          ilike(nodeDrawings.code, `%${query.keyword}%`),
          ilike(nodeDrawings.name, `%${query.keyword}%`),
          ilike(nodeDrawings.position, `%${query.keyword}%`)
        )
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(nodeDrawings).where(where)
      .orderBy(desc(nodeDrawings.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(nodeDrawings).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getNodeDrawing(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(nodeDrawings).where(eq(nodeDrawings.id, id)).limit(1);
  if (!row) throw new NodeError("NODE_ENTITY_NOT_FOUND", "节点图不存在");
  return row;
}

/** 创建前校验：引用的保温系统若已填写必须已发布且生效 */
async function assertSystemReferencePublished(app: FastifyInstance, systemId?: string | null) {
  if (!systemId) return;
  const [system] = await app.db.select().from(insulationSystems)
    .where(and(eq(insulationSystems.id, systemId), ...publishedReferenceConditions(insulationSystems))).limit(1);
  if (!system) throw new NodeError("NODE_REFERENCE_NOT_PUBLISHED", "引用的保温系统未发布或已失效");
}

export async function createNodeDrawing(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: NodeDrawingCreateInput
) {
  await assertKeyAvailable(app.db, MD_ENTITIES.nodeDrawing!, { code: input.code });
  await assertSystemReferencePublished(app, input.systemId);
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(nodeDrawings).values({
      code: input.code,
      version: 1,
      name: input.name,
      position: input.position,
      systemId: input.systemId,
      atlasPage: input.atlasPage,
      imageFileId: input.imageFileId,
      cadFileId: input.cadFileId,
      description: input.description,
      evidenceSource: input.evidenceSource,
      evidenceRef: input.evidenceRef,
      evidenceLevel: input.evidenceLevel,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
      changeNote: input.changeNote,
      status: "DRAFT",
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "node_drawing", targetId: created!.id,
      afterJson: { code: created!.code, name: created!.name, position: created!.position, version: created!.version }
    });
    return created!;
  });
}

export async function updateNodeDrawing(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<NodeDrawingCreateInput>
) {
  const [existing] = await app.db.select().from(nodeDrawings).where(eq(nodeDrawings.id, id)).limit(1);
  if (!existing) throw new NodeError("NODE_ENTITY_NOT_FOUND", "节点图不存在");
  assertEditable(existing as Record<string, unknown>, NODE_META().label, CHILD_EDITABLE);
  const systemId = input.systemId === undefined ? existing.systemId : input.systemId;
  await assertSystemReferencePublished(app, systemId);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(nodeDrawings).set({
      code: input.code ?? existing.code,
      name: input.name ?? existing.name,
      position: input.position ?? existing.position,
      systemId,
      atlasPage: input.atlasPage === undefined ? existing.atlasPage : input.atlasPage,
      imageFileId: input.imageFileId === undefined ? existing.imageFileId : input.imageFileId,
      cadFileId: input.cadFileId === undefined ? existing.cadFileId : input.cadFileId,
      description: input.description === undefined ? existing.description : input.description,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(nodeDrawings.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "node_drawing", targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteNodeDrawing(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await app.db.select().from(nodeDrawings).where(eq(nodeDrawings.id, id)).limit(1);
  if (!existing) throw new NodeError("NODE_ENTITY_NOT_FOUND", "节点图不存在");
  assertEditable(existing as Record<string, unknown>, NODE_META().label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(nodeDrawings).where(eq(nodeDrawings.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "node_drawing", targetId: id,
      beforeJson: { code: existing.code, version: existing.version }
    });
  });
  return { message: "节点图草稿已删除" };
}

// ---------------------------------------------------------------- new-version 子表复制（同事务快照）

/** 复制节点-方案关联到新版本节点：id 由数据库重新生成，nodeDrawingId 指向新行 */
export async function copyNodeChildren(
  tx: DbExecutor,
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>
): Promise<void> {
  const oldId = oldRow.id as string;
  const newId = newRow.id as string;
  const links = await tx.select().from(nodeSchemeLinks).where(eq(nodeSchemeLinks.nodeDrawingId, oldId));
  if (links.length > 0) {
    await tx.insert(nodeSchemeLinks).values(links.map((link) => ({
      nodeDrawingId: newId,
      schemeId: link.schemeId,
      atlasPage: link.atlasPage,
      remark: link.remark,
      evidenceSource: link.evidenceSource,
      evidenceRef: link.evidenceRef,
      evidenceLevel: link.evidenceLevel,
      effectiveAt: link.effectiveAt,
      expiresAt: link.expiresAt,
      createdById: link.createdById,
      updatedById: link.updatedById
    })));
  }
}

/** 派生节点新版本：PUBLISHED/DISABLED 版本 -> DRAFT 新行（version+1），同事务复制子表 */
export function createNodeNextVersion(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, changeNote?: string
) {
  return createNextVersion(app, request, actor, "nodeDrawing", id, changeNote, copyNodeChildren);
}

// ---------------------------------------------------------------- 结构校验（submit/publish 前置）

export interface StructureViolation {
  field: string;
  message: string;
}

/** 节点结构校验（不抛错，返回违规明细）：部位必填、高清图/CAD 至少一个、引用已发布且生效 */
export async function collectNodeStructureViolations(app: FastifyInstance, id: string): Promise<StructureViolation[]> {
  const [node] = await app.db.select().from(nodeDrawings).where(eq(nodeDrawings.id, id)).limit(1);
  if (!node) throw new NodeError("NODE_ENTITY_NOT_FOUND", "节点图不存在");
  const violations: StructureViolation[] = [];

  if (!node.position?.trim()) {
    violations.push({ field: "position", message: "部位必填" });
  }
  if (!node.imageFileId && !node.cadFileId) {
    violations.push({ field: "imageFileId/cadFileId", message: "节点图必须至少提供一张高清图或 CAD 文件" });
  }
  if (node.systemId) {
    const [system] = await app.db.select({ id: insulationSystems.id }).from(insulationSystems)
      .where(and(eq(insulationSystems.id, node.systemId), ...publishedReferenceConditions(insulationSystems))).limit(1);
    if (!system) {
      violations.push({ field: "systemId", message: "引用的保温系统未发布或已失效" });
    }
  }

  const links = await app.db.select().from(nodeSchemeLinks)
    .where(eq(nodeSchemeLinks.nodeDrawingId, id));
  if (links.length > 0) {
    const schemeIds = links.map((link) => link.schemeId);
    const publishedSchemes = await app.db.select({ id: constructionSchemes.id }).from(constructionSchemes)
      .where(and(
        ...publishedReferenceConditions(constructionSchemes),
        or(...schemeIds.map((schemeId) => eq(constructionSchemes.id, schemeId)))
      ));
    const publishedIds = new Set(publishedSchemes.map((row) => row.id));
    for (const link of links) {
      if (!publishedIds.has(link.schemeId)) {
        violations.push({ field: `schemeLinks.${link.schemeId}`, message: "关联的构造方案未发布或已失效" });
      }
    }
  }
  return violations;
}

/** 结构校验（submit/publish 前置，违规抛 400） */
export async function validateNodeStructure(app: FastifyInstance, id: string) {
  const violations = await collectNodeStructureViolations(app, id);
  if (violations.length > 0) {
    throw new NodeError("NODE_STRUCTURE_INVALID", violations.map((v) => v.message).join("；"));
  }
}

// ---------------------------------------------------------------- 节点-方案关联（子表，随父节点状态守卫）

export interface NodeSchemeLinkInput {
  schemeId: string;
  atlasPage?: string | null;
  remark?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

async function requireEditableNode(app: FastifyInstance, nodeDrawingId: string) {
  const [node] = await app.db.select().from(nodeDrawings).where(eq(nodeDrawings.id, nodeDrawingId)).limit(1);
  if (!node) throw new NodeError("NODE_ENTITY_NOT_FOUND", "节点图不存在");
  assertEditable(node as Record<string, unknown>, NODE_META().label, CHILD_EDITABLE);
  return node;
}

/** 关联前校验：构造方案必须已发布且生效（关联入报告时数值/结构可溯源） */
async function assertSchemePublished(app: FastifyInstance, schemeId: string) {
  const [scheme] = await app.db.select().from(constructionSchemes)
    .where(and(eq(constructionSchemes.id, schemeId), ...publishedReferenceConditions(constructionSchemes))).limit(1);
  if (!scheme) throw new NodeError("NODE_REFERENCE_NOT_PUBLISHED", "关联的构造方案未发布或已失效");
}

export async function listNodeSchemeLinks(
  app: FastifyInstance,
  nodeDrawingId: string,
  query: { page: number; pageSize: number; status?: MdReviewStatus; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = eq(nodeSchemeLinks.nodeDrawingId, nodeDrawingId);
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(nodeSchemeLinks).where(where).orderBy(desc(nodeSchemeLinks.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(nodeSchemeLinks).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function createNodeSchemeLink(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  nodeDrawingId: string, input: NodeSchemeLinkInput
) {
  await requireEditableNode(app, nodeDrawingId);
  await assertSchemePublished(app, input.schemeId);
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(nodeSchemeLinks).values({
      nodeDrawingId,
      schemeId: input.schemeId,
      atlasPage: input.atlasPage,
      remark: input.remark,
      evidenceSource: input.evidenceSource,
      evidenceRef: input.evidenceRef,
      evidenceLevel: input.evidenceLevel,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "node_scheme_link", targetId: created!.id,
      afterJson: { nodeDrawingId, schemeId: created!.schemeId }
    });
    return created!;
  });
}

export async function updateNodeSchemeLink(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<NodeSchemeLinkInput>
) {
  const [existing] = await app.db.select().from(nodeSchemeLinks).where(eq(nodeSchemeLinks.id, id)).limit(1);
  if (!existing) throw new NodeError("NODE_ENTITY_NOT_FOUND", "节点方案关联不存在");
  await requireEditableNode(app, existing.nodeDrawingId);
  const schemeId = input.schemeId === undefined ? existing.schemeId : input.schemeId;
  await assertSchemePublished(app, schemeId);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(nodeSchemeLinks).set({
      schemeId,
      atlasPage: input.atlasPage === undefined ? existing.atlasPage : input.atlasPage,
      remark: input.remark === undefined ? existing.remark : input.remark,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(nodeSchemeLinks.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "node_scheme_link", targetId: id,
      beforeJson: { schemeId: existing.schemeId }, afterJson: { schemeId: updated!.schemeId }
    });
    return updated!;
  });
}

export async function deleteNodeSchemeLink(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await app.db.select().from(nodeSchemeLinks).where(eq(nodeSchemeLinks.id, id)).limit(1);
  if (!existing) throw new NodeError("NODE_ENTITY_NOT_FOUND", "节点方案关联不存在");
  await requireEditableNode(app, existing.nodeDrawingId);
  await app.db.transaction(async (tx) => {
    await tx.delete(nodeSchemeLinks).where(eq(nodeSchemeLinks.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "node_scheme_link", targetId: id,
      beforeJson: { schemeId: existing.schemeId }
    });
  });
  return { message: "节点方案关联已删除" };
}

// ---------------------------------------------------------------- 已发布读取（只读 PUBLISHED + 生效中）

export interface PublishedNodeQuery {
  systemId?: string;
  position?: string;
  keyword?: string;
}

/** 按 系统 + 部位 精确返回已发布且生效中的节点（含已发布方案关联），供报告快照与检索复用 */
export async function listPublishedNodesWithLinks(
  db: DbExecutor,
  query: PublishedNodeQuery = {}
) {
  const conditions = [
    ...publishedReferenceConditions(nodeDrawings),
    query.systemId ? eq(nodeDrawings.systemId, query.systemId) : undefined,
    query.position ? eq(nodeDrawings.position, query.position) : undefined,
    query.keyword
      ? or(
          ilike(nodeDrawings.code, `%${query.keyword}%`),
          ilike(nodeDrawings.name, `%${query.keyword}%`),
          ilike(nodeDrawings.position, `%${query.keyword}%`)
        )
      : undefined
  ];
  const nodes = await db.select().from(nodeDrawings).where(and(...conditions)).orderBy(desc(nodeDrawings.version));
  if (nodes.length === 0) return [];

  const nodeIds = nodes.map((node) => node.id);
  const links = await db.select().from(nodeSchemeLinks)
    .where(and(
      or(...nodeIds.map((id) => eq(nodeSchemeLinks.nodeDrawingId, id))),
      ...effectiveRangeConditions(nodeSchemeLinks)
    ));
  // 只保留关联到已发布且生效中方案的链接（报告/检索不得引用草稿方案）
  const schemeIds = [...new Set(links.map((link) => link.schemeId))];
  const publishedSchemes = schemeIds.length > 0
    ? await db.select({ id: constructionSchemes.id }).from(constructionSchemes)
        .where(and(
          ...publishedReferenceConditions(constructionSchemes),
          or(...schemeIds.map((id) => eq(constructionSchemes.id, id)))
        ))
    : [];
  const publishedSchemeIds = new Set(publishedSchemes.map((row) => row.id));

  return nodes.map((node) => ({
    ...node,
    schemeLinks: links.filter((link) => link.nodeDrawingId === node.id && publishedSchemeIds.has(link.schemeId))
  }));
}