/**
 * AI 流式响应共享工具：SSE 事件写入与中止错误判断。
 * 对话与调试路由共用，保证事件格式一致。
 */
import type { FastifyReply } from "fastify";

export type ProgressStage = "analyzing" | "checking" | "composing" | "completed";

/**
 * 启动 SSE 响应流：hijack 后 Fastify 不再写出响应头，需手动 writeHead。
 * 浏览器与 API 必须同源，不再回写 CORS 头。
 */
export function startSseStream(reply: FastifyReply, requestId: string) {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-request-id": requestId
  });
}

export function writeSse(reply: FastifyReply, event: string, data: unknown) {
  if (reply.raw.destroyed || reply.raw.writableEnded) return;
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function writeProgress(reply: FastifyReply, stage: ProgressStage, message: string) {
  writeSse(reply, "progress", { stage, message });
}

export function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.message.includes("已请求停止"));
}