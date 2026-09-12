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

import { AiError } from "../../shared/ai-errors.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { CHAT_IMAGE_MAX_COUNT, shouldEnqueueDocumentParse } from "../../shared/chat-image.js";

const owner = { id: "u-1", role: "NORMAL_USER" } as const;

function imageFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    ownerUserId: owner.id,
    projectId: null,
    status: "READY",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    originalName: "wall.jpg",
    objectKey: "users/u-1/wall.jpg",
    deletedAt: null,
    ...overrides
  };
}

function appWithFiles(rows: Array<Record<string, unknown>>) {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: async () => rows
        })
      })
    }
  } as never;
}

describe("聊天图片附件校验", () => {
  it("0 张图片走空附件", async () => {
    const { validateChatImageAttachments } = await import("./ai-vision.service.js");
    await expect(validateChatImageAttachments(appWithFiles([]), owner as never, undefined)).resolves.toEqual([]);
    await expect(validateChatImageAttachments(appWithFiles([]), owner as never, [])).resolves.toEqual([]);
  });

  it("1~4 张就绪图片通过", async () => {
    const { validateChatImageAttachments } = await import("./ai-vision.service.js");
    const files = [
      imageFile({ id: "file-1" }),
      imageFile({ id: "file-2", mimeType: "image/png", originalName: "b.png" })
    ];
    const result = await validateChatImageAttachments(appWithFiles(files), owner as never, ["file-1", "file-2"]);
    expect(result.map((item) => item.fileId)).toEqual(["file-1", "file-2"]);
  });

  it("超过 4 张拒绝", async () => {
    const { normalizeAttachmentFileIds } = await import("./ai-vision.service.js");
    expect(() => normalizeAttachmentFileIds(Array.from({ length: CHAT_IMAGE_MAX_COUNT + 1 }, (_, i) => `00000000-0000-0000-0000-00000000000${i}`)))
      .toThrow(ForbiddenError);
  });

  it("非法 MIME 拒绝", async () => {
    const { validateChatImageAttachments } = await import("./ai-vision.service.js");
    await expect(validateChatImageAttachments(
      appWithFiles([imageFile({ mimeType: "application/pdf" })]),
      owner as never,
      ["file-1"]
    )).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("未就绪文件拒绝", async () => {
    const { validateChatImageAttachments } = await import("./ai-vision.service.js");
    await expect(validateChatImageAttachments(
      appWithFiles([imageFile({ status: "UPLOADING" })]),
      owner as never,
      ["file-1"]
    )).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("无权文件按不存在处理", async () => {
    const { validateChatImageAttachments } = await import("./ai-vision.service.js");
    await expect(validateChatImageAttachments(
      appWithFiles([imageFile({ ownerUserId: "other-user" })]),
      owner as never,
      ["file-1"]
    )).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("默认视觉模型解析", () => {
  it("没有启用 vision 模型时返回 VISION_MODEL_NOT_CONFIGURED", async () => {
    const { resolveDefaultVisionModel } = await import("../ai-config/ai-config.service.js");
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: async () => [{
                modelRef: { id: "m-1", code: "text", enabled: true, capabilities: { text: true } },
                providerRef: { id: "p-1", enabled: true }
              }]
            })
          })
        })
      })
    };
    await expect(resolveDefaultVisionModel(db as never)).rejects.toMatchObject({
      code: "VISION_MODEL_NOT_CONFIGURED"
    });
    await expect(resolveDefaultVisionModel(db as never)).rejects.toBeInstanceOf(AiError);
  });

  it("优先 code=default_vision 的 vision 模型", async () => {
    const { pickDefaultVisionModelId } = await import("../ai-config/ai-config.service.js");
    expect(pickDefaultVisionModelId([
      { id: "m-high", code: "other", capabilities: { vision: true } },
      { id: "m-default", code: "default_vision", capabilities: { vision: true } }
    ])).toBe("m-default");
    expect(pickDefaultVisionModelId([
      { id: "m-text", code: "chat", capabilities: { text: true } }
    ])).toBeNull();
  });
});

describe("CHAT_IMAGE 不进入解析", () => {
  it("CHAT_IMAGE 跳过文档解析，其他用途仍解析", () => {
    expect(shouldEnqueueDocumentParse("CHAT_IMAGE")).toBe(false);
    expect(shouldEnqueueDocumentParse("GENERAL")).toBe(true);
    expect(shouldEnqueueDocumentParse(undefined)).toBe(true);
  });
});
