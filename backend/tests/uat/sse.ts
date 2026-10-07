import type { SseEvent } from "./schema.js";

/** 支持跨网络chunk、CRLF、多行data；只接受完整SSE帧，不将普通JSON错误视为成功回答。 */
export class SseDecoder {
  private buffer = "";
  push(text: string): SseEvent[] {
    this.buffer += text;
    const events: SseEvent[] = [];
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const lines = frame.split(/\r?\n/);
      const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
      const payload = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (event && payload) events.push({ event, data: JSON.parse(payload) });
    }
    return events;
  }
  end() { if (this.buffer.trim()) throw new Error("SSE流在完整事件之前中断"); }
}

export async function sendTurn(baseUrl: string, token: string, conversationId: string, content: string, onEvent: (event: SseEvent) => void) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  const events: SseEvent[] = [];
  try {
    const response = await fetch(`${baseUrl}/api/v1/ai/conversations/${conversationId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ content }), signal: controller.signal });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw new Error(`真实对话未返回SSE（HTTP ${response.status}）`);
    const parser = new SseDecoder(); const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      const items = parser.push(decoder.decode(chunk, { stream: true }));
      events.push(...items); items.forEach(onEvent);
    }
    events.push(...parser.push(decoder.decode())); parser.end();
    const failure = events.find(event => event.event === "error");
    if (failure) throw new Error(`真实对话返回错误 ${String(failure.data.code ?? "UNKNOWN")}`);
    if (!events.some(event => event.event === "done")) throw new Error("真实对话SSE缺少done事件");
    return events;
  } finally { clearTimeout(timer); }
}
