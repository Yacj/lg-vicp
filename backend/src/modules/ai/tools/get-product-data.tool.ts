import { tool } from "ai";
import { z } from "zod";
import { searchProductCatalog } from "../product-read.service.js";
import { runRegisteredTool, type ToolRuntimeContext } from "./tool-runtime.js";
import { toolOk, toolError } from "./tool-output.js";
import { normalizeProductDataForModel } from "./tool-result-normalizer.js";

export const getProductDataInput = z.object({
  operation: z.enum(["READ", "SEARCH"]).default("READ"),
  productIds: z.array(z.string().trim().min(1)).min(1).max(12).optional().describe("READ只能使用本轮正式搜索或已校验UI选择的产品ID"),
  keyword: z.string().trim().min(1).max(160).optional().describe("SEARCH可选名称/类型关键词，必须是本轮原话片段；询问有哪些产品时可不传"),
  productType: z.string().trim().min(1).max(80).optional(),
  specClass: z.enum(["I","II","III"]).optional()
}).refine(input=>input.operation==="SEARCH"||Boolean(input.productIds?.length),{message:"READ至少指定一个已知产品"});

export function createGetProductDataTool(ctx: ToolRuntimeContext) {
  return tool({
    description: `
      读取产品目录中已有的结构化字段，以及是否已有技术资料。
      首次咨询没有ProductId必须operation=SEARCH，按原话关键词/产品类型/型号搜索，禁止猜ID。
      只返回真实存在的字段。
    `,
    inputSchema: getProductDataInput,
    execute: async (args, options) => runRegisteredTool(ctx, "get_product_data", args, options, async () => {
      const ids = [...new Set(args.productIds ?? [])];
      const allowed = new Set([...(ctx.productReadIds ?? []), ...(ctx.taskState?.selectedProductIds ?? [])]);
      if (args.operation === "READ" && ids.some(id=>!allowed.has(id))) return toolError({code:"PRODUCT_REFERENCE_REQUIRED",message:"请先搜索正式产品或确认界面选择，不能猜测产品ID。"});
      const result=await searchProductCatalog(ctx,{...args,productIds:args.operation==="READ"?ids:undefined});
      ctx.productReadIds=[...new Set([...(ctx.productReadIds??[]),...result.products.map(item=>item.id)])];
      const found = new Set(result.products.map((item) => item.id));
      const missing = ids.filter((id) => !found.has(id));
      ctx.onEvent?.("product_cards", {
        products: result.products
      });
      const data = normalizeProductDataForModel({
        products: result.products,
        missingProductIds: missing
      });
      return toolOk({...data,hasMore:result.hasMore}, { summary: `已读取 ${result.products.length} 个正式产品`, sources:result.sources });
    })
  });
}
