import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { runAgentLoop } from "./ai-agent.service.js";
import { startSseStream, writeSse } from "./ai-sse.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { formatConfirmedLookupAnswer } from "../knowledge/knowledge-test-reference.js";
import type { ReferencePageBlock } from "./reference-page.js";
import type { ToolRuntimeContext } from "./ai-tools.js";
import { structuredReferenceFixture } from "./structured-reference.fixture.js";
import { resolveStructuredReferenceQuery } from "./structured-reference-query.js";

const bridge = vi.hoisted(() => ({ context: undefined as ToolRuntimeContext | undefined, confirm: true, waiting: false,
  reference: undefined as { answer: string; pages: ReferencePageBlock[] } | undefined }));
vi.mock("./ai-tools.js", () => ({ createAgentTools: (context: ToolRuntimeContext) => { bridge.context = context; return {}; } }));
vi.mock("ai", async importOriginal => {
  const sdk = await importOriginal<typeof import("ai")>();
  return { ...sdk, streamText: () => ({
    usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }), responseMessages: Promise.resolve([]),
    fullStream: (async function* () {
      yield { type: "start-step" }; yield { type: "tool-call" };
      if (bridge.confirm) bridge.context!.onReferenceAnswer!(bridge.reference?.answer ?? formatConfirmedLookupAnswer([page], [optionId], []), bridge.reference?.pages ?? [page]);
      if (bridge.waiting) bridge.context!.onWait!({ __agentSignal: "WAITING_USER_INPUT", type: "CHOICE", title: "请选择资料", prompt: "请选择参考资料", options: [{ id: "doc", label: "协议测试资料" }] });
      yield { type: "finish-step" };
      yield { type: "start-step" };
      // 对抗夹具：模型复述错误厚度、双R/K，正文不能采纳此值。
      yield { type: "text-delta", text: bridge.waiting ? "请选择参考资料。" : "模型误答：8mm，产品R9.999，总R8.888，K0.999。" };
      yield { type: "finish-step" };
    })()
  }) };
});
const page: ReferencePageBlock = { type: "REFERENCE_PAGE", page: { documentId: "doc", pageId: "page", documentTitle: "通用协议资料", pageLabel: "22", pageNumber: 1, imageUrl: "https://example.test/full-page" },
  renderModel: buildKnowledgePageRenderModel("page", { fullText: "", systems: [{ constructionCode: "A1-3", options: [
    { thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 },
    { thicknessMm: 20, productThermalResistance: 3.2, totalThermalResistance: 3.616, kValue: 0.277 }
  ] }] }), summary: {}, matches: [], highlights: [] };
const optionId = page.renderModel!.constructions[0]!.options[0]!.optionId;

beforeEach(() => { bridge.confirm = true; bridge.waiting = false; bridge.reference = undefined; });
async function requestAnswer() {
  const app = Fastify();
  const query: any = { set: () => query, where: () => Promise.resolve([]) };
  const read: any = { from: () => read, where: () => read, limit: () => Promise.resolve([]) };
  app.decorate("db", { update: () => query, select: () => read });
  let result: Awaited<ReturnType<typeof runAgentLoop>> | undefined;
  app.get("/protocol-fixture", async (request, reply) => {
    startSseStream(reply, request.id);
    try {
    result = await runAgentLoop({ app, request, reply, user: { id: "test-user" },
      conversation: { id: "test-conversation", projectId: null }, runtime: {}, agentModel: { languageModel: {} },
      allowedTools: ["search_knowledge"], assistantMessageId: "test-message", agentRunId: "test-run", abortSignal: new AbortController().signal,
      initialState: { system: "通用协议测试", messages: [], sources: [], recentToolHashes: [], fullText: "", userVisibleText: "", internalStepText: "" },
      answerContract: "REFERENCE_LOOKUP", userMessage: "传热系数0.3有哪些方案？" } as Parameters<typeof runAgentLoop>[0]);
    writeSse(reply, "done", { referencePages: result.referencePages });
    } catch (error) { writeSse(reply, "fixture_error", { message: error instanceof Error ? error.stack : String(error) }); }
    finally { reply.raw.end(); }
  });
  try {
    const response = await app.inject("/protocol-fixture");
    const events = response.body.trim().split("\n\n").map(event => {
      const lines = event.split("\n"); return { event: lines[0]!.slice(7), data: JSON.parse(lines[1]!.slice(6)) };
    });
    const error = events.find(event => event.event === "fixture_error");
    if (error) throw new Error(error.data.message);
    return { events, result: result! };
  } finally { await app.close(); }
}

describe("Agent至HTTP/SSE正文的确认事实绑定（协议夹具，非真实模型UAT）", () => {
  it("四基层跨页完整文本及两个来源页进入SSE，四个optionId都保留", async () => {
    const snapshots = structuredReferenceFixture();
    const pages: ReferencePageBlock[] = snapshots.map(({ page, model }) => ({ type: "REFERENCE_PAGE", page: { documentId: page.documentId,
      pageId: page.id, documentTitle: "模拟图集", pageLabel: page.pageLabel, pageNumber: page.physicalPageNumber, imageUrl: "" },
      renderModel: model, matches: [], highlights: [], summary: {} }));
    const ids = snapshots.flatMap(snapshot => snapshot.model.constructions.map(construction => construction.options[0]!.optionId));
    bridge.reference = { pages, answer: formatConfirmedLookupAnswer(pages, ids, [], { totalMatched: 4, totalGroups: 4,
      structured: resolveStructuredReferenceQuery("Ⅲ型45mm不同基层传热系数有什么区别") }) };
    const { events, result } = await requestAnswer();
    expect(result.text).toContain("共 4 条、4 种基层，当前展示 4 条"); expect(result.text).toContain("0.248");
    expect(result.text).not.toContain("模型误答"); expect(result.text).not.toContain("[[KP:");
    const refs = events.find(event => event.event === "reference_pages")!.data.referencePages as ReferencePageBlock[];
    expect(refs.map(page => [page.page.pageLabel, page.matches.length])).toEqual([["5", 2], ["6", 2]]);
    expect(refs.flatMap(page => page.matches.map(match => match.optionId))).toEqual(ids);
  });
  it("错误模型复述不进入delta，正式值与完整原页/高亮ID/段落位置一致", async () => {
    const { events, result } = await requestAnswer();
    const text = events.filter(event => event.event === "delta").map(event => event.data.text).join("");
    expect(text).toBe(result.text); expect(text).toContain("18mm"); expect(text).toContain("2.880");
    expect(text).toContain("3.297"); expect(text).toContain("0.303"); expect(text).not.toContain("0.999"); expect(text).not.toContain("[[KP:");
    const refs = events.find(event => event.event === "reference_pages")!.data.referencePages as ReferencePageBlock[];
    expect(refs[0]!.renderModel!.constructions[0]!.options).toHaveLength(2);
    expect(refs[0]!.matches[0]).toMatchObject({ optionId, answerOffset: text.indexOf("\n\n以上") });
    expect(JSON.stringify(result.referencePages)).not.toContain("imageUrl");
  });
  it("没有确认事实时保留普通Agent正文", async () => {
    bridge.confirm = false;
    const { result, events } = await requestAnswer();
    expect(result.text).toContain("模型误答"); expect(events.some(event => event.event === "reference_pages")).toBe(false);
  });
  it("资料选择等待仍走原HITL，不能被确定性查表回答抢占", async () => {
    bridge.waiting = true;
    const { result, events } = await requestAnswer();
    expect(result.finish).toBe("WAITING_USER_INPUT"); expect(result.text).toBe("请选择参考资料。");
    expect(events.some(event => event.event === "reference_pages")).toBe(false);
    expect(events.some(event => event.event === "need_user_input")).toBe(true);
  });
});
