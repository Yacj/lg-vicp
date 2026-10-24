import "dotenv/config";
import postgres from "postgres";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { pageRecognitionResultSchema } from "../src/shared/page-recognition.js";
import { confirmedHeaderFingerprint } from "../src/shared/confirmed-source-table-headers.js";
import { buildKnowledgePageRenderModel } from "../src/shared/knowledge-page-render.js";
const directory = "docs/ai/evidence/table-header-repair-2026-10-19";
const docx = JSON.parse(await readFile(`${directory}/docx-headers.json`, "utf8"));
const visual = JSON.parse((await readFile(`${directory}/visual-header-review.json`, "utf8")).replace(/^\uFEFF/, ""));
const baseline = JSON.parse(await readFile("C:/Users/admin/xwechat_files/zhai579670_8a65/msg/file/2026-10/小格AI阶段03修复交接包-v3/03-AI修复交接/baseline/published-engineering-facts.json", "utf8"));
const db = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { options: "-c default_transaction_read_only=on -c statement_timeout=15000" } });
try {
  const [document] = await db`select d.id,d.current_version_id,v.status from knowledge_documents d join knowledge_document_versions v on v.id=d.current_version_id where d.id=${baseline.documents[0].id}`;
  assert.equal(document!.current_version_id, baseline.documents[0].current_version_id);
  assert.equal(document!.status, "PUBLISHED");
  assert.equal(document!.current_version_id, visual.sourceVersion);
  const pages = await db`select id,physical_page_number,metadata from knowledge_pages where version_id=${document!.current_version_id} order by physical_page_number`;
  const normalize = (value: string) => value.normalize("NFKC").replace(/[\s()（）]/g, "");
  const profiles = new Map<string, any>();
  const snapshots: any[] = [], reviewed: any[] = [], unmatched: any[] = [], titleMismatches: any[] = [];
  for (const page of pages) {
    const table = docx.tables.find((table: any) => table.table === page.physical_page_number);
    const checked = pageRecognitionResultSchema.safeParse(page.metadata?.confirmedStructuredData);
    if (!table || !checked.success) { unmatched.push({ page: page.physical_page_number, reason: "无对应原表或确认结构" }); continue; }
    const data = checked.data;
    const title = normalize(table.title);
    const titleMatched = normalize(data.pageTitle ?? "") === title || normalize(data.fullText.slice(0, 600)).includes(title);
    if (!titleMatched) {
      const mismatch = { page: page.physical_page_number, reason: "确认标题与DOCX对应原表不一致", sourceTitle: table.title, confirmedTitle: data.pageTitle };
      titleMismatches.push(mismatch);
      const review = visual.reviews.find((item: any) => item.page === page.physical_page_number && item.sourceTitle === table.title && item.confirmedTitle === data.pageTitle);
      if (!review) { unmatched.push(mismatch); continue; }
      const imageHash = createHash("sha256").update(await readFile(`${directory}/source-images/table-${page.physical_page_number}.png`)).digest("hex");
      assert.equal(imageHash, review.imageSha256, "人工核对的原图已变化，必须重新核验");
    }
    const [top, bottom] = table.headerRows;
    assert.equal(top.length, 8);
    const split = (value: string) => { const match = /^([^[(]+)([[(].*)?$/.exec(value)!; return { label: match[1]!.trim(), unit: match[2] ?? "" }; };
    // 第66表DOCX将两个子列标题存入一个合并单元格；只接受这条已核对的完整字面格式。
    const merged = bottom.length === 8;
    if (merged) assert.equal(bottom[7], "传热阻R       传热系数K[(m² ·K)/W]  [W/(m² ·K)]");
    const total = merged ? { label: "传热阻R", unit: "[(m² ·K)/W]" } : split(bottom[7]);
    const k = merged ? { label: "传热系数K", unit: "[W/(m² ·K)]" } : split(bottom[8]);
    const profile = { tableHeaders: { identifier: top[0], diagram: top[1], layers: top[2] }, columns: [
      { fieldKey: "thicknessMm", ...split(top[3]), scope: "UNKNOWN" },
      { fieldKey: "lambda", ...split(top[4]), scope: "LAYER" },
      { fieldKey: "alpha", ...split(top[5]), scope: "LAYER" },
      { fieldKey: "rValue", ...split(top[6]), scope: "LAYER" },
      { fieldKey: "productThermalResistance", ...split(top[6]), scope: "UNKNOWN" },
      { fieldKey: "totalThermalResistance", ...total, groupLabel: top[7], scope: "CONSTRUCTION" },
      { fieldKey: "kValue", ...k, groupLabel: top[7], scope: "CONSTRUCTION" },
    ] };
    const id = createHash("sha256").update(JSON.stringify(profile)).digest("hex").slice(0, 16);
    profiles.set(id, { id, ...profile });
    const fingerprint = confirmedHeaderFingerprint(data);
    const existing = snapshots.find(item => item.fingerprint === fingerprint);
    assert(!existing || existing.profileId === id, "同内容不能绑定冲突的原表头");
    if (!existing) snapshots.push({ fingerprint, profileId: id, table: table.table });
    reviewed.push({ page: page.physical_page_number, sourceTable: table.table, fingerprint, profileId: id, titleMatched, method: titleMatched ? "DOCX_TITLE_AND_CONFIRMED_SNAPSHOT" : "VISUAL_SOURCE_IMAGE_AND_DOCX" });
  }
  for (const number of [5, 6, 33]) assert(reviewed.some(row => row.page === number), `缺少当前修复原表${number}`);
  assert.equal(pages.length, 79, "当前版本页数变化，先重新核验原表对应关系");
  assert.equal(unmatched.length, 0, "存在未核验页，不发布部分表头映射");
  const asset = { sourceSha256: docx.docxSha256, profiles: [...profiles.values()], snapshots };
  await writeFile("src/shared/source-table-header-audits.json", JSON.stringify(asset, null, 2));
  await writeFile(`${directory}/source-header-audit.json`, JSON.stringify({ sourceMode: "READ_ONLY", sourceSha256: docx.docxSha256, pageCount: pages.length, reviewed, unmatched, titleMismatches, definitions: profiles.size }, null, 2));
  const fixtures = pages.filter(page => [5, 33, 77].includes(page.physical_page_number)).map(page => ({ pageId: page.id, physicalPageNumber: page.physical_page_number, data: pageRecognitionResultSchema.parse(page.metadata.confirmedStructuredData) }));
  await writeFile("tests/fixtures/source-table-headers.json", JSON.stringify({ sourceSha256: docx.docxSha256, pages: fixtures }, null, 2));
  await writeFile("../app/src/test/fixtures/sourceTableHeaders.json", JSON.stringify(fixtures.map(page => ({ physicalPageNumber: page.physicalPageNumber, renderModel: buildKnowledgePageRenderModel(page.pageId, page.data) })), null, 2));
  console.log(JSON.stringify({ reviewed: reviewed.length, unmatched: unmatched.length, profiles: profiles.size }));
} finally { await db.end({ timeout: 2 }); }
