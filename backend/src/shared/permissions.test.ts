import { describe, expect, it } from "vitest";
import type { AuthUser } from "./auth-user.js";
import { AUTH_CLIENTS, PROJECT_VISIBILITY, USER_ROLES } from "./constants.js";
import { canCreateProjectFromClient, canManageProject, canViewProject } from "./permissions.js";

const superAdmin: AuthUser = {
  id: "admin-1",
  role: USER_ROLES.SUPER_ADMIN,
  channelType: null,
  clientType: AUTH_CLIENTS.B_ADMIN
};

const channelUser: AuthUser = {
  id: "channel-1",
  role: USER_ROLES.CHANNEL_USER,
  channelType: "DEALER",
  clientType: AUTH_CLIENTS.B_ADMIN
};

const normalUser: AuthUser = {
  id: "normal-1",
  role: USER_ROLES.NORMAL_USER,
  channelType: null,
  clientType: AUTH_CLIENTS.C_APP
};

const channelCAppUser: AuthUser = {
  ...channelUser,
  clientType: AUTH_CLIENTS.C_APP
};

const channelPcAiUser: AuthUser = {
  ...channelUser,
  clientType: AUTH_CLIENTS.PC_AI
};

describe("project permissions", () => {
  it("allows project creation for configured clients and keeps normal users closed", () => {
    expect(canCreateProjectFromClient(superAdmin)).toBe(true);
    expect(canCreateProjectFromClient(channelUser)).toBe(true);
    expect(canCreateProjectFromClient(channelCAppUser)).toBe(true);
    expect(canCreateProjectFromClient(channelPcAiUser)).toBe(true);
    expect(canCreateProjectFromClient(normalUser)).toBe(false);
  });

  it("allows private projects only for creator and super admin", () => {
    const privateProject = {
      createdById: channelUser.id,
      visibility: PROJECT_VISIBILITY.PRIVATE
    };

    expect(canViewProject(channelUser, privateProject)).toBe(true);
    expect(canViewProject(superAdmin, privateProject)).toBe(true);
    expect(canViewProject(normalUser, privateProject)).toBe(false);
  });

  it("allows authenticated users to read public projects but not manage them", () => {
    const publicProject = {
      createdById: channelUser.id,
      visibility: PROJECT_VISIBILITY.PUBLIC
    };

    expect(canViewProject(normalUser, publicProject)).toBe(true);
    expect(canManageProject(normalUser, publicProject)).toBe(false);
    expect(canManageProject(channelUser, publicProject)).toBe(true);
  });
});
