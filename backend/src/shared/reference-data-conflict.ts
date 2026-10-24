import { z } from "zod";

/** 已授权读取中的差异证据，只用于资料核对，不是候选、计算输入或修订建议。 */
export const referenceDataConflictSchema = z.object({
  kind: z.enum(["SPEC_THICKNESS_MISMATCH", "SOURCE_VALUE_MISMATCH"]),
  subject: z.string().min(1).max(500),
  field: z.enum(["THICKNESS", "K", "PRODUCT_R", "TOTAL_R"]),
  observations: z.array(z.object({
    label: z.string().min(1).max(200), value: z.number().finite(),
    source: z.object({ title: z.string().min(1).max(500), location: z.string().max(500).nullable().optional(),
      version: z.number().int().positive().nullable().optional() }).strict()
  }).strict()).min(2).max(8),
  usage: z.literal("READ_ONLY")
}).strict();
export const referenceDataConflictsSchema = z.array(referenceDataConflictSchema).max(100);
export type ReferenceDataConflict = z.infer<typeof referenceDataConflictSchema>;

export interface SpecThicknessMismatchEvidence {
  rowThicknessMm: number; specCode: string | null; specThicknessMm: number;
  schemeCode?: string | null; schemeName?: string | null;
  evidenceSource?: string | null; evidenceRef?: string | null;
  setCode?: string | null; setVersion?: number | null; specVersion?: number | null;
}
export function specThicknessConflict(row: SpecThicknessMismatchEvidence): ReferenceDataConflict {
  return { kind: "SPEC_THICKNESS_MISMATCH", subject: row.schemeCode?.trim() || row.schemeName?.trim() || "这条参考记录", field: "THICKNESS", usage: "READ_ONLY",
    observations: [
      { label: "参考表中的保温厚度", value: row.rowThicknessMm,
        source: { title: row.evidenceSource?.trim() || row.setCode?.trim() || "参考数据（未标注具体资料名称）", location: row.evidenceRef, version: row.setVersion } },
      { label: "关联规格的板厚", value: row.specThicknessMm,
        source: { title: row.specCode?.trim() || "产品规格（未标注规格编码）", version: row.specVersion } }
    ] };
}
const fieldLabels = { THICKNESS: "厚度", K: "传热系数 K", PRODUCT_R: "产品层热阻 R", TOTAL_R: "整构造总热阻 R₀" };
const units = { THICKNESS: "mm", K: "W/(m²·K)", PRODUCT_R: "m²·K/W", TOTAL_R: "m²·K/W" };
// 来源文字作为表格单元格，不允许成为Markdown链接、HTML或内部引用标记。
const escaped = (text: string) => text.replace(/[&<>\[\]|`]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "[": "&#91;", "]": "&#93;", "|": "&#124;", "`": "&#96;" })[char]!).replace(/[\r\n]+/g, " ");
export function renderReferenceDataConflict(input: ReferenceDataConflict): string {
  const conflict = referenceDataConflictSchema.parse(input);
  const rows = conflict.observations.map(item => {
    const source = [item.source.title, item.source.location, item.source.version == null ? null : `版本 ${item.source.version}`].filter(Boolean).join("，");
    return `| ${escaped(item.label)} | ${item.value} ${units[conflict.field]} | ${escaped(source)} |`;
  });
  const explanation = conflict.kind === "SPEC_THICKNESS_MISMATCH"
    ? "上面两处的厚度不一致，暂时不能把这条记录当成可用方案。这不表示原表没有这个做法；资料核实前，可以查看这些记录，但不能用这条冲突记录做正式计算或生成方案报告。"
    : `同一构造、同一厚度的${fieldLabels[conflict.field]}在两份资料里不一致，暂时不能据此给出统一结论。可以先对照来源核实，我不会自行选一个数值或将它们合并计算。`;
  return [`**待核对的资料：${escaped(conflict.subject)}**`, "| 核对项 | 资料中的原值 | 来源 |", "| --- | --- | --- |", ...rows, "", explanation,
    "需要资料负责人核对后修订；我会保留两处原值，不擅自判断哪一处正确。"].join("\n");
}
