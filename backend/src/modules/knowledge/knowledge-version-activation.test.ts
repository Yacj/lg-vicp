import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

import fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { AuthUser } from "../../shared/auth-user.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { knowledgeRoutes } from "./knowledge.routes.js";
import { createMemoryDb, type MemoryStore } from "./knowledge-test-memory-db.js";

const docId = "00000000-0000-4000-8000-000000000010";
const versionId = "00000000-0000-4000-8000-000000000011";
const otherId = "00000000-0000-4000-8000-000000000012";
const actor: AuthUser = {
  id: "00000000-0000-4000-8000-000000000001", role: "SUPER_ADMIN", clientType: "B_ADMIN",
  channelType: null, adminLoginEnabled: true,
};

function fixture(): MemoryStore {
  return {
    knowledgeDocuments: [{ id: docId, title: "协议验收资料", docType: "OTHER", currentVersionId: null, deletedAt: null }],
    knowledgeDocumentVersions: [{
      id: versionId, documentId: docId, version: 3, title: "协议验收资料", status: "DISABLED",
      usageMode: "BROWSE_ONLY", parseStatus: "PENDING", pipelineStatus: "PUBLISHED", fileId: null,
      approvedAt: new Date("2026-01-01"), approvedById: actor.id, publishedAt: new Date("2026-01-02"),
    }],
    knowledgePages: [{
      id: "00000000-0000-4000-8000-000000000013", documentId: docId, versionId,
      pageNumber: 1, physicalPageNumber: 1, pageLabel: "A1", pageLabelSource: "MANUAL", pageLabelVerified: true,
      pageImageObjectKey: "protocol-fixture/page.png", parsedText: "协议资料正文", hasText: false,
      metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED" },
    }],
    knowledgeChunks: [], auditLogs: [],
  };
}

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

async function testApi(store = fixture(), user = actor) {
  const app = fastify({ logger: false });
  apps.push(app);
  const { db } = createMemoryDb(store);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("db", db as unknown as FastifyInstance["db"]);
  app.decorate("storage", { createDownloadUrl: async () => "https://example.test/page.png" } as FastifyInstance["storage"]);
  app.decorateRequest("currentUser", null);
  app.decorate("authenticate", async (request: Parameters<FastifyInstance["authenticate"]>[0]) => {
    request.currentUser = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(knowledgeRoutes, { prefix: "/api/v1/platform/knowledge" });
  await app.ready();
  return { app, store };
}

const enableUrl = `/api/v1/platform/knowledge/versions/${versionId}/enable`;

describe("知识版本重新启用 HTTP 协议与状态闭环", () => {
  it("恢复原版本，再停用与启用，保留版本号、审核和原文", async () => {
    const { app, store } = await testApi();
    const originalPages = structuredClone(store.knowledgePages);
    const originalApproval = store.knowledgeDocumentVersions![0]!.approvedAt;
    const first = (await app.inject({ method: "POST", url: enableUrl })).json();
    expect(first).toMatchObject({ success: true, data: { version: { id: versionId, version: 3, status: "PUBLISHED" } } });
    expect(store.knowledgeDocuments![0]!.currentVersionId).toBe(versionId);
    expect(store.knowledgeDocumentVersions).toHaveLength(1);
    expect(store.knowledgeDocumentVersions![0]!.approvedAt).toEqual(originalApproval);
    expect(store.knowledgePages).toEqual(originalPages);
    const stopped = (await app.inject({ method: "POST", url: enableUrl.replace("/enable", "/disable") })).json();
    expect(stopped.success).toBe(true);
    expect(store.knowledgeDocuments![0]!.currentVersionId).toBeNull();
    expect(store.knowledgePages).toEqual(originalPages);
    const second = (await app.inject({ method: "POST", url: enableUrl })).json();
    expect(second.data.version.id).toBe(versionId);
    expect(store.auditLogs?.map(row => row.action)).toEqual([
      "knowledge.version_enabled", "knowledge.version_disabled", "knowledge.version_enabled",
    ]);
  });

  it.each(["DRAFT", "APPROVED", "PUBLISHED"])("拒绝从 %s 绕过审核或重复启用", async status => {
    const store = fixture();
    store.knowledgeDocumentVersions![0]!.status = status;
    const { app } = await testApi(store);
    const result = (await app.inject({ method: "POST", url: enableUrl })).json();
    expect(result).toMatchObject({ success: false, error: { details: { errorCode: "KNOWLEDGE_VERSION_NOT_DISABLED" } } });
    expect(store.auditLogs).toHaveLength(0);
  });

  it("重新执行发布门禁，空版本不能启用", async () => {
    const store = fixture();
    store.knowledgePages = [];
    const { app } = await testApi(store);
    const result = (await app.inject({ method: "POST", url: enableUrl })).json();
    expect(result).toMatchObject({ success: false, error: { details: { errorCode: "KNOWLEDGE_VERSION_EMPTY" } } });
    expect(store.knowledgeDocumentVersions![0]!.status).toBe("DISABLED");
    expect(store.auditLogs).toHaveLength(0);
  });

  it("拒绝覆盖其他发布版本且事务不写入审计", async () => {
    const store = fixture();
    store.knowledgeDocumentVersions!.push({ ...store.knowledgeDocumentVersions![0], id: otherId, version: 4, status: "PUBLISHED" });
    store.knowledgeDocuments![0]!.currentVersionId = otherId;
    const { app } = await testApi(store);
    const result = (await app.inject({ method: "POST", url: enableUrl })).json();
    expect(result).toMatchObject({ success: false, error: { details: { errorCode: "KNOWLEDGE_PUBLISHED_VERSION_CONFLICT" } } });
    expect(store.knowledgeDocuments![0]!.currentVersionId).toBe(otherId);
    expect(store.knowledgeDocumentVersions![0]!.status).toBe("DISABLED");
    expect(store.auditLogs).toHaveLength(0);
  });

  it("AI 版本的未确认页面仍会阻止重新启用", async () => {
    const store = fixture();
    store.knowledgeDocumentVersions![0]!.usageMode = "AI_ENABLED";
    store.knowledgePages![0]!.metadata = { uploadSource: "ZIP", recognitionStatus: "REVIEW_REQUIRED" };
    const { app } = await testApi(store);
    const result = (await app.inject({ method: "POST", url: enableUrl })).json();
    expect(result).toMatchObject({ success: false, error: { details: { errorCode: "KNOWLEDGE_VERSION_PAGES_UNCONFIRMED" } } });
    expect(store.knowledgeDocumentVersions![0]!.status).toBe("DISABLED");
    expect(store.auditLogs).toHaveLength(0);
  });

  it.each(["C_APP", "PC_AI"] as const)("拒绝 %s 客户端调用后台启用接口", async clientType => {
    const { app, store } = await testApi(fixture(), { ...actor, clientType });
    const result = (await app.inject({ method: "POST", url: enableUrl })).json();
    expect(result).toMatchObject({ success: false, error: { code: 403 } });
    expect(store.knowledgeDocumentVersions![0]!.status).toBe("DISABLED");
  });

  it("有其他知识库权限但无发布权限时拒绝启用", async () => {
    const { app } = await testApi(fixture(), { ...actor, role: "NORMAL_USER", permissionCodes: ["system:knowledge:doc:edit"] });
    expect((await app.inject({ method: "POST", url: enableUrl })).json()).toMatchObject({ success: false, error: { code: 403 } });
  });
});
