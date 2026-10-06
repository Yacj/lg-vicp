import { tool } from "ai";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { catalogProducts, productKnowledgeLinks } from "../../../db/schema.js";
import { runRegisteredTool, type ToolRuntimeContext } from "./tool-runtime.js";
import { toolOk } from "./tool-output.js";
import { normalizeProductDataForModel } from "./tool-result-normalizer.js";

export const getProductDataInput = z.object({
  productIds: z.array(z.string().trim().min(1)).min(1).max(12)
    .describe("要读取的产品 ID，至少 1 个")
});

export function createGetProductDataTool(ctx: ToolRuntimeContext) {
  return tool({
    description: `
      读取产品目录中已有的结构化字段，以及是否已有技术资料。
      只返回真实存在的字段。
    `,
    inputSchema: getProductDataInput,
    execute: async ({ productIds }, options) => runRegisteredTool(ctx, "get_product_data", { productIds }, options, async () => {
      const ids = [...new Set(productIds)];
      const rows = await ctx.app.db.select({
        id: catalogProducts.id,
        name: catalogProducts.name,
        categoryId: catalogProducts.categoryId,
        summary: catalogProducts.summary,
        status: catalogProducts.status
      }).from(catalogProducts).where(and(
        inArray(catalogProducts.id, ids),
        eq(catalogProducts.status, "ACTIVE")
      ));
      const links = await ctx.app.db.select({
        productId: productKnowledgeLinks.productId,
        knowledgeDocumentId: productKnowledgeLinks.knowledgeDocumentId
      }).from(productKnowledgeLinks).where(inArray(productKnowledgeLinks.productId, ids));
      const linkMap = new Map<string, string[]>();
      for (const link of links) {
        const list = linkMap.get(link.productId) ?? [];
        list.push(link.knowledgeDocumentId);
        linkMap.set(link.productId, list);
      }
      const found = new Set(rows.map((item) => item.id));
      const missing = ids.filter((id) => !found.has(id));
      ctx.onEvent?.("product_cards", {
        products: rows.map((row) => ({
          id: row.id,
          name: row.name,
          summary: row.summary
        }))
      });
      const data = normalizeProductDataForModel({
        products: rows.map((row) => ({
          id: row.id,
          name: row.name,
          summary: row.summary,
          knowledgeDocumentIds: linkMap.get(row.id) ?? []
        })),
        missingProductIds: missing
      });
      return toolOk(data, { summary: `已读取 ${rows.length} 个产品` });
    })
  });
}
