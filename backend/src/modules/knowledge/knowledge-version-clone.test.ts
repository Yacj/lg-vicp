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
const sourceVersionId = "00000000-0000-4000-8000-000000000011";
const pageId = "00000000-0000-4000-8000-000000000020";
const sectionId = "00000000-0000-4000-8000-000000000030";
const tocId = "00000000-0000-4000-8000-000000000040";
const fileId = "00000000-0000-4000-8000-000000000050";
const assetId = "00000000-0000-4000-8000-000000000060";
const mappingId = "00000000-0000-4000-8000-000000000070";

const actor: AuthUser = {
  id: "00000000-0000-4000-8000-000000000001", role: "SUPER_ADMIN", clientType: "B_ADMIN",
  channelType: null, adminLoginEnabled: true,
};

function fixture(): MemoryStore {
  return {
    knowledgeDocuments: [{
      id: docId, title: "外墙热工图集", docType: "DETAIL_ATLAS",
      currentVersionId: sourceVersionId, deletedAt: null
    }],
    knowledgeDocumentVersions: [{
      id: sourceVersionId, documentId: docId, version: 3, title: "外墙热工图集", status: "PUBLISHED",
      pipelineStatus: "PUBLISHED", parseStatus: "PARSED", pageCount: 1, parser: "pdf",
      evidenceLevel: "A", usageMode: "AI_ENABLED", fileId,
      indexStatus: "INDEX_READY", indexDirty: false, indexRevision: 1, contentRevision: 1,
      approvedAt: new Date("2026-01-01"), publishedAt: new Date("2026-01-02")
    }],
    knowledgeDocumentAssets: [{
      id: assetId, documentId: docId, versionId: sourceVersionId, fileId, role: "ORIGINAL", isPrimary: true
    }],
    knowledgeSections: [{
      id: sectionId, documentId: docId, versionId: sourceVersionId, parentId: null,
      sectionKey: "1", title: "外墙", level: 1, headingPath: ["外墙"], sortOrder: 0,
      startPage: 1, endPage: 1, searchText: "外墙"
    }],
    knowledgePages: [{
      id: pageId, documentId: docId, versionId: sourceVersionId, sectionId,
      pageNumber: 1, physicalPageNumber: 1, pageLabel: "A1", pageLabelSource: "MANUAL",
      pageLabelVerified: true, pageImageObjectKey: "atlas/page-1.png", parsedText: "第 1 页正文",
      parseStatus: "PARSED", hasTables: true, hasImages: true,
      metadata: {
        uploadSource: "ZIP", recognitionStatus: "CONFIRMED",
        confirmedStructuredData: { schemaVersion: 2 },
        recognitionRunId: "run-old", recognitionQueuedAt: "2026-01-01T00:00:00.000Z"
      }
    }],
    knowledgeTocItems: [{
      id: tocId, documentId: docId, versionId: sourceVersionId, parentId: null,
      level: 1, sortOrder: 0, title: "外墙", pageLabel: "A1", physicalPageNumber: 1,
      source: "MANUAL", sectionId, status: "CONFIRMED"
    }],
    knowledgePageMappings: [{
      id: mappingId, documentId: docId, versionId: sourceVersionId, originalPageId: pageId,
      searchPhysicalPageNumber: 1, pageLabel: "A1", mappingMethod: "PAGE_LABEL", verified: true
    }],
    auditLogs: []
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
  app.decorate("storage", {
    createDownloadUrl: async () => "https://example.test/page.png",
    removeObject: async () => undefined
  } as unknown as FastifyInstance["storage"]);
  app.decorateRequest("currentUser", null);
  app.decorate("authenticate", async (request: Parameters<FastifyInstance["authenticate"]>[0]) => {
    request.currentUser = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(knowledgeRoutes, { prefix: "/api/v1/platform/knowledge" });
  await app.ready();
  return { app, store };
}

const cloneUrl = `/api/v1/platform/knowledge/versions/${sourceVersionId}/clone-as-draft`;

function cloneRequest(app: FastifyInstance, payload: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url: cloneUrl, payload });
}

describe("知识版本克隆（发布后修改）", () => {
  it("从已发布版本派生草稿并继承页面/识别/章节/目录/映射/资产", async () => {
    const { app, store } = await testApi();
    const result = (await cloneRequest(app, { changeNote: "修正第 1 页导热系数" })).json();

    expect(result.success).toBe(true);
    expect(result.data.version).toMatchObject({
      status: "DRAFT",
      version: 4,
      indexStatus: "INDEX_PENDING",
      indexDirty: true,
      parseStatus: "PARSED",
      usageMode: "AI_ENABLED",
      changeNote: "修正第 1 页导热系数"
    });
    expect(result.data.inherited).toEqual({
      pageCount: 1, recognitionConfirmedCount: 1, sectionCount: 1,
      tocItemCount: 1, pageMappingCount: 1, assetCount: 1
    });

    const draftId = result.data.versionId as string;
    expect(draftId).not.toBe(sourceVersionId);
    expect(store.knowledgeDocumentVersions).toHaveLength(2);

    // 页面复制到新版本：正文与页图沿用，识别运行时引用被清空
    const clonedPage = store.knowledgePages!.find(page => page.versionId === draftId)!;
    expect(clonedPage).toBeTruthy();
    expect(clonedPage.id).not.toBe(pageId);
    expect(clonedPage.parsedText).toBe("第 1 页正文");
    expect(clonedPage.pageImageObjectKey).toBe("atlas/page-1.png");
    expect(clonedPage.metadata).toMatchObject({
      recognitionStatus: "CONFIRMED", recognitionRunId: null, recognitionQueuedAt: null
    });

    // 章节 / 目录 / 映射都重新指向新版本的实体
    const clonedSection = store.knowledgeSections!.find(section => section.versionId === draftId)!;
    expect(clonedSection.id).not.toBe(sectionId);
    expect(clonedSection.parentId).toBeNull();
    const clonedToc = store.knowledgeTocItems!.find(item => item.versionId === draftId)!;
    expect(clonedToc.sectionId).toBe(clonedSection.id);
    const clonedMapping = store.knowledgePageMappings!.find(row => row.versionId === draftId)!;
    expect(clonedMapping.originalPageId).toBe(clonedPage.id);

    // 资产复用同一 fileId，不复制文件实体
    expect(store.knowledgeDocumentAssets!.find(asset => asset.versionId === draftId)!.fileId).toBe(fileId);

    // 源版本保持发布状态，识别运行时引用不受影响
    expect(store.knowledgeDocumentVersions!.find(version => version.id === sourceVersionId)!.status).toBe("PUBLISHED");
    expect(store.knowledgePages!.find(page => page.versionId === sourceVersionId)!.metadata)
      .toMatchObject({ recognitionRunId: "run-old" });

    expect(store.auditLogs?.map(row => row.action)).toEqual(["knowledge.version_cloned"]);
  });

  it("同一文档已有草稿时拒绝再次克隆", async () => {
    const store = fixture();
    store.knowledgeDocumentVersions!.push({
      ...store.knowledgeDocumentVersions![0]!, id: "00000000-0000-4000-8000-000000000099",
      version: 4, status: "DRAFT"
    });
    const { app } = await testApi(store);

    expect((await cloneRequest(app)).json()).toMatchObject({
      success: false, error: { details: { errorCode: "KNOWLEDGE_VERSION_DRAFT_EXISTS" } }
    });
    expect(store.knowledgePages).toHaveLength(1);
    expect(store.auditLogs).toHaveLength(0);
  });

  it.each(["DRAFT", "APPROVED", "PENDING_REVIEW"])("拒绝从 %s 版本克隆（该状态可直接编辑）", async status => {
    const store = fixture();
    store.knowledgeDocumentVersions![0]!.status = status;
    const { app } = await testApi(store);

    expect((await cloneRequest(app)).json()).toMatchObject({ success: false, error: { code: 409 } });
    expect(store.knowledgeDocumentVersions).toHaveLength(1);
    expect(store.auditLogs).toHaveLength(0);
  });

  it("已停用版本同样可以派生草稿", async () => {
    const store = fixture();
    store.knowledgeDocumentVersions![0]!.status = "DISABLED";
    const { app } = await testApi(store);

    const result = (await cloneRequest(app)).json();
    expect(result.success).toBe(true);
    expect(result.data.version).toMatchObject({ status: "DRAFT", version: 4 });
  });

  it("无编辑权限时拒绝克隆", async () => {
    const { app } = await testApi(fixture(), {
      ...actor, role: "NORMAL_USER", permissionCodes: ["system:knowledge:doc:list"]
    });
    expect((await cloneRequest(app)).json()).toMatchObject({ success: false, error: { code: 403 } });
  });

  it.each(["C_APP", "PC_AI"] as const)("拒绝 %s 客户端调用克隆接口", async clientType => {
    const { app } = await testApi(fixture(), { ...actor, clientType });
    expect((await cloneRequest(app)).json()).toMatchObject({ success: false, error: { code: 403 } });
  });

  it("删除克隆草稿不删除被源版本共用的文件", async () => {
    const { app, store } = await testApi();
    const draftId = (await cloneRequest(app)).json().data.versionId as string;

    expect((await app.inject({
      method: "DELETE", url: `/api/v1/platform/knowledge/versions/${draftId}`
    })).json().success).toBe(true);

    // 草稿被删除，源版本与其资产仍在（共用文件未被移除）
    expect(store.knowledgeDocumentVersions).toHaveLength(1);
    expect(store.knowledgeDocumentVersions![0]!.id).toBe(sourceVersionId);
    expect(store.knowledgeDocumentAssets!.some(asset => asset.versionId === sourceVersionId)).toBe(true);
  });
});
