import type { FastifyReply } from "fastify";
import { writeSse } from "./ai-sse.js";

/** 只描述实际执行阶段；不接收模型推理、工具入参、检索正文或内部标识。 */
const steps = {
  understanding: ["analyzing", "正在理解你的问题…", "已梳理问题"],
  images: ["analyzing", "正在查看你上传的图片…", "已查看上传图片"],
  products: ["checking", "正在查找产品资料…", "已完成产品资料查询"],
  parameters: ["checking", "正在核对参数和来源…", "已完成参数核对"],
  knowledge: ["checking", "正在查询知识库资料…", "已完成知识库查询"],
  references: ["checking", "正在核对参考做法和查询条件…", "已完成参考资料核对"],
  comparison: ["checking", "正在读取产品对比依据…", "已读取产品对比依据"],
  calculation: ["checking", "正在按已确认参数计算…", "已完成本次计算处理"],
  composing: ["composing", "正在整理回答…", "回答整理完成"]
} as const;
export type ProcessingStepId = keyof typeof steps;

export function processingSources(input: readonly unknown[]): Array<{ title: string; pageLabel?: string }> {
  const result = new Map<string, { title: string; pageLabel?: string }>();
  for (const value of input) {
    if (!value || typeof value !== "object") continue;
    const source = value as Record<string, unknown>;
    if (typeof source.title !== "string" || !source.title.trim()) continue;
    const title = source.title.trim().slice(0, 180);
    const pageLabel = typeof source.pageLabel === "string" ? source.pageLabel.trim().slice(0, 40) : "";
    result.set(`${title}\u0000${pageLabel}`, { title, ...(pageLabel ? { pageLabel } : {}) });
  }
  return [...result.values()].slice(0, 12);
}

export function createProcessingProgress(reply: FastifyReply) {
  const pending = new Set<ProcessingStepId>();
  return {
    start(stepId: ProcessingStepId) {
      pending.add(stepId);
      writeSse(reply, "progress", { stage: steps[stepId][0], stepId, status: "active", message: steps[stepId][1] });
    },
    complete(stepId: ProcessingStepId) {
      if (!pending.delete(stepId)) return;
      writeSse(reply, "progress", { stage: steps[stepId][0], stepId, status: "done", message: steps[stepId][2] });
    },
    sources(input: readonly unknown[] | undefined) {
      const sources = processingSources(input ?? []);
      if (sources.length) writeSse(reply, "progress", {
        stage: "checking", stepId: "sources", status: "done", message: "已读取以下资料", sources
      });
    },
    interrupt(status: "error" | "stopped") {
      for (const stepId of pending) writeSse(reply, "progress", {
        stage: steps[stepId][0], stepId, status, message: status === "stopped" ? "本步已停止" : "本步未完成"
      });
      pending.clear();
    }
  };
}
