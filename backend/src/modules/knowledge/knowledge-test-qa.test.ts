import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeError } from "../../shared/knowledge-errors.js";
import { toUserTestSources } from "../ai/ai-source.mapper.js";
import { assertVersionTestable, streamVersionTestQa } from "./knowledge-workflow.service.js";
import type { WikiHit } from "./knowledge.service.js";

const actor = {
  id: "user-1",
  role: "CHANNEL_USER" as const,
  channelType: "DEALER" as const,
  adminLoginEnabled: true,
  clientType: "B_ADMIN" as const,
  permissionCodes: ["system:knowledge:doc:test"]
};

function limitSelect(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows
      })
    })
  };
}

function whereSelect(rows: unknown[]) {
  return {
    from: () => ({
      where: async () => rows
    })
  };
}

describe("assertVersionTestable", () => {
  it("DRAFT + PARSED 且有页面/分块时通过", async () => {
    let call = 0;
    const app = {
      db: {
        select: () => {
          call += 1;
          if (call === 1) {
            return limitSelect([{
              id: "ver-a",
              documentId: "doc-a",
              status: "DRAFT",
              parseStatus: "PARSED",
              pipelineStatus: "REVIEW_PENDING"
            }]);
          }
          if (call === 2) return limitSelect([{ id: "doc-a", deletedAt: null }]);
          if (call === 3) return whereSelect([{ role: "ORIGINAL" }]);
          if (call === 4) return whereSelect([{ id: "page-1" }]);
          return whereSelect([{ id: "chunk-1" }]);
        }
      }
    } as any;
    const result = await assertVersionTestable(app, "ver-a");
    expect(result.version.id).toBe("ver-a");
    expect(result.hasSearchSource).toBe(true);
  });

  it("解析中抛出 KNOWLEDGE_NOT_READY_FOR_TEST", async () => {
    const app = {
      db: {
        select: () => limitSelect([{
          id: "ver-a",
          documentId: "doc-a",
          status: "DRAFT",
          parseStatus: "PARSING",
          pipelineStatus: "PARSING"
        }])
      }
    } as any;
    // first call version, second document — after that Promise.all still runs
    let call = 0;
    app.db.select = () => {
      call += 1;
      if (call === 1) {
        return limitSelect([{
          id: "ver-a",
          documentId: "doc-a",
          status: "DRAFT",
          parseStatus: "PARSING",
          pipelineStatus: "PARSING"
        }]);
      }
      if (call === 2) return limitSelect([{ id: "doc-a" }]);
      return whereSelect([]);
    };
    await expect(assertVersionTestable(app, "ver-a")).rejects.toMatchObject({
      details: { errorCode: "KNOWLEDGE_NOT_READY_FOR_TEST" }
    });
  });

  it("无文本层且无检索源抛出 KNOWLEDGE_SEARCH_SOURCE_REQUIRED", async () => {
    let call = 0;
    const app = {
      db: {
        select: () => {
          call += 1;
          if (call === 1) {
            return limitSelect([{
              id: "ver-a",
              documentId: "doc-a",
              status: "DRAFT",
              parseStatus: "SEARCH_SOURCE_REQUIRED",
              pipelineStatus: "REVIEW_PENDING"
            }]);
          }
          if (call === 2) return limitSelect([{ id: "doc-a" }]);
          if (call === 3) return whereSelect([{ role: "ORIGINAL" }]);
          return whereSelect([{ id: "page-1" }]);
        }
      }
    } as any;
    await expect(assertVersionTestable(app, "ver-a")).rejects.toMatchObject({
      details: { errorCode: "KNOWLEDGE_SEARCH_SOURCE_REQUIRED" }
    });
  });
});

describe("toUserTestSources", () => {
  it("只保留章节/页码/引用文字，不含 chunk 与 score", () => {
    const hits: WikiHit[] = [{
      sourceId: "s1",
      chunkId: "chunk-9",
      pageBlockId: "block-1",
      documentId: "doc-a",
      versionId: "ver-a",
      content: "传热系数不应大于 0.45",
      sourcePage: 3,
      physicalPageNumber: 3,
      pageLabel: "A3",
      sourceSection: "热工性能",
      headingPath: ["保温系统", "热工性能"],
      sourceTitle: "保温图集",
      retrievalUnit: "BLOCK",
      score: 88
    }];
    const sources = toUserTestSources(hits);
    expect(sources).toEqual([{
      documentId: "doc-a",
      versionId: "ver-a",
      title: "保温图集",
      tocPath: ["保温系统", "热工性能"],
      sectionTitle: "热工性能",
      pageLabel: "A3",
      physicalPageNumber: 3,
      matchedText: "传热系数不应大于 0.45"
    }]);
    expect(JSON.stringify(sources)).not.toContain("chunk-9");
    expect(JSON.stringify(sources)).not.toContain("88");
    expect(JSON.stringify(sources)).not.toContain("BLOCK");
  });
});

vi.mock("./knowledge.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./knowledge.service.js")>();
  return {
    ...actual,
    searchWikiHierarchy: vi.fn()
  };
});

vi.mock("../ai/ai-generation.service.js", () => ({
  streamConversationReply: vi.fn().mockResolvedValue(undefined)
}));

describe("streamVersionTestQa 检索隔离", () => {
  it("只把当前 versionId 传给 searchWikiHierarchy，不先全库检索", async () => {
    const { searchWikiHierarchy } = await import("./knowledge.service.js");
    const { streamConversationReply } = await import("../ai/ai-generation.service.js");
    vi.mocked(searchWikiHierarchy).mockResolvedValue([]);

    let call = 0;
    const app = {
      db: {
        select: () => {
          call += 1;
          if (call === 1) {
            return limitSelect([{
              id: "ver-a",
              documentId: "doc-a",
              status: "DRAFT",
              parseStatus: "PARSED",
              pipelineStatus: "REVIEW_PENDING"
            }]);
          }
          if (call === 2) return limitSelect([{ id: "doc-a" }]);
          if (call === 3) return whereSelect([{ role: "ORIGINAL" }]);
          return whereSelect([{ id: "x" }, { id: "y" }]);
        },
        transaction: async (fn: (tx: any) => Promise<unknown>) => fn({
          insert: () => ({
            values: () => {
              const result = Promise.resolve() as Promise<void> & { returning: () => Promise<unknown[]> };
              result.returning = async () => [{ id: "conv-1" }];
              return result;
            }
          })
        })
      }
    } as any;

    await streamVersionTestQa(app, { id: "req-1", ip: "127.0.0.1", headers: {} } as any, {} as any, actor, "ver-a", {
      query: "传热系数"
    });

    expect(searchWikiHierarchy).toHaveBeenCalledWith(app, "传热系数", { versionId: "ver-a", limit: 5 });
    const options = vi.mocked(searchWikiHierarchy).mock.calls[0]![2];
    expect(options).toEqual({ versionId: "ver-a", limit: 5 });
    expect(options).not.toHaveProperty("documentId");
    expect(streamConversationReply).toHaveBeenCalled();
  });
});
