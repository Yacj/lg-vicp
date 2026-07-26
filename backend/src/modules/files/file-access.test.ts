import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth-user.js";
import { canAccessSourceFile } from "./file-access.js";

const owner: AuthUser = { id: "owner", role: "CHANNEL_USER", channelType: "DEALER", clientType: "B_ADMIN" };
const other: AuthUser = { id: "other", role: "NORMAL_USER", channelType: null, clientType: "C_APP" };
const admin: AuthUser = { id: "admin", role: "SUPER_ADMIN", channelType: null, clientType: "B_ADMIN" };

describe("源文件权限", () => {
  it("只允许文件所有者和超级管理员访问", () => {
    const file = { ownerUserId: owner.id };
    expect(canAccessSourceFile(owner, file)).toBe(true);
    expect(canAccessSourceFile(admin, file)).toBe(true);
    expect(canAccessSourceFile(other, file)).toBe(false);
  });
});
