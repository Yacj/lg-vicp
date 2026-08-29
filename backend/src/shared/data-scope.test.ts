import { describe, expect, it } from "vitest";
import { resolveDataScope, scopeIncludesChannel } from "./data-scope.js";

/**
 * 渠道数据范围解析测试（P1-2 预留）：
 * 本轮只定义解析口径，不改变任何现有查询语义。
 */

describe("resolveDataScope", () => {
  it("SUPER_ADMIN 永远 ALL", () => {
    expect(resolveDataScope({ role: "SUPER_ADMIN", dataScope: "SELF" })).toBe("ALL");
    expect(resolveDataScope({ role: "SUPER_ADMIN", dataScope: null })).toBe("ALL");
  });

  it("显式配置渠道范围时原样解析", () => {
    expect(resolveDataScope({ role: "CHANNEL_USER", dataScope: "CHANNEL" })).toBe("CHANNEL");
    expect(resolveDataScope({ role: "CHANNEL_USER", dataScope: "CHANNEL_AND_CHILDREN" })).toBe("CHANNEL_AND_CHILDREN");
  });

  it("旧部门值与未配置时收敛为 SELF（默认语义最窄）", () => {
    expect(resolveDataScope({ role: "CHANNEL_USER", dataScope: "DEPT" })).toBe("SELF");
    expect(resolveDataScope({ role: "CHANNEL_USER", dataScope: "DEPT_AND_CHILDREN" })).toBe("SELF");
    expect(resolveDataScope({ role: "CHANNEL_USER", dataScope: null })).toBe("SELF");
  });

  it("PROJECT_OWNER / CUSTOM / ALL 原样解析", () => {
    expect(resolveDataScope({ role: "NORMAL_USER", dataScope: "PROJECT_OWNER" })).toBe("PROJECT_OWNER");
    expect(resolveDataScope({ role: "NORMAL_USER", dataScope: "CUSTOM" })).toBe("CUSTOM");
    expect(resolveDataScope({ role: "NORMAL_USER", dataScope: "ALL" })).toBe("ALL");
  });
});

describe("scopeIncludesChannel", () => {
  const actor = { channelId: "channel-1" };

  it("ALL 放行任意渠道", () => {
    expect(scopeIncludesChannel("ALL", actor, "channel-9")).toBe(true);
  });

  it("CHANNEL 仅放行本人所属渠道", () => {
    expect(scopeIncludesChannel("CHANNEL", actor, "channel-1")).toBe(true);
    expect(scopeIncludesChannel("CHANNEL", actor, "channel-2")).toBe(false);
  });

  it("CHANNEL_AND_CHILDREN 放行所属渠道与子渠道（按祖先链）", () => {
    expect(scopeIncludesChannel("CHANNEL_AND_CHILDREN", actor, "channel-1")).toBe(true);
    expect(scopeIncludesChannel("CHANNEL_AND_CHILDREN", actor, "channel-2", ["channel-1"])).toBe(true);
    expect(scopeIncludesChannel("CHANNEL_AND_CHILDREN", actor, "channel-3", ["channel-2"])).toBe(false);
  });

  it("SELF / PROJECT_OWNER / CUSTOM 不按渠道放行", () => {
    for (const scope of ["SELF", "PROJECT_OWNER", "CUSTOM"] as const) {
      expect(scopeIncludesChannel(scope, actor, "channel-1")).toBe(false);
    }
  });

  it("目标无渠道归属时仅 ALL 放行", () => {
    expect(scopeIncludesChannel("ALL", actor, null)).toBe(true);
    expect(scopeIncludesChannel("CHANNEL", actor, null)).toBe(false);
  });
});
