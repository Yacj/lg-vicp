/** 数据范围解析。渠道账号类型保留，但不再拥有独立的渠道层级数据范围。 */
export type ResolvedDataScope =
  | "ALL"
  | "DEPT"
  | "DEPT_AND_CHILDREN"
  | "PROJECT_OWNER"
  | "SELF"
  | "CUSTOM";

export interface DataScopeActor {
  role: string;
  dataScope?: string | null;
}

export function resolveDataScope(actor: DataScopeActor): ResolvedDataScope {
  if (actor.role === "SUPER_ADMIN") return "ALL";
  switch (actor.dataScope) {
    case "ALL": return "ALL";
    case "PROJECT_OWNER": return "PROJECT_OWNER";
    case "CUSTOM": return "CUSTOM";
    case "DEPT": return "DEPT";
    case "DEPT_AND_CHILDREN": return "DEPT_AND_CHILDREN";
    case "SELF":
    default: return "SELF";
  }
}
