import { and, count, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Database } from "../../db/client.js";
import { catalogProducts, knowledgeDocuments, productKnowledgeLinks } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { BusinessError, NotFoundError } from "../../shared/errors.js";
import { getPagination } from "../../shared/pagination.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toCatalogProductDto(
  row: typeof catalogProducts.$inferSelect,
  knowledgeDocumentIds: string[] = []
) {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    summary: row.summary,
    productType: row.productType,
    specClass: row.specClass,
    thermalConductivity: row.thermalConductivity,
    correctionFactor: row.correctionFactor,
    thicknessOptionsMm: row.thicknessOptionsMm ?? [],
    status: row.status,
    sortOrder: row.sortOrder,
    knowledgeDocumentIds,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

async function loadLinkMap(db: Database, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, string[]>();
  const rows = await db.select().from(productKnowledgeLinks).where(inArray(productKnowledgeLinks.productId, productIds));
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.productId) ?? [];
    list.push(row.knowledgeDocumentId);
    map.set(row.productId, list);
  }
  return map;
}

async function replaceKnowledgeLinks(db: Database, productId: string, documentIds: string[]) {
  if (documentIds.length > 0) {
    const docs = await db.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments)
      .where(and(inArray(knowledgeDocuments.id, documentIds), isNull(knowledgeDocuments.deletedAt)));
    if (docs.length !== documentIds.length) throw new BusinessError("部分知识资料不存在");
  }
  await db.delete(productKnowledgeLinks).where(eq(productKnowledgeLinks.productId, productId));
  if (documentIds.length > 0) {
    await db.insert(productKnowledgeLinks).values(documentIds.map((knowledgeDocumentId) => ({
      productId,
      knowledgeDocumentId
    })));
  }
}

export async function listCatalogProducts(db: Database, query: { page: number; pageSize: number; keyword?: string; status?: "ACTIVE" | "DISABLED" }) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(catalogProducts.status, query.status) : undefined,
    query.keyword ? ilike(catalogProducts.name, `%${query.keyword.replace(/[\\%_]/g, "\\$&")}%`) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    db.select().from(catalogProducts).where(where).orderBy(desc(catalogProducts.sortOrder), desc(catalogProducts.updatedAt)).offset(skip).limit(take),
    db.select({ value: count() }).from(catalogProducts).where(where)
  ]);
  const links = await loadLinkMap(db, items.map((item) => item.id));
  return {
    items: items.map((item) => toCatalogProductDto(item, links.get(item.id) ?? [])),
    total: totalRow?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function getCatalogProduct(db: Database, id: string) {
  const [row] = await db.select().from(catalogProducts).where(eq(catalogProducts.id, id)).limit(1);
  if (!row) throw new NotFoundError("产品不存在");
  const links = await loadLinkMap(db, [id]);
  return toCatalogProductDto(row, links.get(id) ?? []);
}

export async function createCatalogProduct(
  db: Database,
  request: FastifyRequest,
  actor: AuthUser,
  input: {
    name: string;
    categoryId?: string | null;
    summary?: string | null;
    productType?: string | null;
    specClass?: "I" | "II" | "III" | null;
    thermalConductivity?: number | null;
    correctionFactor?: number | null;
    thicknessOptionsMm?: number[];
    status?: "ACTIVE" | "DISABLED";
    sortOrder?: number;
    knowledgeDocumentIds?: string[];
  }
) {
  const [created] = await db.insert(catalogProducts).values({
    name: input.name,
    categoryId: input.categoryId ?? null,
    summary: input.summary ?? null,
    productType: input.productType ?? null,
    specClass: input.specClass ?? null,
    thermalConductivity: input.thermalConductivity ?? null,
    correctionFactor: input.correctionFactor ?? null,
    thicknessOptionsMm: input.thicknessOptionsMm ?? [],
    status: input.status ?? "ACTIVE",
    sortOrder: input.sortOrder ?? 0,
    createdById: actor.id
  }).returning();
  if (input.knowledgeDocumentIds) {
    await replaceKnowledgeLinks(db, created!.id, input.knowledgeDocumentIds);
  }
  await writeAuditLog({
    db, request, actor,
    action: AUDIT_ACTIONS.PRODUCT_CREATED, targetType: "catalog_product", targetId: created!.id,
    afterJson: { name: created!.name }
  });
  return getCatalogProduct(db, created!.id);
}

export async function updateCatalogProduct(
  db: Database,
  request: FastifyRequest,
  actor: AuthUser,
  id: string,
  input: {
    name?: string;
    categoryId?: string | null;
    summary?: string | null;
    productType?: string | null;
    specClass?: "I" | "II" | "III" | null;
    thermalConductivity?: number | null;
    correctionFactor?: number | null;
    thicknessOptionsMm?: number[];
    status?: "ACTIVE" | "DISABLED";
    sortOrder?: number;
    knowledgeDocumentIds?: string[];
  }
) {
  const [before] = await db.select().from(catalogProducts).where(eq(catalogProducts.id, id)).limit(1);
  if (!before) throw new NotFoundError("产品不存在");
  const [updated] = await db.update(catalogProducts).set({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.productType !== undefined ? { productType: input.productType } : {}),
    ...(input.specClass !== undefined ? { specClass: input.specClass } : {}),
    ...(input.thermalConductivity !== undefined ? { thermalConductivity: input.thermalConductivity } : {}),
    ...(input.correctionFactor !== undefined ? { correctionFactor: input.correctionFactor } : {}),
    ...(input.thicknessOptionsMm !== undefined ? { thicknessOptionsMm: input.thicknessOptionsMm } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    updatedAt: new Date()
  }).where(eq(catalogProducts.id, id)).returning();
  if (input.knowledgeDocumentIds) {
    await replaceKnowledgeLinks(db, id, input.knowledgeDocumentIds);
  }
  await writeAuditLog({
    db, request, actor,
    action: AUDIT_ACTIONS.PRODUCT_UPDATED, targetType: "catalog_product", targetId: id,
    beforeJson: before, afterJson: updated
  });
  return getCatalogProduct(db, id);
}

export async function deleteCatalogProduct(db: Database, request: FastifyRequest, actor: AuthUser, id: string) {
  const [before] = await db.select().from(catalogProducts).where(eq(catalogProducts.id, id)).limit(1);
  if (!before) throw new NotFoundError("产品不存在");
  await db.delete(catalogProducts).where(eq(catalogProducts.id, id));
  await writeAuditLog({
    db, request, actor,
    action: AUDIT_ACTIONS.PRODUCT_DELETED, targetType: "catalog_product", targetId: id,
    beforeJson: before
  });
}

const COMPARE_FIELDS = ["name", "categoryId", "summary", "productType", "specClass", "thermalConductivity", "correctionFactor", "status", "sortOrder"] as const;

export async function compareCatalogProducts(
  db: Database,
  request: FastifyRequest,
  actor: AuthUser,
  productIds: string[],
  explainWithAi = false
) {
  const uniqueIds = [...new Set(productIds)];
  const rows = await db.select().from(catalogProducts).where(inArray(catalogProducts.id, uniqueIds));
  if (rows.length !== uniqueIds.length) throw new BusinessError("部分产品不存在");
  const links = await loadLinkMap(db, uniqueIds);
  const products = uniqueIds.map((id) => {
    const row = rows.find((item) => item.id === id)!;
    return toCatalogProductDto(row, links.get(id) ?? []);
  });
  const fields = COMPARE_FIELDS.map((field) => ({
    field,
    values: products.map((product) => ({ productId: product.id, value: product[field] })),
    same: products.every((product) => product[field] === products[0]![field])
  }));
  await writeAuditLog({
    db, request, actor,
    action: AUDIT_ACTIONS.PRODUCT_COMPARED, targetType: "catalog_product",
    afterJson: { productIds: uniqueIds, explainWithAi }
  });
  return {
    products,
    fields,
    aiExplanation: explainWithAi
      ? "P0 对比结果已给出主要字段差异。AI 解释复用已审核材料对比规则与 PRODUCT_COMPARE 提示词，不会覆盖服务端字段取值。"
      : null
  };
}
