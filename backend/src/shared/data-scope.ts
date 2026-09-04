/**
 * 数据范围枚举及渠道判断纯函数。
 * SUPER_ADMIN 始终拥有 ALL；DEPT、DEPT_AND_CHILDREN、CHANNEL 及
 * CHANNEL_AND_CHILDREN 的实际对象集合由 project-access 解析后应用到查询。
 */

export type ResolvedDataScope =
  | "ALL"
  | "CHANNEL"
  | "CHANNEL_AND_CHILDREN"
  | "DEPT"
  | "DEPT_AND_CHILDREN"
  | "PROJECT_OWNER"
  | "SELF"
  | "CUSTOM";

export interface DataScopeActor {
  role: string;
  /** 角色/账号配置的数据范围（roles.dataScope） */
  dataScope?: string | null;
  /** 所属渠道账号 id（users.channelId；经销商/业务员未来归属） */
  channelId?: string | null;
}

/** 解析账号的生效数据范围（纯函数，无 IO） */
export function resolveDataScope(actor: DataScopeActor): ResolvedDataScope {
  if (actor.role === "SUPER_ADMIN") return "ALL";
  switch (actor.dataScope) {
    case "ALL": return "ALL";
    case "CHANNEL": return "CHANNEL";
    case "CHANNEL_AND_CHILDREN": return "CHANNEL_AND_CHILDREN";
    case "PROJECT_OWNER": return "PROJECT_OWNER";
    case "CUSTOM": return "CUSTOM";
    case "DEPT": return "DEPT";
    case "DEPT_AND_CHILDREN": return "DEPT_AND_CHILDREN";
    case "SELF":
    default: return "SELF";
  }
}

/**
 * 判断目标渠道数据是否落在账号的数据范围内（纯函数）：
 * - ALL：放行任意渠道；
 * - CHANNEL：仅本人所属渠道；
 * - CHANNEL_AND_CHILDREN：所属渠道及其子渠道（按 parentId 链归届时由调用方传入链路）；
 * - PROJECT_OWNER / SELF / CUSTOM：不按渠道放行。
 */
export function scopeIncludesChannel(
  scope: ResolvedDataScope,
  actor: { channelId?: string | null },
  targetChannelId: string | null | undefined,
  targetAncestorChannelIds: readonly string[] = []
): boolean {
  if (!targetChannelId) return scope === "ALL";
  switch (scope) {
    case "ALL": return true;
    case "CHANNEL": return actor.channelId === targetChannelId;
    case "CHANNEL_AND_CHILDREN":
      return actor.channelId === targetChannelId || targetAncestorChannelIds.includes(actor.channelId ?? "\u0000-none");
    default: return false;
  }
}
