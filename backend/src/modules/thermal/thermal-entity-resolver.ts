import { entityFields, normalizeEntityText, normalizeSystemFamily, normalizeSystemName, type ThermalQueryState } from "./thermal-query-state.js";

/** 实体匹配级别：明确全名 / 族名 / 类别 / 配置别名 / 文本提示。 */
export type EntityMatchStrength = "EXACT" | "FAMILY" | "CATEGORY" | "ALIAS" | "TEXT_HINT";

/**
 * 统一实体约束描述（设计契约）：
 * - EXACT：能解析唯一正式 ID（如「I型 VICP薄抹灰外保温系统」）；
 * - FAMILY：体系族（如「薄抹灰」），解析为同族 systemIds 集合硬约束；
 * - CATEGORY：体系类别（如「保温装饰板」），语义同族提示；
 * - ALIAS：配置别名词典命中；
 * - TEXT_HINT：只有自由文本提示，未匹配正式名称（进入澄清）。
 */
export interface EntityConstraint {
  kind: EntityMatchStrength;
  ids?: string[];
  normalizedName?: string;
  rawText?: string;
}

export interface QueryEntity {
  field: typeof entityFields[number];
  value: string;
  names: string[];
  /** 体系族名（如「薄抹灰」）；同族多条记录时生成 systemIds 集合硬约束 */
  family?: string;
  /** 体系类别（systemType）；语义同族提示 */
  category?: string;
}
export interface QueryAlias { term: string; alias: string }

interface EntityHit {
  entity: QueryEntity;
  name: string;
  index: number;
  length: number;
  strength: EntityMatchStrength;
  operation: "UPDATE" | "EXCLUDE" | "PREFER" | "REMOVE" | "REMOVE_EXCLUSION" | "REMOVE_PREFERENCE";
}

function classifyOperation(prefix: string): EntityHit["operation"] {
  if (/(?:取消|去掉)(?:排除|不选|不用)/.test(prefix)) return "REMOVE_EXCLUSION";
  if (/(?:取消|去掉)(?:优先|偏好)/.test(prefix)) return "REMOVE_PREFERENCE";
  if (/取消|不限制|先不看|去掉/.test(prefix)) return "REMOVE";
  if (/不要|排除|不用|不选/.test(prefix)) return "EXCLUDE";
  if (/优先|最好|尽量/.test(prefix)) return "PREFER";
  return "UPDATE";
}

/**
 * 体系实体解析诊断（section 23）：只读、确定性，不改变查询行为。
 * 回答「用户说的『薄抹灰』到底被解析成了什么」——resolvedName / familyIds / systemIds / matchType。
 */
export interface SystemEntityResolution {
  rawText: string;
  matchType: EntityMatchStrength | "NONE";
  resolvedName?: string;
  family: string;
  /** FAMILY 命中对应的同族 systemIds 集合 */
  familyIds: string[];
  systemId?: string;
  systemIds?: string[];
}

export function describeSystemEntityResolution(message: string, entities: QueryEntity[]): SystemEntityResolution {
  const text = normalizeEntityText(message);
  const systemEntities = entities.filter(entity => entity.field === "systemId");
  const exact = systemEntities.flatMap(entity => entity.names.map(name => ({ entity, name: normalizeEntityText(name) })))
    .filter(hit => text.includes(hit.name)).sort((a, b) => b.name.length - a.name.length)[0]?.entity;
  if (exact) return { rawText: message, matchType: "EXACT", resolvedName: exact.names[0], family: normalizeSystemFamily(exact.names[0] ?? ""), familyIds: [], systemId: exact.value };
  // 族名来自正式体系名称的确定性派生，直接从目录里比对（不猜测自由文本）。
  const familyIds = [...new Set(systemEntities
    .filter(entity => {
      const family = entity.family ?? normalizeSystemFamily(entity.names[0] ?? "");
      return family.length >= 2 && text.includes(family);
    })
    .map(entity => entity.value))];
  if (familyIds.length) {
    const family = systemEntities.find(entity => entity.value === familyIds[0]!)?.family
      ?? normalizeSystemFamily(systemEntities.find(entity => entity.value === familyIds[0]!)?.names[0] ?? "");
    return { rawText: message, matchType: "FAMILY", resolvedName: family, family, familyIds };
  }
  // 退化：从自由文本抽取疑似族名（仅用于诊断展示，不作为匹配依据）。
  const guessed = normalizeSystemFamilyFromText(message);
  return { rawText: message, matchType: "NONE", family: guessed, familyIds: [] };
}

/** 从自由文本提取可能的体系族名（去掉型号前缀与通用后缀）。 */
function normalizeSystemFamilyFromText(message: string): string {
  const text = normalizeEntityText(message);
  const match = /(?:i{1,3}|[123一二三])型?[\u4e00-\u9fa5]{2,8}?(?:外保温|保温|系统|体系)/.exec(text)
    ?? /([\u4e00-\u9fa5]{2,6})(?:保温|系统|体系)/.exec(text);
  return match ? normalizeSystemFamily(match[0]!) : "";
}

/**
 * 名称来自正式业务数据，别名来自启用词典；族名/类别来自正式体系名称的确定性派生。
 * 没有任何具体体系或数值特判。
 */
export function resolveQueryEntities(message: string, query: ThermalQueryState, entities: QueryEntity[], aliases: QueryAlias[] = [], previous?: ThermalQueryState): ThermalQueryState {
  const text = normalizeEntityText(message);
  const next: ThermalQueryState = { ...query, preferences: { ...previous?.preferences, ...query.preferences }, exclusions: query.exclusions ?? previous?.exclusions, unresolved: [...(query.unresolved ?? previous?.unresolved ?? [])], removedFields: [...(query.removedFields ?? previous?.removedFields ?? [])] };
  const hits: EntityHit[] = entities.flatMap(entity => {
    const names: Array<{ name: string; strength: EntityMatchStrength }> = entity.names.map(name => ({ name, strength: "EXACT" as const }));
    if (entity.field === "systemId") {
      // 正式名称去掉型号前缀后的族片段（如「薄抹灰」）只能作为族提示，不能当成唯一记录。
      for (const name of entity.names) {
        const family = normalizeSystemFamily(name);
        if (family.length >= 2) names.push({ name: family, strength: "FAMILY" });
      }
      if (entity.family && entity.family.length >= 2) names.push({ name: entity.family, strength: "FAMILY" });
      if (entity.category && entity.category.length >= 2) names.push({ name: entity.category, strength: "CATEGORY" });
    }
    for (const alias of aliases) {
      if (entity.names.some(name => normalizeEntityText(name) === normalizeEntityText(alias.term))) names.push({ name: alias.alias, strength: "ALIAS" });
      else if (entity.field === "systemId" && entity.names.some(name => normalizeSystemFamily(name) === normalizeEntityText(alias.term)))
        names.push({ name: alias.alias, strength: "FAMILY" });
    }
    return names.flatMap(({ name, strength }) => {
      const normalized = normalizeEntityText(name);
      const index = normalized.length >= 2 ? text.indexOf(normalized) : -1;
      if (index < 0) return [];
      const prefix = text.slice(0, index).split(/[,，;；。]/).at(-1) ?? "";
      return [{ entity, name, index, length: normalized.length, strength, operation: classifyOperation(prefix) }];
    });
  });
  // 较长实体名称覆盖同一片段内嵌的短名称，防止规格名中的型号/产品被误当独立条件。
  const selected = hits.filter(hit => !hits.some(other => other.length > hit.length && other.index <= hit.index && other.index + other.length >= hit.index + hit.length));
  const clearedDependencies = new Set<string>();
  let systemTouched = false;
  for (const field of entityFields) {
    const own = selected.filter(hit => hit.entity.field === field);
    if (!own.length) {
      if (next.removedFields?.includes(field)) { Object.assign(next, { [field]: undefined }); continue; }
      if (!clearedDependencies.has(field) && previous?.[field] !== undefined) Object.assign(next, { [field]: previous[field] });
      continue;
    }
    next.unresolved = next.unresolved?.filter(item => item.field !== field);
    if (field === "systemId") systemTouched = true;
    // 族/类别命中（无任何精确名称命中）解析为 systemIds 集合硬约束，而不是要求唯一 ID。
    const exactOwn = own.filter(hit => hit.strength === "EXACT" || hit.strength === "ALIAS" || hit.strength === "TEXT_HINT");
    if (field === "systemId" && exactOwn.length === 0) {
      const ids = [...new Set(own.filter(hit => hit.operation === "UPDATE").map(hit => hit.entity.value))];
      if (ids.length) {
        next.removedFields = next.removedFields?.filter(item => item !== field);
        next.systemId = ids.length === 1 ? ids[0] : undefined;
        next.systemIds = ids.length > 1 ? ids : undefined;
        next.systemHint = undefined;
        next.schemeId = undefined; next.schemeCode = undefined; next.productSpecId = undefined; next.catalogProductId = undefined;
        for (const name of ["systemHint", "schemeId", "schemeCode", "productSpecId", "catalogProductId"]) clearedDependencies.add(name);
      }
      if (own.some(hit => hit.operation === "REMOVE")) next.systemIds = undefined;
      for (const hit of own) applyEntityOperation(next, hit, field, false);
      continue;
    }
    const effective = field === "systemId" ? exactOwn : own;
    const hard = effective.filter(hit => hit.operation === "UPDATE");
    const values = [...new Set(hard.map(hit => hit.entity.value))];
    if (values.length > 1) {
      next.unresolved?.push({ field, reason: "实体名称对应多个正式记录或表达多个互斥条件，请确认具体对象。" });
      continue;
    }
    const clearField = !values.length && previous?.[field] === undefined;
    if (values.length === 1) {
      next.removedFields = next.removedFields?.filter(item => item !== field);
      const value = values[0]!;
      if (field === "systemId" && value !== (previous?.systemId ?? query.systemId)) {
        next.schemeId = undefined; next.schemeCode = undefined; next.productSpecId = undefined; next.catalogProductId = undefined;
        next.systemHint = undefined;
        for (const name of ["systemHint", "schemeId", "schemeCode", "productSpecId", "catalogProductId"]) clearedDependencies.add(name);
      }
      if (field === "schemeId" && value !== (previous?.schemeId ?? query.schemeId)) {
        next.schemeCode = undefined; next.productSpecId = undefined; next.catalogProductId = undefined;
        for (const name of ["schemeCode", "productSpecId", "catalogProductId"]) clearedDependencies.add(name);
      }
      if (field === "productSpecId" && value !== (previous?.productSpecId ?? query.productSpecId)) {
        next.catalogProductId = undefined; next.specClass = undefined;
        clearedDependencies.add("catalogProductId"); clearedDependencies.add("specClass");
      }
      if (field === "catalogProductId" && value !== (previous?.catalogProductId ?? query.catalogProductId)) {
        next.productSpecId = undefined; clearedDependencies.add("productSpecId");
      }
      Object.assign(next, { [field]: value });
      if (field === "systemId") { next.systemHint = undefined; next.systemIds = undefined; }
    }
    for (const hit of own) applyEntityOperation(next, hit, field, clearField);
  }
  // 族约束的继承与清除：本轮未触碰体系时沿用历史 systemIds。
  if (!systemTouched) {
    if (next.removedFields?.includes("systemId")) next.systemIds = undefined;
    else if (!next.systemId && !next.systemIds && previous?.systemIds) next.systemIds = previous.systemIds;
  }
  if (next.systemId) { next.systemHint = undefined; next.systemIds = undefined; }
  const removalNames: Partial<Record<typeof entityFields[number], string>> = {
    systemId: "体系|系统", schemeId: "方案|构造", productSpecId: "产品规格|规格", catalogProductId: "产品目录|产品", specClass: "型号|规格分类",
    substrateMaterial: "基层材料|基层", regionCode: "地区", standardLimitId: "标准", buildingType: "建筑类型", structureType: "结构类型"
  };
  for (const [field, name] of Object.entries(removalNames)) {
    if (new RegExp(`(?:取消|不限制|先不看|去掉)(?:${name})(?:条件|限制)?|(?:${name})(?:不限|不限制)`).test(text)) {
      Object.assign(next, { [field]: undefined });
      next.removedFields = [...(next.removedFields ?? []).filter(item => item !== field), field as typeof entityFields[number]];
      if (field === "systemId") { next.systemHint = undefined; next.systemIds = undefined; }
      if (field === "schemeId") next.schemeCode = undefined;
      next.unresolved = next.unresolved?.filter(item => item.field !== field);
    }
  }
  // 显式标注但不在正式名称/别名目录的实体保持歧义，不能用模型猜测替代。
  for (const [field, names] of Object.entries(removalNames)) {
    const explicit = new RegExp(`(?:${names})(?:为|是|[:：=])([^,，;；。\\n]+)`).exec(text);
    if (explicit && !selected.some(hit => hit.entity.field === field) && !/取消|不限制|不限/.test(explicit[1]!)) {
      Object.assign(next, { [field]: previous?.[field as typeof entityFields[number]] });
      next.unresolved = [...(next.unresolved ?? []).filter(item => item.field !== field), { field, reason: "指定实体尚未匹配到唯一正式名称或配置别名，请确认具体对象。" }];
    }
  }
  if (next.systemId) { next.systemHint = undefined; next.systemIds = undefined; }
  // 通用偏好语言只排序，不生成数值边界。
  const lowerK = /(?:K(?:值)?|传热系数)(?:低一点(?:更好)?|越低越好)/i.exec(text);
  const higherR = /(?:产品层?热阻|板自身R|产品R|总热阻|整墙热阻|总R|热阻)(?:高一点(?:更好)?|越高越好)/i.exec(text);
  const cancelled = (index: number) => /取消|去掉|不再/.test(text.slice(0, index).split(/[,，;；。]/).at(-1) ?? "");
  if (lowerK) next.preferences!.preferLowerK = !cancelled(lowerK.index);
  if (higherR) {
    next.preferences!.preferHigherR = !cancelled(higherR.index);
    next.preferences!.higherRMetric = /产品|板自身/i.test(higherR[0]) ? "PRODUCT_R" : "TOTAL_R";
  }
  if (/尽量厚|厚一点|越厚越好/.test(text)) next.preferences!.preferThicker = true;
  return next;
}

function applyEntityOperation(next: ThermalQueryState, hit: EntityHit, field: typeof entityFields[number], clearField: boolean) {
  if (hit.operation === "REMOVE_EXCLUSION") next.exclusions = next.exclusions?.filter(item => item.field !== field || item.value !== hit.entity.value);
  if (hit.operation === "REMOVE_PREFERENCE") next.preferences!.entities = next.preferences?.entities?.filter(item => item.field !== field || item.value !== hit.entity.value);
  if (hit.operation === "REMOVE") { Object.assign(next, { [field]: undefined }); next.removedFields = [...(next.removedFields ?? []).filter(item => item !== field), field]; }
  if (hit.operation === "EXCLUDE") {
    if (clearField) Object.assign(next, { [field]: undefined });
    next.exclusions = [...(next.exclusions ?? []).filter(item => item.field !== field || item.value !== hit.entity.value), { field, value: hit.entity.value }];
  }
  if (hit.operation === "PREFER") {
    if (clearField) Object.assign(next, { [field]: undefined });
    next.preferences!.entities = [...(next.preferences?.entities ?? []).filter(item => item.field !== field), { field, value: hit.entity.value }];
  }
}
