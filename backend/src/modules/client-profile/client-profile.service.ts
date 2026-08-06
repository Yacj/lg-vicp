import { and, count, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { aiConversations, projects } from "../../db/schema.js";
import { CLIENT_APPS, PROJECT_VISIBILITY } from "../../shared/constants.js";

export type ClientProfileSummary = {
  projects: {
    total: number;
    public: number;
  };
  conversations: {
    total: number;
  };
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