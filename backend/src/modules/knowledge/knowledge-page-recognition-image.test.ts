import "dotenv/config";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { getPageRecognition } from "./knowledge-page-recognition.service.js";
import { knowledgeDocumentVersions, knowledgePages } from "../../db/schema.js";

it.each([false, true])("B端原图签名失败=%s仍返回确认表格，重试可重新签名且不改确认事实", async failure => {
  const data = JSON.parse(readFileSync(new URL("../../../tests/fixtures/complex-atlas/page-90.json", import.meta.url), "utf8")).data;
  const metadata = { recognitionStatus: "CONFIRMED", confirmedStructuredData: data, imageWarnings: ["原有提示"] };
  const before = structuredClone(metadata);
  const page = { id: "page", documentId: "document", versionId: "version", pageImageObjectKey: "isolated/source.png", pageLabel: "90", physicalPageNumber: 2, metadata };
  const select = () => ({ from: (table: unknown) => ({ where: () => {
    const rows = table === knowledgePages ? [page] : table === knowledgeDocumentVersions ? [{ id: "version", status: "PUBLISHED" }] : [];
    return Object.assign(Promise.resolve(rows), { limit: async () => rows });
  } }) });
  const sign = vi.fn().mockResolvedValue("https://authorized.invalid/image");
  if (failure) sign.mockRejectedValueOnce(new Error("private-storage-secret"));
  const app: any = { db: { select }, storage: { createDownloadUrl: sign }, log: { warn: vi.fn() } };
  const result = await getPageRecognition(app, "page");
  expect(result.renderModel?.constructions).toHaveLength(2); expect(result.confirmedStructuredData).toEqual(data);
  expect(result.pageImageUrl).toBe(failure ? null : "https://authorized.invalid/image");
  if (failure) { expect(result.imageWarnings.join(" ")).toContain("保留确认表格"); expect(JSON.stringify(result)).not.toContain("private-storage-secret"); }
  expect(metadata).toEqual(before);
  const retried = await getPageRecognition(app, "page");
  expect(retried.pageImageUrl).toBe("https://authorized.invalid/image"); expect(sign).toHaveBeenCalledTimes(2);
});
