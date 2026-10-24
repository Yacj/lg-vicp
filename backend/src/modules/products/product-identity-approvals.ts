import { normalizeEntityText } from "../thermal/thermal-query-state.js";

/** 用户2026-10-19明确确认的产品简称；仅名称身份，不包含性能/用途或系列成员事实。 */
const approvals = [{ canonicalName: "VICP复合保温板", alias: "VICP", approval: "USER_CONFIRMED_2026_10_19" }] as const;

export function approvedCatalogAliases(products: readonly { name: string }[]) {
  return approvals.flatMap(item => {
    const matches = products.filter(product => normalizeEntityText(product.name) === normalizeEntityText(item.canonicalName));
    return matches.length === 1 ? [{ term: matches[0]!.name, alias: item.alias }] : [];
  });
}

function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + Number(a[i - 1] !== b[j - 1]));
    previous = current;
  }
  return previous[b.length]!;
}

/** 仅在产品身份未命中后给名称建议，建议不赋予产品身份、不读取该产品事实。 */
export function suggestCatalogNames(text: string, products: readonly { name: string }[], aliases: readonly { term: string; alias: string }[]) {
  const target = normalizeEntityText(text);
  if (target.length < 3 || target.length > 64) return [];
  return products.flatMap(product => {
    const names = [product.name, ...aliases.filter(item => normalizeEntityText(item.term) === normalizeEntityText(product.name)).map(item => item.alias)];
    const close = names.find(name => {
      const candidate = normalizeEntityText(name);
      return Math.abs(candidate.length - target.length) <= 1 && editDistance(target, candidate) === 1;
    });
    return close ? [{ name: product.name, matchedName: close }] : [];
  }).slice(0, 3);
}
