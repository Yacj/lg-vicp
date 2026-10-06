/**
 * 项目档案（非长期记忆）：仅结构化项目字段，供 Context Builder 与 get_project_state 共用。
 */
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { projects } from "../../db/schema.js";

export type ProjectProfile = {
  projectId: string;
  name: string;
  description: string | null;
  region: string | null;
  buildingType: string | null;
};

export async function loadProjectProfile(app: FastifyInstance, projectId: string | null): Promise<ProjectProfile | null> {
  if (!projectId) return null;
  const [project] = await app.db.select().from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt))).limit(1);
  if (!project) return null;
  return {
    projectId: project.id,
    name: project.name,
    description: project.description,
    region: project.region,
    buildingType: project.buildingType
  };
}

export async function resolveProjectContext(app: FastifyInstance, projectId: string | null): Promise<string | null> {
  const profile = await loadProjectProfile(app, projectId);
  if (!profile) return null;
  return [
    `项目名称：${profile.name}`,
    profile.description ? `项目描述：${profile.description}` : null,
    profile.region ? `所在地区：${profile.region}` : null,
    profile.buildingType ? `建筑类型：${profile.buildingType}` : null
  ].filter(Boolean).join("\n");
}
