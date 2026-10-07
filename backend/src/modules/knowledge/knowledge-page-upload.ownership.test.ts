import "dotenv/config";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { files, knowledgeDocumentVersions, knowledgePages } from "../../db/schema.js";
import { batchUploadVersionPages, importVersionPagesFromZip } from "./knowledge-page-upload.service.js";

function pngFixture() {
  const png = Buffer.alloc(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12);
  png.writeUInt32BE(1400, 16);
  png.writeUInt32BE(900, 20);
  return png;
}

describe("batch page image asset ownership", () => {
  it("copies temporary File bytes to a knowledge-owned object key", async () => {
    const image = pngFixture();
    const uploaded: Array<{ key: string; bytes: Buffer; mime: string }> = [];
    let selectCount = 0;
    let insertedPage: Record<string, unknown> | null = null;
    const app: any = {
      db: {
        select: () => {
          const current = ++selectCount;
          const query: any = {
            from: () => query,
            where: () => query,
            limit: async () => {
              if (current === 1) return [{ id: "version-1", documentId: "doc-1", status: "DRAFT" }];
              if (current === 3) return [{
                id: "file-1", status: "READY", mimeType: "image/png", sizeBytes: image.length,
                objectKey: "temporary/file.png", originalName: "page-001.png"
              }];
              return [];
            },
            then: (resolve: (value: unknown) => void) => resolve([{ maxPhysical: 0 }])
          };
          return query;
        },
        insert: (table: unknown) => ({
          values: (values: Record<string, unknown>) => ({
            returning: async () => {
              if (table === knowledgePages) {
                insertedPage = { ...values, id: "page-1" };
                return [insertedPage];
              }
              return [];
            }
          })
        }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
        transaction: async (callback: (tx: any) => Promise<unknown>) => callback(app.db)
      },
      storage: {
        getObject: vi.fn(async (key: string) => {
          expect(key).toBe("temporary/file.png");
          return image;
        }),
        putObject: vi.fn(async (key: string, bytes: Buffer, mime: string) => {
          uploaded.push({ key, bytes, mime });
        }),
        removeObject: vi.fn(async () => undefined)
      },
      queues: { pageRecognition: { add: vi.fn(async () => undefined) } }
    };

    await batchUploadVersionPages(app, { headers: {} } as any, { id: "user-1" } as any, "version-1", [
      { fileId: "file-1", physicalPageNumber: 1 }
    ], { enqueueRecognition: false });

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({
      key: expect.stringMatching(/^knowledge\/page-images\/doc-1\/version-1\/p1-/),
      bytes: image,
      mime: "image/png"
    });
    expect(insertedPage?.pageImageObjectKey).toBe(uploaded[0]!.key);
    expect(insertedPage?.pageImageObjectKey).not.toBe("temporary/file.png");
  });

  it("rejects duplicate physical page numbers before creating page image objects", async () => {
    const image = pngFixture();
    let selectCount = 0;
    const app: any = {
      db: {
        select: () => {
          const query: any = {
            from: (table: unknown) => { query.table = table; return query; },
            where: () => query,
            limit: async () => {
              selectCount += 1;
              if (query.table === knowledgeDocumentVersions) return [{ id: "version-1", documentId: "doc-1", status: "DRAFT" }];
              if (query.table === files) return [{ id: "file-1", status: "READY", mimeType: "image/png", sizeBytes: image.length, objectKey: "temporary/file.png", originalName: "page-001.png" }];
              return [];
            },
            then: (resolve: (value: unknown) => void) => resolve([{ maxPhysical: 0 }])
          };
          return query;
        }
      },
      storage: { getObject: vi.fn(async () => image), putObject: vi.fn(), removeObject: vi.fn() }
    };
    await expect(batchUploadVersionPages(
      app, { headers: {} } as any, { id: "user-1" } as any, "version-1",
      [{ fileId: "file-1", physicalPageNumber: 8 }, { fileId: "file-1", physicalPageNumber: 8 }],
      { enqueueRecognition: false }
    )).rejects.toMatchObject({ code: "DUPLICATE_PHYSICAL_PAGE_NUMBER", statusCode: 400 });
    expect(app.storage.putObject).not.toHaveBeenCalled();
  });

  it("cleans newly written page objects when the database transaction fails", async () => {
    const image = pngFixture();
    let selectCount = 0;
    let insertedPages = 0;
    const db: any = {
      select: () => {
        const query: any = {
          from: (table: unknown) => { query.table = table; return query; },
          where: () => query,
          limit: async () => {
            selectCount += 1;
            if (query.table === knowledgeDocumentVersions) return [{ id: "version-1", documentId: "doc-1", status: "DRAFT" }];
            if (query.table === files) return [{ id: `file-${selectCount}`, status: "READY", mimeType: "image/png", sizeBytes: image.length, objectKey: `temporary/${selectCount}.png`, originalName: `page-${selectCount}.png` }];
            return [];
          },
          then: (resolve: (value: unknown) => void) => resolve([{ maxPhysical: 0 }])
        };
        return query;
      },
      transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
        insert: () => ({ values: () => ({ returning: async () => {
          insertedPages += 1;
          if (insertedPages === 2) throw new Error("simulated second-page database failure");
          return [{ id: "page-1" }];
        } }) }),
        update: () => ({ set: () => ({ where: async () => undefined }) })
      })
    };
    const uploaded: string[] = [];
    const removed: string[] = [];
    const app: any = {
      db,
      storage: {
        getObject: vi.fn(async () => image),
        putObject: vi.fn(async (key: string) => { uploaded.push(key); }),
        removeObject: vi.fn(async (key: string) => { removed.push(key); })
      }
    };
    await expect(batchUploadVersionPages(
      app, { headers: {} } as any, { id: "user-1" } as any, "version-1",
      [{ fileId: "file-1", physicalPageNumber: 1 }, { fileId: "file-2", physicalPageNumber: 2 }],
      { enqueueRecognition: false }
    )).rejects.toThrow("simulated second-page database failure");
    expect(insertedPages).toBe(2);
    expect(uploaded).toHaveLength(2);
    expect(removed).toEqual(uploaded);
  });

  it("cleans ZIP page objects when the second page write fails", async () => {
    const image = pngFixture();
    const zipBytes = Buffer.from(zipSync({
      "manifest.json": strToU8(JSON.stringify([
        { file: "page-1.png", physicalPageNumber: 1 },
        { file: "page-2.png", physicalPageNumber: 2 }
      ])),
      "page-1.png": image,
      "page-2.png": image
    }));
    const db: any = {
      select: () => {
        let table: unknown;
        const query: any = {
          from: (value: unknown) => { table = value; return query; },
          where: () => query,
          limit: async () => table === knowledgeDocumentVersions
            ? [{ id: "version-1", documentId: "doc-1", status: "DRAFT" }]
            : table === files
              ? [{ id: "zip-1", status: "READY", mimeType: "application/zip", sizeBytes: zipBytes.length, objectKey: "temporary/pages.zip", originalName: "pages.zip" }]
              : []
        };
        return query;
      },
      transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
        insert: () => ({ values: () => ({ returning: async () => {
          insertedPages += 1;
          if (insertedPages === 2) throw new Error("simulated second-page ZIP write failure");
          return [{ id: "page-1" }];
        } }) }),
        update: () => ({ set: () => ({ where: async () => undefined }) })
      })
    };
    let insertedPages = 0;
    const uploaded: string[] = [];
    const removed: string[] = [];
    const app: any = {
      db,
      storage: {
        getObject: vi.fn(async () => zipBytes),
        putObject: vi.fn(async (key: string) => { uploaded.push(key); }),
        removeObject: vi.fn(async (key: string) => { removed.push(key); })
      }
    };
    await expect(importVersionPagesFromZip(
      app, { headers: {} } as any, { id: "user-1" } as any, "version-1", "zip-1", { enqueueRecognition: false }
    )).rejects.toThrow("simulated second-page ZIP write failure");
    expect(insertedPages).toBe(2);
    expect(uploaded).toHaveLength(2);
    expect(removed).toEqual(uploaded);
  });
});
