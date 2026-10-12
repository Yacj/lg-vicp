/** 识别模型的字段映射说明不是原页内容；历史消息也只展示可读备注。 */
export function readableReferenceAnnotations(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values))
    return []
  return values.filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value
      && !/\b(?:layers|options|null|renderModel|constructionId|optionId|thicknessMm|rValue|productThermalResistance|totalThermalResistance|kValue)\b/i.test(value)
      && !/按构造编号.*(?:分为|划分|拆分)/.test(value))
}
