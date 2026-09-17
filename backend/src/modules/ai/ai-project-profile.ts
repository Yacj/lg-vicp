/**
 * 项目档案（非长期记忆）：仅结构化项目字段，供 Context Builder 与 get_project_context 共用。
 */
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { projects } from "../../db/schema.js";

export async function resolveProjectContext(app: FastifyInstance, projectId: string | null): Promise<string | null> {
  if (!projectId) {
    return null;
  }
  const [project] = await app.db.select().from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt))).limit(1);
  if (!project) return null;
  return [
    `项目名称：${project.name}`,
    project.description ? `项目描述：${project.description}` : null,
    project.region ? `所在地区：${project.region}` : null,
    project.buildingType ? `建筑类型：${project.buildingType}` : null
  ].filter(Boolean).join("\n");
}
