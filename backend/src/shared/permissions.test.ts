import { describe, expect, it } from "vitest";
import type { AuthUser } from "./auth-user.js";
import { PROJECT_VISIBILITY, USER_ROLES } from "./constants.js";
import { canCreateProject, canManageProject, canViewProject } from "./permissions.js";

const superAdmin: AuthUser = {
  id: "admin-1",
  role: USER_ROLES.SUPER_ADMIN,
  channelType: null,
  clientType: "B_ADMIN"
};

const channelUser: AuthUser = {
  id: "channel-1",
  role: USER_ROLES.CHANNEL_USER,
  channelType: "DEALER",
  clientType: "B_ADMIN"
};

const normalUser: AuthUser = {
  id: "normal-1",
  role: USER_ROLES.NORMAL_USER,
  channelType: null,
  clientType: "C_APP"
};

describe("project permissions", () => {
  it("allows channel users and super admin to create projects", () => {
    expect(canCreateProject(channelUser)).toBe(true);
    expect(canCreateProject(superAdmin)).toBe(true);
    expect(canCreateProject(normalUser)).toBe(false);
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
