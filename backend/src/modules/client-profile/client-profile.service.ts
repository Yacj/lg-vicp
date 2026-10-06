import { and, count, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { aiConversations, departments, projects } from "../../db/schema.js";
import { CLIENT_APPS, PROJECT_VISIBILITY } from "../../shared/constants.js";
import { buildDepartmentAncestorMap, departmentPathName } from "../../shared/department-tree.js";
import type { AuthUser } from "../../shared/auth-user.js";

export type ClientProfileSummary = {
  projects: {
    total: number;
    public: number;
  };
  conversations: {
    total: number;
  };
};

export type ClientSelectableDepartment = {
  id: string;
  name: string;
  pathName: string;
  hasChildren: boolean;
};

export async function getClientProfileSummary(input: {
  db: DbExecutor;
  userId: string;
}): Promise<ClientProfileSummary> {
  const ownedProjects = and(
    eq(projects.createdById, input.userId),
    isNull(projects.deletedAt)
  );
  const publicProjects = and(
    ownedProjects,
    eq(projects.visibility, PROJECT_VISIBILITY.PUBLIC)
  );
  const clientConversations = and(
    eq(aiConversations.userId, input.userId),
    eq(aiConversations.clientApp, CLIENT_APPS.C_APP),
    isNull(aiConversations.deletedAt)
  );

  const [[projectTotalRow], [publicProjectTotalRow], [conversationTotalRow]] = await Promise.all([
    input.db.select({ value: count() }).from(projects).where(ownedProjects),
    input.db.select({ value: count() }).from(projects).where(publicProjects),
    input.db.select({ value: count() }).from(aiConversations).where(clientConversations)
  ]);

  return {
    projects: {
      total: projectTotalRow?.value ?? 0,
      public: publicProjectTotalRow?.value ?? 0
    },
    conversations: {
      total: conversationTotalRow?.value ?? 0
    }
  };
}

/** 仅返回当前用户所属、可用于项目 DEPARTMENT 可见范围的部门，不暴露整棵组织树。 */
export async function listClientSelectableDepartments(input: {
  db: DbExecutor;
  user: Pick<AuthUser, "departmentIds">;
}): Promise<ClientSelectableDepartment[]> {
  const userDepartmentIds = [...new Set(input.user.departmentIds ?? [])];
  if (userDepartmentIds.length === 0) return [];

  const rows = await input.db.select({
    id: departments.id,
    parentId: departments.parentId,
    name: departments.name
  }).from(departments).where(isNull(departments.deletedAt));

  const byId = new Map(rows.map((row) => [row.id, row]));
  const ancestorMap = buildDepartmentAncestorMap(rows);
  const childIds = new Set(rows.map((row) => row.parentId).filter((id): id is string => Boolean(id)));

  return userDepartmentIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [{
      id: row.id,
      name: row.name,
      pathName: departmentPathName(row.id, byId, ancestorMap),
      hasChildren: childIds.has(row.id)
    }];
  });
}