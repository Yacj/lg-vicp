import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

import type { AuthUser } from "../../shared/auth-user.js";
import {
  knowledgeChunks,
  knowledgeDocumentAssets,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgePageMappings,
  knowledgePages,
  knowledgeSections,
  knowledgeTocItems
} from "../../db/schema.js";
import { approveVersion, deriveDocumentHealth, publishVersion } from "./knowledge-admin.service.js";
import { assertVersionPublishable } from "./knowledge-original.service.js";
import {
  deriveKnowledgeVersionReadiness,
  summarizePageReadiness,
  type KnowledgePageReadinessRow
} from "./knowledge-readiness.js";
import { assertVersionTestable, getDocumentWorkspace } from "./knowledge-workflow.service.js";

/**
 * 页面驱动知识库（无 ORIGINAL）端到端收口回归：
 * 创建 → 上传 PNG/ZIP → 识别 → 人工确认 → page-aware chunks → 审核 → 发布 → Knowledge Test → AI 可用状态。
 * 同时校验「B 端 canPublish / blockers」与「发布 API」完全同源。
 */

const actor: AuthUser = {
  id: "user-1",
  role: "SUPER_ADMIN",
  channelType: null,
  adminLoginEnabled: true,
  clientType: "B_ADMIN"
} as AuthUser;

const request = { id: "req-1", ip: "127.0.0.1", headers: {} } as any;

function offlinePage(overrides: Partial<KnowledgePageReadinessRow> = {}): KnowledgePageReadinessRow {
  return {
    pageImageObjectKey: "knowledge/page-images/doc-1/ver-1/p1.png",
    uploadSource: "ZIP",
    recognitionStatus: "CONFIRMED",
    recognitionRunId: null,
    hasText: false,
    ...overrides
  };
}

interface AppOptions {
  version?: Record<string, unknown>;
  pages?: Array<Record<string, unknown>>;
  chunkCount?: number;
  assetRoles?: string[];
  toc?: Array<{ status: string }>;
  mappings?: Array<{ verified: boolean; confidence: number | null }>;
  fallbackPageLabelCount?: number;
}

/** 按表名 + 选择列分派的 db mock：不关心查询顺序，只回答确定性数据。 */
function knowledgeApp(options: AppOptions = {}) {
  const version = {
    id: "ver-1",
    documentId: "doc-1",
    version: 1,
    title: "VICP 保温装饰板图集",
    status: "DRAFT",
    pipelineStatus: "UPLOAD_PENDING",
    parseStatus: "PENDING",
    usageMode: "AI_ENABLED",
    fileId: null,
    evidenceLevel: null,
    ...options.version
  };
  const document = {
    id: "doc-1",
    title: "VICP 保温装饰板图集",
    docType: "DETAIL_ATLAS",
    docNumber: null,
    categoryId: null,
    currentVersionId: null,
    projectId: null,
    visibility: "PRIVATE",
    status: "ACTIVE",
    deletedAt: null,
    evidenceLevel: null
  };
  const pages = options.pages ?? [];
  const chunkCount = options.chunkCount ?? 0;
  const assetRoles = options.assetRoles ?? [];

  const resolve = (selection: Record<string, unknown>, table: unknown): unknown[] => {
    const keys = Object.keys(selection);
    if (keys.includes("value")) {
      if (table === knowledgeChunks) return [{ value: chunkCount }];
      if (table === knowledgePages) return [{ value: options.fallbackPageLabelCount ?? 0 }];
      return [{ value: 0 }];
    }
    if (table === knowledgeDocumentVersions) return [version];
    if (table === knowledgeDocuments) return [document];
    if (table === knowledgeDocumentAssets) {
      return assetRoles.map((role) => ({
        role,
        fileId: `file-${role}`,
        fileName: `${role}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1024
      }));
    }
    if (table === knowledgePages) return pages;
    if (table === knowledgeChunks) return Array.from({ length: chunkCount }, (_, index) => ({ id: `chunk-${index}` }));
    if (table === knowledgeTocItems) return (options.toc ?? []).map((row, index) => ({ ...row, id: `toc-${index}` }));
    if (table === knowledgePageMappings) return options.mappings ?? [];
    if (table === knowledgeSections) return [];
    return [];
  };

  const chain = (rows: () => unknown[]) => {
    const target: Record<string, unknown> = {
      where: () => target,
      innerJoin: () => target,
      orderBy: () => target,
      offset: () => target,
      limit: () => Promise.resolve(rows()),
      returning: () => Promise.resolve(rows()),
      then: (onFulfilled: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(rows()).then(onFulfilled, onRejected)
    };
    return target;
  };

  return {
    db: {
      select: (selection: Record<string, unknown> = {}) => ({
        from: (table: unknown) => chain(() => resolve(selection, table))
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
        update: () => ({ set: () => ({ where: () => chain(() => [version]) }) }),
        insert: () => ({ values: () => Promise.resolve() })
      })
    },
    log: { warn: () => undefined, info: () => undefined },
    storage: { createDownloadUrl: async () => "https://example.test/page-1.png" },
    queues: { pageRecognition: { add: async () => undefined }, documentProcessing: { add: async () => undefined } }
  } as any;
}

describe("Case B：纯页面 Knowledge 可审核 / 可发布 / AI 可用", () => {
  const app = knowledgeApp({ pages: [offlinePage(), offlinePage()], chunkCount: 6 });
  const version = { id: "ver-1", documentId: "doc-1", usageMode: "AI_ENABLED", parseStatus: "PENDING", fileId: null } as any;

  it("发布门禁通过（无 ORIGINAL）", async () => {
    const result = await assertVersionPublishable(app, version);
    expect(result.publishReady).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("审核通过（不再要求 parseStatus=PARSED）", async () => {
    await expect(approveVersion(app, request, actor, "ver-1")).resolves.toMatchObject({ message: "版本已审核通过" });
  });

  it("Knowledge Test 可用", async () => {
    const result = await assertVersionTestable(app, "ver-1");
    expect(result.version.id).toBe("ver-1");
    expect(result.hasSearchSource).toBe(false);
  });

  it("工作台 canPublish / canAskAi 与发布 API 同源", async () => {
    const workspace = await getDocumentWorkspace(app, actor, "doc-1");
    expect(workspace.summary.canPublish).toBe(true);
    expect(workspace.summary.canAskAi).toBe(true);
    expect(workspace.summary.publishBlockers).toEqual([]);
    expect(workspace.summary.contentSource).toBe("PAGE_DRIVEN");
    expect(workspace.currentVersion?.userStatus).toBe("READY_TO_VERIFY");
  });

  it("文档健康不出现「尚未上传正式文件 / 文件识别尚未完成」", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      { usageMode: "AI_ENABLED", parseStatus: "PENDING", hasOriginalAsset: false, hasSearchSourceAsset: false },
      summarizePageReadiness([offlinePage(), offlinePage()], 6)
    );
    const health = deriveDocumentHealth({
      version: { status: "DRAFT", parseStatus: "PENDING", pipelineStatus: "UPLOAD_PENDING", usageMode: "AI_ENABLED", fileId: null },
      assetRoles: [],
      readiness
    });
    expect(health.healthBlockers.join(" ")).not.toContain("尚未上传正式文件");
    expect(health.healthBlockers.join(" ")).not.toContain("文件识别尚未完成");
    expect(health.healthBlockers).toHaveLength(0);
    expect(health.healthStatus).toBe("PENDING_REVIEW");
    expect(health.aiAvailabilityStatus).toBe("AVAILABLE");
  });
});

describe("Case C：页面未确认 → 审核与发布都拦截", () => {
  const app = knowledgeApp({ pages: [offlinePage({ recognitionStatus: "REVIEW_REQUIRED" })], chunkCount: 3 });
  const version = { id: "ver-1", documentId: "doc-1", usageMode: "AI_ENABLED", parseStatus: "PENDING", fileId: null } as any;

  it("发布被拒并返回稳定业务码", async () => {
    await expect(assertVersionPublishable(app, version)).rejects.toMatchObject({
      code: "KNOWLEDGE_VERSION_PAGES_UNCONFIRMED",
      statusCode: 400
    });
  });

  it("审核被拒并给出实际 blocker（不再只写「版本尚未完成解析」）", async () => {
    await expect(approveVersion(app, request, actor, "ver-1")).rejects.toThrow("待人工确认");
  });

  it("工作台 canPublish=false 且 blockers 与 API 一致", async () => {
    const workspace = await getDocumentWorkspace(app, actor, "doc-1");
    expect(workspace.summary.canPublish).toBe(false);
    expect(workspace.summary.publishBlockers.join(" ")).toContain("待人工确认");
    expect(workspace.summary.publishBlockerCodes).toEqual(["KNOWLEDGE_VERSION_PAGES_UNCONFIRMED"]);
    expect(workspace.summary.canAskAi).toBe(false);
  });
});

describe("Case D/E：识别失败 / 缺图 → 发布拦截", () => {
  const version = { id: "ver-1", documentId: "doc-1", usageMode: "AI_ENABLED", parseStatus: "PENDING", fileId: null } as any;

  it("Case D：FAILED 页面", async () => {
    const app = knowledgeApp({ pages: [offlinePage({ recognitionStatus: "FAILED" })], chunkCount: 3 });
    await expect(assertVersionPublishable(app, version)).rejects.toMatchObject({
      code: "KNOWLEDGE_VERSION_PAGES_RECOGNITION_FAILED"
    });
  });

  it("Case E：缺原页图片", async () => {
    const app = knowledgeApp({ pages: [offlinePage({ pageImageObjectKey: null })], chunkCount: 3 });
    await expect(assertVersionPublishable(app, version)).rejects.toMatchObject({
      code: "KNOWLEDGE_VERSION_PAGES_MISSING_IMAGE"
    });
  });

  it("Case E：空版本仍先抛 KNOWLEDGE_VERSION_EMPTY", async () => {
    const app = knowledgeApp({ pages: [] });
    await expect(assertVersionPublishable(app, version)).rejects.toMatchObject({
      code: "KNOWLEDGE_VERSION_EMPTY"
    });
  });
});

describe("Case F：页面确认但无 chunks（AI_ENABLED 不可正式发布）", () => {
  const app = knowledgeApp({ pages: [offlinePage()], chunkCount: 0 });
  const version = { id: "ver-1", documentId: "doc-1", usageMode: "AI_ENABLED", parseStatus: "PENDING", fileId: null } as any;

  it("发布被拒：AI_ENABLED 必须有可检索内容（与 B 端 canPublish 同源）", async () => {
    await expect(assertVersionPublishable(app, version)).rejects.toMatchObject({
      code: "KNOWLEDGE_SEARCHABLE_CONTENT_REQUIRED",
      statusCode: 400
    });
    const workspace = await getDocumentWorkspace(app, actor, "doc-1");
    expect(workspace.summary.canPublish).toBe(false);
    expect(workspace.summary.publishBlockerCodes).toEqual(["KNOWLEDGE_SEARCHABLE_CONTENT_REQUIRED"]);
    expect(workspace.summary.canAskAi).toBe(false);
    const readiness = deriveKnowledgeVersionReadiness(
      { usageMode: "AI_ENABLED", parseStatus: "PENDING", hasOriginalAsset: false, hasSearchSourceAsset: false },
      summarizePageReadiness([offlinePage()], 0)
    );
    const health = deriveDocumentHealth({
      version: { status: "DRAFT", parseStatus: "PENDING", pipelineStatus: "UPLOAD_PENDING", usageMode: "AI_ENABLED", fileId: null },
      assetRoles: [],
      readiness
    });
    expect(health.aiAvailabilityStatus).toBe("UNAVAILABLE");
    expect(health.healthWarnings.join(" ")).toContain("尚未生成可检索内容");
    expect(health.healthBlockers.join(" ")).toContain("chunks = 0");
  });

  it("Knowledge Test 在无 chunks 时仍拒绝", async () => {
    await expect(assertVersionTestable(app, "ver-1")).rejects.toMatchObject({
      details: { errorCode: "KNOWLEDGE_NOT_READY_FOR_TEST" }
    });
  });
});

describe("Case L：PUBLISHED 页面驱动版本不可变", () => {
  const publishedApp = knowledgeApp({ version: { status: "PUBLISHED" }, pages: [offlinePage()], chunkCount: 3 });
  const publishedVersion = { id: "ver-1", documentId: "doc-1", usageMode: "AI_ENABLED", parseStatus: "PENDING", fileId: null } as any;

  it("发布门禁对已发布版本不再重复放行（由 publishVersion 前置拦截）", async () => {
    await expect(publishVersion(publishedApp, request, actor, "ver-1")).rejects.toMatchObject({
      code: "KNOWLEDGE_VERSION_ALREADY_PUBLISHED"
    });
  });

  it("页面驱动版本发布后仍不能上传页面 / 手工建页", async () => {
    const { batchUploadVersionPages } = await import("./knowledge-page-upload.service.js");
    const { createManualPage } = await import("./knowledge-page-gallery.service.js");
    await expect(batchUploadVersionPages(publishedApp, request, actor, "ver-1", [{ fileId: "file-1" }]))
      .rejects.toMatchObject({ code: "KNOWLEDGE_VERSION_NOT_EDITABLE" });
    await expect(createManualPage(publishedApp, request, actor, "ver-1", { pageNumber: 99 }))
      .rejects.toMatchObject({ code: "KNOWLEDGE_VERSION_NOT_EDITABLE" });
  });

  it("已发布版本仍可被 AI 测试读取（只读不写）", async () => {
    const result = await assertVersionTestable(publishedApp, "ver-1");
    expect(result.version.status).toBe("PUBLISHED");
  });
});
