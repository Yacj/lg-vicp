export type DepartmentNode = {
  id: string;
  parentId: string | null;
};

export type DepartmentNameNode = DepartmentNode & {
  name: string;
};

/** 部门 → 祖先 ID 列表（近到远，不含自身）。遇到环时截断。 */
export function buildDepartmentAncestorMap(rows: readonly DepartmentNode[]): Map<string, string[]> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const cache = new Map<string, string[]>();

  function ancestors(id: string, visiting = new Set<string>()): string[] {
    const cached = cache.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return [];
    visiting.add(id);
    const row = byId.get(id);
    if (!row?.parentId || !byId.has(row.parentId)) {
      cache.set(id, []);
      return [];
    }
    const result = [row.parentId, ...ancestors(row.parentId, visiting)];
    cache.set(id, result);
    return result;
  }

  for (const row of rows) ancestors(row.id);
  return cache;
}

/** 用户所属部门 + 这些部门的全部祖先，用于 DEPARTMENT + includeChildDepartments 判定。 */
export function departmentScopeIds(
  userDepartmentIds: readonly string[],
  ancestorMap: Map<string, string[]>
): string[] {
  const set = new Set(userDepartmentIds);
  for (const id of userDepartmentIds) {
    for (const ancestor of ancestorMap.get(id) ?? []) set.add(ancestor);
  }
  return [...set];
}

export function departmentPathName(
  id: string,
  byId: Map<string, DepartmentNameNode>,
  ancestorMap: Map<string, string[]>
): string {
  const ancestorNames = [...(ancestorMap.get(id) ?? [])]
    .reverse()
    .map((ancestorId) => byId.get(ancestorId)?.name)
    .filter((name): name is string => Boolean(name));
  const self = byId.get(id)?.name;
  return [...ancestorNames, self].filter((name): name is string => Boolean(name)).join(" / ");
}

export function isDepartmentVisibleToUser(input: {
  visibleDepartmentId: string | null | undefined;
  includeChildDepartments: boolean;
  userDepartmentIds: readonly string[];
  userDepartmentScopeIds: readonly string[];
}): boolean {
  if (!input.visibleDepartmentId) return false;
  if (!input.includeChildDepartments) {
    return input.userDepartmentIds.includes(input.visibleDepartmentId);
  }
  return input.userDepartmentScopeIds.includes(input.visibleDepartmentId);
}
