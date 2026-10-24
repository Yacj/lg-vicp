import "dotenv/config";
import postgres from "postgres";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { pageRecognitionResultSchema } from "../../src/shared/page-recognition.js";
import { confirmedHeaderFingerprint } from "../../src/shared/confirmed-source-table-headers.js";
const root = "docs/ai/evidence/full-chain-uat-2026-10-19";
const footer = JSON.parse(await readFile(`${root}/source-review/docx-footers.json`, "utf8"));
const header = JSON.parse(await readFile("src/shared/source-table-header-audits.json", "utf8"));
const reviewed = JSON.parse(await readFile("docs/ai/evidence/table-header-repair-2026-10-19/source-header-audit.json", "utf8"));
const before = JSON.parse(await readFile("src/shared/confirmed-page-source-audits.json", "utf8"));
const versionId = "b93a1099-4f32-45b4-8683-b3a3ef5bb64e";
const db = postgres(process.env.DATABASE_URL!, { max: 1, connection: { options: "-c default_transaction_read_only=on" } });
try {
  const pages = await db`select id,version_id,physical_page_number,page_label,metadata from knowledge_pages where version_id=${versionId} order by physical_page_number`;
  assert.equal(pages.length, 79); assert.equal(footer.length, 79); assert.equal(reviewed.unmatched.length, 0);
  const records = pages.map(page => {
    const source = footer.find((item: any) => item.table === page.physical_page_number);
    const checked = reviewed.reviewed.find((item: any) => item.page === page.physical_page_number && item.sourceTable === source.table);
    const fingerprint = confirmedHeaderFingerprint(pageRecognitionResultSchema.parse(page.metadata.confirmedStructuredData));
    assert.equal(checked.fingerprint, fingerprint); assert(header.snapshots.some((item: any) => item.fingerprint === fingerprint && item.table === source.table));
    const cells = source.tailRows.flat();
    assert.equal(cells.filter((cell: string) => cell === "页次").length, 1);
    const printedLabel = cells[cells.indexOf("页次") + 1]?.trim() || null;
    assert(printedLabel === null || /^\d+$/.test(printedLabel));
    const visual = before.records.find((item: any) => item.pageId === page.id);
    if (visual) assert.equal(visual.printedLabel, printedLabel);
    return { ...(visual ?? {}), pageId: page.id, versionId, fingerprint, printedLabel, recordedLabel: page.page_label,
      method: visual?.method ?? "DOCX_TABLE_FOOTER_AND_CONFIRMED_SNAPSHOT",
      sourceSha256: header.sourceSha256, sourceTable: source.table,
      issues: [...(visual?.issues ?? []), ...(!checked.titleMatched ? ["确认标题与客户原表标题不一致，未改写确认记录；请结合原图核对构造名称。"] : [])] };
  });
  await writeFile("src/shared/confirmed-page-source-audits.json", JSON.stringify({ sourceSha256: header.sourceSha256, records }, null, 2));
  await writeFile(`${root}/source-review/page-label-audit.json`, JSON.stringify({ sourceMode: "READ_ONLY", matchedTables: 79, unverifiedPrintedPages: records.filter(row => row.printedLabel === null).map(row => row.sourceTable), records }, null, 2));
  console.log(JSON.stringify({ audited: records.length, blankFooters: records.filter(row => row.printedLabel === null).map(row => row.sourceTable), databaseWrites: 0 }));
} finally { await db.end() }
