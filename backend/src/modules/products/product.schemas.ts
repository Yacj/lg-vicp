import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";

export const catalogProductStatusSchema = z.enum(["ACTIVE", "DISABLED"]);

export const catalogSpecClassSchema = z.enum(["I", "II", "III"]);

export const catalogProductDto = z.object({
  id: z.uuid(),
  name: z.string(),
  categoryId: z.uuid().nullable(),
  summary: z.string().nullable(),
  productType: z.string().nullable(),
  specClass: catalogSpecClassSchema.nullable(),
  thermalConductivity: z.number().nullable(),
  correctionFactor: z.number().nullable(),
  thicknessOptionsMm: z.array(z.number()),
  status: catalogProductStatusSchema,
  sortOrder: z.number(),
  knowledgeDocumentIds: z.array(z.uuid()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const createCatalogProductBodySchema = z.object({
  name: z.string().trim().min(1, "请输入产品名称").max(160),
  categoryId: z.uuid("分类 ID 格式不正确").nullable().optional(),
  summary: z.string().trim().max(2000).nullable().optional(),
  productType: z.string().trim().max(80).nullable().optional(),
  specClass: catalogSpecClassSchema.nullable().optional(),
  thermalConductivity: z.number().positive().max(100).nullable().optional(),
  correctionFactor: z.number().positive().max(100).nullable().optional(),
  thicknessOptionsMm: z.array(z.number().positive().max(100000)).max(40).optional(),
  status: catalogProductStatusSchema.optional(),
  sortOrder: z.number().int().min(0).max(99999).optional(),
  knowledgeDocumentIds: z.array(z.uuid()).max(50).optional()
});

export const updateCatalogProductBodySchema = createCatalogProductBodySchema.partial()
  .refine((value) => Object.keys(value).length > 0, "至少需要修改一个字段");

export const catalogProductParamsSchema = z.object({
  id: z.uuid("产品 ID 格式不正确")
});

export const catalogProductListQuerySchema = paginationQuerySchema.extend({
  keyword: z.string().trim().max(120).optional(),
  status: catalogProductStatusSchema.optional()
});

export const productCompareBodySchema = z.object({
  productIds: z.array(z.uuid("产品 ID 格式不正确")).min(2, "至少选择 2 个产品").max(10, "一次最多对比 10 个产品"),
  explainWithAi: z.boolean().optional()
});
