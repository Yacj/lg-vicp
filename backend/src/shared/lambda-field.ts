/** SM-PARAMETER-FIELD-01：封闭工程属性名称；仅作字段/单位验证，不能作为意图路由。 */
export const hasLambdaField = (text: string) => /导热系数|λ|\blambda\b/i.test(text);
export const canonicalLambdaUnit = (text: string) => text.normalize("NFKC").replace(/\s|[⋅·.()]/g, "").toLowerCase();
const thermalUnit = () => /W\s*\/\s*(?:\([^)]*\)|m[²2]?[⋅·.]?K)/gi;
export function lambdaUnitIsValid(text: string) {
  const units = text.match(thermalUnit()) ?? [];
  return units.every(unit => canonicalLambdaUnit(unit) === "w/mk");
}
/** SM-PARAMETER-UNIT-01：单位内部的K仅为开尔文符号，不是传热系数查询字段。 */
export function insideThermalUnit(text: string, index: number) {
  return [...text.matchAll(thermalUnit())].some(match => index >= match.index && index < match.index + match[0].length);
}
