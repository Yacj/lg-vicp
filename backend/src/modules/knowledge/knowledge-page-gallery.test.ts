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

import { AppError } from "../../shared/errors.js";
import { createManualPage } from "./knowledge-page-gallery.service.js";

describe("knowledge page gallery pageCount", () => {
  it("create/delete 事务同步 pageCount；reorder 注释声明不改 count", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./knowledge-page-gallery.service.ts", import.meta.url), "utf8")
    );
    expect(source).toContain("async function syncVersionPageCount");
    expect(source).toContain("await syncVersionPageCount(tx, versionId)");
    expect(source).toContain("排序只改 pageNumber，不改变 pageCount");
    expect(source).toContain("pageCountUnchanged: true");

    const createIdx = source.indexOf("export async function createManualPage");
    const reorderIdx = source.indexOf("export async function reorderManualPages");
    const deleteIdx = source.indexOf("export async function deleteManualPage");
    expect(createIdx).toBeGreaterThan(-1);
    expect(reorderIdx).toBeGreaterThan(createIdx);
    expect(deleteIdx).toBeGreaterThan(reorderIdx);

    const createBody = source.slice(createIdx, reorderIdx);
    const reorderBody = source.slice(reorderIdx, deleteIdx);
    const deleteBody = source.slice(deleteIdx);
    expect(createBody).toContain("syncVersionPageCount(tx, versionId)");
    expect(deleteBody).toContain("syncVersionPageCount(tx, versionId)");
    expect(reorderBody).not.toContain("syncVersionPageCount(");
  });

  it("导出人工页面增删排序接口", async () => {
    const mod = await import("./knowledge-page-gallery.service.js");
    expect(typeof mod.createManualPage).toBe("function");
    expect(typeof mod.deleteManualPage).toBe("function");
    expect(typeof mod.reorderManualPages).toBe("function");
  });
});
