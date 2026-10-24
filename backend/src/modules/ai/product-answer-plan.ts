import { z } from "zod";
import type { ProductAnswerFacts } from "./product-answer.js";

/** 模型只组织事实引用；自由文本、数值和来源身份不属于模型的输出权限。 */
export const productAnswerPlanSchema = z.object({ products: z.array(z.object({ productId: z.string(),
  fields: z.array(z.enum(["SUMMARY", "CATEGORY", "THICKNESS", "LAMBDA", "CORRECTION", "SPECS", "DOCUMENTS"])).max(7)
}).strict()).max(24) }).strict();
export type ProductAnswerPlan = z.infer<typeof productAnswerPlanSchema>;

export function renderProductAnswerPlan(plan: ProductAnswerPlan, facts: ProductAnswerFacts): string | null {
  const parsed = productAnswerPlanSchema.safeParse(plan);
  if (!parsed.success || parsed.data.products.length !== facts.products.length) return null;
  const ids = new Set(parsed.data.products.map(row => row.productId));
  if (ids.size !== facts.products.length || facts.products.some(product => !ids.has(product.id))) return null;
  const lines = parsed.data.products.map(row => {
    const product = facts.products.find(item => item.id === row.productId)!;
    const fields = new Set(facts.mode === "TECHNICAL" ? row.fields : row.fields.filter(field => field === "SUMMARY" || field === "CATEGORY" || field === "DOCUMENTS"));
    // 介绍的主要资料不能被模型省略；空summary不是编造用途的许可。
    const parts: string[] = [product.approvedAliases?.length ? `${product.approvedAliases.join("、")} 是“${product.name}”的简称` : product.name];
    if (product.summary && (facts.mode !== "TECHNICAL" || fields.has("SUMMARY"))) parts.push(product.summary);
    else if (facts.mode !== "TECHNICAL") parts.push(facts.audience === "GENERAL" ? "简单说，目前能核对的是它的规格和技术参数，产品特点的正式说明还不完整" : "目前产品介绍资料还不完整，可以继续帮你查已发布规格、技术参数或参考构造");
    if (fields.has("CATEGORY") && product.productType && !product.name.includes(product.productType)) parts.push(`它属于${product.productType}产品`);
    if (fields.has("THICKNESS") && product.thicknessOptionsMm.length) parts.push(`可选板厚为${product.thicknessOptionsMm.join("、")}mm`);
    if (fields.has("LAMBDA") && product.thermalConductivity != null) parts.push(`目录产品导热系数λ=${product.thermalConductivity} W/(m·K)`);
    if (fields.has("CORRECTION") && product.correctionFactor != null) parts.push(`修正系数α=${product.correctionFactor}`);
    if (fields.has("SPECS") && product.specifications.length) parts.push(`已发布规格：${product.specifications.map(spec=>`${spec.specCode}${spec.thicknessMm == null ? "" : `（${spec.thicknessMm}mm）`}`).join("、")}`);
    if (fields.has("DOCUMENTS") && product.hasTechnicalDocs) parts.push("有对应的技术资料可以进一步查看");
    return parts.join("。") + "。";
  });
  return `${facts.hasMore ? "先介绍其中几款产品：" : facts.products.length === 1 ? "可以先了解这款产品：" : "目前可以介绍这些产品："}\n${lines.join("\n")}${facts.seriesRequested ? "\n目前资料可介绍这些产品，完整系列的型号清单还需要补充。" : ""}`;
}

export function productAnswerPlanPrompt(facts: ProductAnswerFacts) {
  return `按用户目标和audience组织产品事实引用。输出符合以下JSON Schema的JSON：${JSON.stringify(z.toJSONSchema(productAnswerPlanSchema))}。产品必须全部保留，每款仅一次，不输出事实文字或数值。GENERAL/SALES优先SUMMARY、CATEGORY、DOCUMENTS；只有用户需要技术参数时选择THICKNESS/LAMBDA/CORRECTION/SPECS。事实范围：${JSON.stringify(facts)}`;
}
