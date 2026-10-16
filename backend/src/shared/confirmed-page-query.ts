import { z } from "zod";
import { pageRecognitionSystemSchema } from "./page-recognition.js";

/** 只读资料查询字段；复用识别合同中的枚举，不是新的意图路由。 */
export const pageAttributeFields = ["applicationPart", "roofForm", "placement", "waterproofGrade", "pageLabel"] as const;
/** 读取投影不是筛选目标；沿用来源事实/页面能力名，不授权任何副作用。 */
export const confirmedPageReadFieldSchema = z.enum(["kValue", "totalThermalResistance", "productThermalResistance", "baseMaterial", "layers", "notes", "originalPage"]);
export const confirmedPageQueryFields = {
  readFields: z.array(confirmedPageReadFieldSchema).max(7).optional(),
  applicationPart: pageRecognitionSystemSchema.shape.applicationPart.unwrap().unwrap().optional(),
  roofForm: pageRecognitionSystemSchema.shape.roofForm.unwrap().unwrap().optional(),
  placement: pageRecognitionSystemSchema.shape.placement.unwrap().unwrap().optional(),
  placements: z.array(pageRecognitionSystemSchema.shape.placement.unwrap().unwrap()).min(1).max(2).optional(),
  waterproofGrade: z.string().optional(),
  pageLabel: z.string().optional(),
  constructionCodes: z.array(z.string()).optional(),
  specClasses: z.array(pageRecognitionSystemSchema.shape.specClass.unwrap().unwrap()).optional()
};

/** 仅验证模型已选择字段的原话字形；不扫描整句、判断意图或从型号推断防水。 */
export function groundedPageAttribute(field: typeof pageAttributeFields[number], text: string): string | undefined {
  const value = text.normalize("NFKC").replace(/\s/g, "");
  const values: Partial<Record<typeof pageAttributeFields[number], Record<string, string>>> = {
    applicationPart: { 屋面: "ROOF", 坡屋面: "ROOF", 平屋面: "ROOF", 外墙: "EXTERNAL_WALL" },
    roofForm: { 坡屋面: "SLOPED", 平屋面: "FLAT" },
    placement: { 正置: "UPRIGHT", 倒置: "INVERTED" }
  };
  if (field === "pageLabel") {
    const label = /^(?:第)?([A-Za-z]?\d+(?:[-.]\d+)*)(?:页|頁)$/.exec(value)?.[1] ?? value;
    return /^[A-Za-z]?\d+(?:[-.]\d+)*$/.test(label) ? label : undefined;
  }
  if (field === "waterproofGrade") {
    const match = /^(I{1,3}|[一二三123])级防水$/.exec(value);
    const grade: Record<string, string> = { I: "I", II: "II", III: "III", 一: "I", 二: "II", 三: "III", "1": "I", "2": "II", "3": "III" };
    return match ? `${grade[match[1]!]}级防水` : undefined;
  }
  return values[field]?.[value];
}
