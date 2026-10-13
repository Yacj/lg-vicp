/** 仅表示差异归一；不同基层种类不能互换，不推断缺失材料。 */
export function normalizeSubstrateMaterial(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").replace(/\d+(?:\.\d+)?(?:mm|毫米|㎜)/gi, "")
    .replace(/蒸压加气混凝土(?:砌块)?|加气混凝土块|加气砌块|加气混凝土(?!砌块)|加气砼(?:砌块)?/g, "加气混凝土砌块")
    .replace(/钢筋砼/g, "钢筋混凝土").replace(/混凝土空心块|空心混凝土砌块|砼空心砌块/g, "混凝土空心砌块")
    .replace(/^(?:基层材料|基层|基墙|墙体材料)[:：]?/, "").toLowerCase();
}
