import { describe, expect, it, vi } from "vitest";
import { generateText, stepCountIs, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import {
  COLLECTION_AGENT_LIMITS,
  fetchPageTool,
  followLinkTool,
  searchInPageTool
} from "./collection-agent.service.js";
import { browsePageInput, createCollectionAgentTools } from "./collection-agent.tools.js";
import { isSameOrigin } from "./collection-fingerprint.js";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

function mockUsage() {
  return {
    inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 6, text: 6, reasoning: undefined }
  };
}

describe("采集 Agent 工具与限制", () => {
  it("固定循环上限，不向管理员暴露选择器/代理配置", () => {
    expect(COLLECTION_AGENT_LIMITS.maxSteps).toBe(12);
    expect(COLLECTION_AGENT_LIMITS.maxPages).toBe(8);
    expect(COLLECTION_AGENT_LIMITS.overallTimeoutMs).toBe(120_000);
  });

  it("search_in_page 按关键词命中", () => {
    const page = { url: "https://example.com/a", title: "VICP 图集", text: "真空绝热复合保温板应用", links: [] };
    expect(searchInPageTool(page, ["VICP", "岩棉"]).hits).toEqual(["VICP"]);
    expect(searchInPageTool(page, ["岩棉"]).matched).toBe(false);
  });

  it("follow_link 去重且拒绝跨域", () => {
    const visited = new Set(["https://example.com/a"]);
    expect(followLinkTool({ sourceUrl: "https://example.com/a", candidateUrl: "https://example.com/a", visited }).reason).toBe("DUPLICATE_URL");
    expect(followLinkTool({ sourceUrl: "https://example.com/a", candidateUrl: "https://other.com/b", visited }).reason).toBe("CROSS_ORIGIN");
    expect(followLinkTool({ sourceUrl: "https://example.com/a", candidateUrl: "https://example.com/b", visited }).skipped).toBe(false);
  });

  it("fetch_page 失败会重试", async () => {
    const httpFetch = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "<html><title>图集</title><a href='/next'>next</a>VICP</html>"
      });
    const page = await fetchPageTool(httpFetch as never, "https://example.com/a", 1000);
    expect(page.title).toBe("图集");
    expect(httpFetch).toHaveBeenCalledTimes(2);
  });
});

describe("采集 Agent 使用 AI SDK Tool Calling", () => {
  it("browse_page inputSchema 要求合法 URL", () => {
    expect(browsePageInput.safeParse({ url: "not-a-url" }).success).toBe(false);
    expect(browsePageInput.safeParse({ url: "https://example.com/a" }).success).toBe(true);
  });

  it("browse_page 由 Backend 拒绝跨域，不交给模型自行判断", async () => {
    const ctx = {
      db: {} as never,
      sourceUrl: "https://example.com/start",
      sourceId: null,
      skillId: null,
      taskId: "task-1",
      runId: "run-1",
      keywords: ["VICP"],
      visited: new Set<string>(),
      storedCount: { value: 0 },
      duplicateCount: { value: 0 },
      lastFetchAt: { value: 0 },
      finished: { value: false },
      httpFetch: vi.fn(),
      deadline: Date.now() + 10_000
    };
    const tools = createCollectionAgentTools(ctx);
    const result = await tools.browse_page.execute!(
      { url: "https://evil.com/x" },
      { toolCallId: "call-1", messages: [], abortSignal: undefined, context: undefined as never }
    );
    expect(result).toMatchObject({ ok: false, code: "CROSS_ORIGIN", recoverable: true });
    expect(ctx.httpFetch).not.toHaveBeenCalled();
    expect(isSameOrigin("https://example.com/start", "https://evil.com/x")).toBe(false);
  });

  it("generateText 可调用 browse_page / save_record，fingerprint 去重由 Backend 负责", async () => {
    const insert = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined)
    });
    const ctx = {
      db: { insert } as never,
      sourceUrl: "https://example.com/start",
      sourceId: null,
      skillId: null,
      taskId: "task-1",
      runId: "run-1",
      keywords: ["VICP"],
      visited: new Set<string>(),
      storedCount: { value: 0 },
      duplicateCount: { value: 0 },
      lastFetchAt: { value: 0 },
      finished: { value: false },
      httpFetch: vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "<html><title>VICP 图集</title>真空绝热复合保温板<a href='/b'>next</a></html>"
      }),
      deadline: Date.now() + 10_000
    };
    const tools = createCollectionAgentTools(ctx);
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        if (ctx.visited.size === 0) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "call-browse",
              toolName: "browse_page",
              input: JSON.stringify({ url: "https://example.com/start" })
            }],
            finishReason: "tool-calls",
            usage: mockUsage(),
            warnings: []
          };
        }
        if (ctx.storedCount.value === 0) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "call-save",
              toolName: "save_record",
              input: JSON.stringify({
                url: "https://example.com/start",
                title: "VICP 图集",
                summary: "真空绝热复合保温板",
                matchedKeywords: ["VICP"]
              })
            }],
            finishReason: "tool-calls",
            usage: mockUsage(),
            warnings: []
          };
        }
        return {
          content: [{ type: "text", text: "采集完成" }],
          finishReason: "stop",
          usage: mockUsage(),
          warnings: []
        };
      },
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "采集完成" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: "stop", usage: mockUsage() }
        ])
      })
    });

    const result = await generateText({
      model,
      system: "采集助手",
      prompt: "起始网址：https://example.com/start",
      tools,
      stopWhen: stepCountIs(6)
    });

    expect(ctx.visited.has("https://example.com/start")).toBe(true);
    expect(ctx.storedCount.value).toBe(1);
    expect(insert).toHaveBeenCalled();
    expect(result.text).toContain("采集完成");
  });

  it("高层 Tool 才注册给模型，fetch/follow/search 不是独立 Agent Tool", () => {
    const dummy = tool({
      description: "x",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async () => ({ ok: true })
    });
    expect(dummy).toBeTruthy();
    const tools = createCollectionAgentTools({
      db: {} as never,
      sourceUrl: "https://example.com/a",
      sourceId: null,
      skillId: null,
      taskId: "t",
      runId: "r",
      keywords: [],
      visited: new Set(),
      storedCount: { value: 0 },
      duplicateCount: { value: 0 },
      lastFetchAt: { value: 0 },
      finished: { value: false },
      httpFetch: vi.fn(),
      deadline: Date.now() + 1000
    });
    expect(Object.keys(tools).sort()).toEqual(["browse_page", "finish_collection", "save_record"]);
  });
});
