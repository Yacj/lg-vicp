import "dotenv/config";
import { describe, expect, it } from "vitest";
import { createManualPage } from "./knowledge-page-gallery.service.js";

function makeApp(mimeType: string) {
  let selectCount = 0;
  const db: any = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCount += 1;
            if (selectCount === 1) return [{ id: "version-1", documentId: "doc-1", status: "DRAFT" }];
            if (selectCount === 2) return [];
            return [{ id: "file-1", status: "READY", mimeType, objectKey: "pages/page-1.png" }];
          },
          orderBy: async () => []
        })
      })
    }),
    insert: () => ({
      values: () => ({ returning: async () => [{ id: "page-1", pageNumber: 1 }] })
    }),
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
      insert: db.insert,
      select: () => ({ from: () => ({ where: async () => [{ value: 1 }] }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) })
    })
  };
  return {
    db,
    storage: {
      getObject: async () => mimeType === "image/png"
        ? (() => {
          const png = Buffer.alloc(33);
          png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
          png.writeUInt32BE(13, 8);
          png.write("IHDR", 12);
          png.writeUInt32BE(1, 16);
          png.writeUInt32BE(1, 20);
          return png;
        })()
        : Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
      putObject: async () => undefined,
      removeObject: async () => undefined
    },
    // writeAuditLog 需要可调用；mime 测试不关心审计内容
  } as any;
}

describe("知识页图片 MIME 校验", () => {
  for (const mimeType of ["image/png", "image/jpeg"]) {
    it(`允许 ${mimeType}`, async () => {
      const page = await createManualPage(makeApp(mimeType), { headers: {} } as any, { id: "u-1" } as any, "version-1", {
        pageNumber: 1,
        imageFileId: "file-1"
      });
      expect(page).toBeDefined();
    });
  }

  for (const mimeType of ["image/webp", "image/gif", "image/svg+xml"]) {
    it(`拒绝 ${mimeType}`, async () => {
      await expect(createManualPage(
        makeApp(mimeType),
        { headers: {} } as any,
        { id: "u-1" } as any,
        "version-1",
        { pageNumber: 1, imageFileId: "file-1" }
      )).rejects.toMatchObject({ code: "INVALID_PAGE_IMAGE", statusCode: 400 });
    });
  }
});
