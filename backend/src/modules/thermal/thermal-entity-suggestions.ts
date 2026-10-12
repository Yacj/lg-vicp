import { normalizeEntityText, type ThermalQueryState } from "./thermal-query-state.js";
import type { QueryAlias, QueryEntity } from "./thermal-entity-resolver.js";

function grams(text: string): Set<string> {
  const normalized = normalizeEntityText(text);
  return new Set(Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2)));
}

/** Fuzzy只产出候选目录；不得把相似度直接升级为正式ID硬约束。 */
export function suggestQueryEntities(message: string, entities: QueryEntity[], aliases: QueryAlias[], previous?: ThermalQueryState, limit = 80): QueryEntity[] {
  const text = normalizeEntityText(message), tokens = grams(message);
  const score = (entity: QueryEntity) => Math.max(...[...entity.names, entity.family, entity.category,
    ...aliases.filter(alias => entity.names.some(name => normalizeEntityText(name) === normalizeEntityText(alias.term)) || normalizeEntityText(entity.family ?? "") === normalizeEntityText(alias.term)).map(alias => alias.alias)]
    .filter((name): name is string => Boolean(name)).map(name => {
      const normalized = normalizeEntityText(name);
      if (text.includes(normalized)) return 2 + normalized.length / 1000;
      const candidate = grams(name), overlap = [...candidate].filter(token => tokens.has(token)).length;
      return overlap / Math.max(1, candidate.size + tokens.size - overlap);
    }));
  const ranked = entities.map(entity => ({ entity, score: score(entity) })).sort((a, b) => b.score - a.score);
  const relevant = ranked.filter(item => item.score >= 2 || item.entity.value === previous?.[item.entity.field] || previous?.systemIds?.includes(item.entity.value));
  const shortlist = [...relevant, ...ranked.slice(0, limit)];
  return [...new Map(shortlist.map(item => [`${item.entity.field}:${item.entity.value}`, item.entity])).values()];
}
