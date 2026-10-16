import type { PageRecognitionResult } from "./page-recognition.js";

/** 只校验封闭字段、枚举、原文字形及组内数组引用；不解析业务意图、不做热工计算。 */
const glyphs = (value: string | null | undefined) => value?.normalize("NFKC").replace(/\s/g, "") ?? "";
function sameSourceNumber(value: number, text: string | null | undefined): boolean {
  const raw = glyphs(text);
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw) && Number(raw) === value;
}

/** 仅用于新识别/人工保存的v2草稿；老确认数据读取不调用，不改旧JSON或其引用hash。 */
export function validatePageRecognitionEvidence(data: PageRecognitionResult): { data: PageRecognitionResult; issues: string[] } {
  if (data.schemaVersion !== 2) return { data, issues: [] };
  const issues: string[] = [];
  const issue = (message: string) => { issues.push(message); };
  let pageLabel = data.pageLabel;
  if (pageLabel && (pageLabel.length > 32 || glyphs(pageLabel) !== glyphs(data.pageLabelEvidence) || glyphs(pageLabel) === glyphs(data.pageTitle))) {
    issue("印刷页码缺少一致原文字形或与标题混淆，已留空，请核对原图页脚");
    pageLabel = null;
  }
  const warnings = [...(data.warnings ?? [])];
  if (!pageLabel) warnings.push("印刷页码尚未核验，请人工核对原图，不使用物理页序补齐");
  const systems = data.systems.map((system, groupIndex) => {
    const group = `第${groupIndex + 1}组构造`;
    let constructionCode = system.constructionCode;
    const rawLabel = glyphs(system.rawConstructionLabel);
    if (constructionCode && /=/.test(constructionCode)) warnings.push(`${group}的构造编号含等号，请对照原图核对连字符；不自动改写编号`);
    if (system.layers?.some(layer => layer.sourceRegion === "UNKNOWN")) warnings.push(`${group}存在来源区域待核的材料行，请区分热工表与构造简图后再确认`);
    if (constructionCode) {
      const code = glyphs(constructionCode);
      const printed = glyphs(system.constructionCodeEvidence);
      const start = rawLabel.indexOf(code);
      const completeToken = start >= 0 && !/[A-Z0-9-]/i.test(rawLabel[start - 1] ?? " ")
        && !/[A-Z0-9-]/i.test(rawLabel[start + code.length] ?? " ");
      const evidenced = (printed === code || printed === rawLabel) && Boolean(rawLabel)
        && (/^\d+$/.test(code) ? rawLabel === code : completeToken);
      if (!evidenced) {
        issue(`${group}的构造编号缺少原标签/编号栏证据，已留空；材料层号不能当构造编号`);
        constructionCode = null;
      }
    }
    if (!rawLabel) warnings.push(`${group}缺少原始构造标签，请逐组对照原图`);
    if (!system.applicationPart) warnings.push(`${group}的部位尚未核验，请对照标题、标签和构造简图`);
    if (!system.baseMaterial || system.baseThicknessMm == null) warnings.push(`${group}的基层材料或厚度尚未核验，请核对同组材料行`);
    let waterproofGrade = system.waterproofGrade;
    if (waterproofGrade && (!/^(?:I|II|III|IV|V|[一二三四五1-5])级(?:防水)?$/i.test(glyphs(waterproofGrade)) || !rawLabel.includes(glyphs(waterproofGrade)))) {
      waterproofGrade = null;
      issue(`${group}的防水等级缺少可辨认的等级及原标签证据，已留空；不能从VICP型号补齐`);
    }
    if (system.applicationPart === "ROOF" && !waterproofGrade) warnings.push(`${group}的防水等级尚未核验，请核对原图字形`);
    if (system.applicationPart === "EXTERNAL_WALL" && (system.roofForm != null || system.placement != null)) {
      warnings.push(`${group}的外墙部位与屋面属性冲突，需人工核对`);
    }
    const sourceColumns = system.sourceColumns?.map(column => {
      if (column.symbol && /[\[\]\/]/.test(column.symbol)) {
        issue(`${group}的${column.fieldKey}源文符号混入单位，符号已留空；请对照原表，不推定R或R₀`);
        return { ...column, symbol: null };
      }
      return column;
    });
    const column = (fieldKey: string, scope: string) => system.sourceColumns?.some(item => item.fieldKey === fieldKey && item.scope === scope);
    const options = system.options?.map((option, optionIndex) => {
      const row = `${group}第${optionIndex + 1}档`;
      const checked = { ...option };
      for (const field of ["thicknessMm", "productThermalResistance", "totalThermalResistance", "kValue"] as const) {
        const value = option[field];
        if (value == null) continue;
        const scopeValid = field === "thicknessMm" ? system.sourceColumns?.some(item => item.fieldKey === field)
          : column(field, field === "productThermalResistance" ? "PRODUCT" : "CONSTRUCTION");
        if (!Number.isFinite(value) || value <= 0 || !scopeValid || !sameSourceNumber(value, option.fieldEvidence?.[field])) {
          checked[field] = null;
          issue(`${row}的${field}缺少同字段源列/原始数字证据，已留空；不从其他热阻字段补齐`);
        }
      }
      if (option.layerValues) {
        const used = new Set<number>();
        checked.layerValues = option.layerValues.flatMap(value => {
          if (!system.layers?.[value.layerIndex] || used.has(value.layerIndex) || system.layers[value.layerIndex]?.sourceRegion === "DIAGRAM") {
            issue(`${row}的材料层引用越界、重复或指向构造简图，已拒绝该层档位，不跨来源绑定`);
            return [];
          }
          used.add(value.layerIndex);
          const layerValue = { ...value };
          if (value.rValue != null && (!column("rValue", "LAYER") || value.rValue <= 0 || !sameSourceNumber(value.rValue, value.rValueText))) {
            layerValue.rValue = null;
            issue(`${row}的层热阻缺少材料层原文证据，已留空`);
          }
          if (value.thicknessMm != null && (value.thicknessMm <= 0 || !sameSourceNumber(value.thicknessMm, value.thicknessText))) {
            layerValue.thicknessMm = null;
            issue(`${row}的层厚度缺少一致原文字形，已留空`);
          }
          return [layerValue];
        });
      }
      if (checked.productThermalResistance == null && checked.layerValues?.some(value => value.rValue != null)) {
        warnings.push(`${row}仅有材料层/芯层热阻，产品整体热阻未核验，不作自动热工同步`);
      }
      return checked;
    });
    return { ...system, constructionCode, waterproofGrade, ...(sourceColumns ? { sourceColumns } : {}), ...(options ? { options } : {}) };
  });
  return { data: { ...data, pageLabel, systems, warnings: [...new Set([...warnings, ...issues])] }, issues };
}

/** 新Vision输出强制进入v2证据检查；模型不能给人工映射的正式ID。 */
export function preparePageRecognitionCandidate(data: PageRecognitionResult): PageRecognitionResult {
  return validatePageRecognitionEvidence({
    ...data, schemaVersion: 2,
    systems: data.systems.map(({ schemeId: _schemeId, ...system }) => ({
      ...system,
      options: system.options?.map(({ productSpecId: _productSpecId, catalogProductId: _catalogProductId, ...option }) => option)
    }))
  }).data;
}
