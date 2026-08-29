import { describe, expect, it, vi } from "vitest";
import { createNotification, type CreateNotificationInput } from "./notification.service.js";

/**
 * 消息通知服务测试（P1-1）：通知为尽力写入，任何失败不阻塞主业务流程。
 */

const input: CreateNotificationInput = {
  type: "AI_FEEDBACK",
  title: "收到新的 AI 回答点踩反馈",
  targetType: "ai_message_feedback",
  targetId: "a1b2c3d4-0000-4000-8000-000000000001"
};

describe("createNotification（尽力写入）", () => {
  it("写入成功时不抛错", async () => {
    const values: unknown[] = [];
    const deps = {
      db: {
        insert: () => ({ values: (v: unknown) => { values.push(v); return Promise.resolve(); } })
      } as never,
      log: { error: vi.fn() }
    };
    await expect(createNotification(deps, input)).resolves.toBeUndefined();
    expect(values).toHaveLength(1);
    expect(deps.log.error).not.toHaveBeenCalled();
  });

  it("写入失败时吞掉异常并记日志，不向调用方抛错", async () => {
    const deps = {
      db: {
        insert: () => { throw new Error("数据库暂时不可用"); }
      } as never,
      log: { error: vi.fn() }
    };
    await expect(createNotification(deps, { ...input, type: "KNOWLEDGE_PARSE_FAILED", content: "解析失败" }))
      .resolves.toBeUndefined();
    expect(deps.log.error).toHaveBeenCalled();
  });
});
