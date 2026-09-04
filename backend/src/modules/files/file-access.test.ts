import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth-user.js";
import { canAccessSourceFile, canDeleteProjectFile, canReadProjectFile } from "./file-access.js";

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

  it("项目资料删除仅允许项目创建者和超级管理员", () => {
    const file = { ownerUserId: owner.id, projectId: "project-1" };
    const project = { id: "project-1", createdById: owner.id, visibility: "PRIVATE" as const };
    const formerMember: AuthUser = { ...other, clientType: "B_ADMIN" };

    expect(canReadProjectFile({ ...other, clientType: "B_ADMIN" }, file, { ...project, visibility: "PUBLIC" })).toBe(true);
    expect(canReadProjectFile(formerMember, file, project)).toBe(false);
    expect(canDeleteProjectFile(owner, file, project)).toBe(true);
    expect(canDeleteProjectFile(admin, file, project)).toBe(true);
    expect(canDeleteProjectFile(formerMember, file, project)).toBe(false);
  });
});
