/**
 * AI 流式响应共享工具：SSE 事件写入与中止错误判断。
 * 对话与调试路由共用，保证事件格式一致。
 */
import type { FastifyReply } from "fastify";

export type ProgressStage = "analyzing" | "checking" | "composing" | "completed";

/**
 * 启动 SSE 响应流：hijack 后 Fastify 不再写出响应头，
 * 必须把 @fastify/cors 在 onRequest 阶段登记到 reply 上的 CORS 头
 * （按白名单计算的结果）一并写入手动 writeHead，否则浏览器跨域请求被拦截。
 */
export function startSseStream(reply: FastifyReply, requestId: string) {
  const corsHeaderNames = [
    "access-control-allow-origin",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-allow-credentials",
    "access-control-expose-headers",
    "vary"
  ] as const;
  const corsHeaders = Object.fromEntries(
    corsHeaderNames
      .map((name) => [name, reply.getHeader(name)])
      .filter(([, value]) => value !== undefined && value !== null)
  );
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-request-id": requestId,
    ...corsHeaders
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