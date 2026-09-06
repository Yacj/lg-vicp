import "dotenv/config"; // 必须在导入服务前加载 env（服务顶层引用 env 配置）
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/errors.js";
import {
  assertFileNotReferenced,
  fileExtension,
  findReusableFile,
  previewCenterFile,
  type FileCenterItem
} from "./file-center.service.js";
import { FILE_CENTER_PERMISSIONS, FILE_CENTER_PERMISSION_SEEDS } from "../../shared/file-permissions.js";

vi.mock("./file-reference.service.js", () => ({
  getFileReferences: vi.fn(),
  getFileReferenceCount: vi.fn(),
  getFileReferenceCounts: vi.fn(async (_db: unknown, ids: string[]) => new Map(ids.map((id) => [id, 2]))),
  canRecycleFile: vi.fn(),
  requireActiveFileRow: vi.fn()
}));

const readyFile = {
  id: "file-1",
  sha256: "a".repeat(64),
  status: "READY" as const,
  mimeType: "application/pdf",
  objectKey: "users/u/file-1.pdf"
};

function stubDb(...results: Array<Array<Record<string, unknown>>>): any {
  let call = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => results[Math.min(call++, results.length - 1)]
          })
        })
      })
    })
  };
}

describe("文件中心扩展名解析", () => {
  it("返回小写扩展名（含点）", () => {
    expect(fileExtension("构造图集.PDF")).toBe(".pdf");
    expect(fileExtension("热工表.xlsx")).toBe(".xlsx");
  });

  it("无扩展名时返回 null", () => {
    expect(fileExtension("README")).toBeNull();
  });
});

describe("SHA-256 文件复用查找", () => {
  it("命中同哈希 READY 文件时返回该文件", async () => {
    const db = stubDb([{ id: "file-1", status: "READY" }]);
    const found = await findReusableFile({ db } as any, readyFile.sha256);
    expect(found).toMatchObject({ id: "file-1" });
  });

  it("无命中时返回 null（走正常上传）", async () => {
    const found = await findReusableFile({ db: stubDb([]) } as any, "b".repeat(64));
    expect(found).toBeNull();
  });
});

describe("文件预览模式", () => {
  const app = {
    storage: {
      createPreviewUrl: async (objectKey: string) => `https://signed/${objectKey}`
    }
  } as any;

  it("PDF/图片返回内联签名预览 URL", async () => {
    const pdf = await previewCenterFile(app, { ...readyFile, mimeType: "application/pdf" });
    expect(pdf.mode).toBe("INLINE");
    expect(pdf.url).toContain("https://signed/");

    const image = await previewCenterFile(app, { ...readyFile, mimeType: "image/png" });
    expect(image.mode).toBe("INLINE");
  });

  it("Word/CAD 等类型返回下载模式，不生成预览 URL", async () => {
    const word = await previewCenterFile(app, {
      ...readyFile,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    expect(word).toEqual({ mode: "DOWNLOAD" });

    const cad = await previewCenterFile(app, { ...readyFile, mimeType: "application/dxf" });
    expect(cad.mode).toBe("DOWNLOAD");
  });
});

describe("回收引用保护", () => {
  it("被业务引用时抛出 FILE_IN_USE，并附引用摘要", async () => {
    const { getFileReferences } = await import("./file-reference.service.js");
    vi.mocked(getFileReferences).mockResolvedValue([
      { bizType: "KNOWLEDGE", bizId: "doc-1", bizName: "VICP建筑构造图集", role: "ORIGINAL" }
    ] as never);
    const db = stubDb();

    await expect(assertFileNotReferenced({ db } as any, "file-1")).rejects.toMatchObject({
      code: "FILE_IN_USE",
      details: { errorCode: "FILE_IN_USE", references: [{ bizType: "KNOWLEDGE", role: "ORIGINAL" }] }
    });
    try {
      await assertFileNotReferenced({ db } as any, "file-1");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(400);
    }
  });

  it("无引用时允许回收", async () => {
    const { getFileReferences } = await import("./file-reference.service.js");
    vi.mocked(getFileReferences).mockResolvedValue([] as never);
    await expect(assertFileNotReferenced({ db: stubDb() } as any, "file-2")).resolves.toBeUndefined();
  });
});

describe("文件中心权限码", () => {
  it("查看/上传/管理使用独立权限码", () => {
    const codes = FILE_CENTER_PERMISSION_SEEDS.map((seed) => seed.code);
    expect(codes).toEqual([
      FILE_CENTER_PERMISSIONS.VIEW,
      FILE_CENTER_PERMISSIONS.UPLOAD,
      FILE_CENTER_PERMISSIONS.MANAGE
    ]);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("轻字段约束", () => {
  it("FileCenterItem 不含存储定位字段（bucket/objectKey/永久 URL）", () => {
    const item: FileCenterItem = {
      id: "file-1",
      originalName: "a.pdf",
      mimeType: "application/pdf",
      extension: ".pdf",
      sizeBytes: 1,
      status: "READY",
      source: "USER_UPLOAD",
      projectId: null,
      ownerUserId: "u1",
      uploaderName: "张三",
      sha256: "a".repeat(64),
      errorMessage: null,
      referenceCount: 0,
      recycledAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain("objectKey");
    expect(serialized).not.toContain("bucket");
    expect(item.referenceCount).toBe(0);
  });
});
