import "dotenv/config";
import postgres from "postgres";
import OSS from "ali-oss";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { confirmedHeaderFingerprint } from "../src/shared/confirmed-source-table-headers.js";
import { pageRecognitionResultSchema } from "../src/shared/page-recognition.js";
const directory = "docs/ai/evidence/full-chain-uat-2026-10-19/source-review";
await mkdir(directory, { recursive: true });
const db = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 5, connection: { options: "-c default_transaction_read_only=on" } });
const storage = new OSS({ region: process.env.OSS_REGION, bucket: process.env.STORAGE_BUCKET, accessKeyId: process.env.STORAGE_ACCESS_KEY!, accessKeySecret: process.env.STORAGE_SECRET_KEY!, endpoint: process.env.OSS_ENDPOINT || undefined, secure: true });
try {
  const rows = await db`select p.id,p.version_id,p.physical_page_number,p.page_label,p.page_label_source,p.page_label_verified,p.page_image_object_key,p.metadata from knowledge_pages p join knowledge_documents d on d.id=p.document_id and d.current_version_id=p.version_id where p.version_id=${"b93a1099-4f32-45b4-8683-b3a3ef5bb64e"} and p.physical_page_number in (3,5,6,33) order by p.physical_page_number`;
  const results = [];
  for (const page of rows) {
    const data = pageRecognitionResultSchema.parse(page.metadata.confirmedStructuredData);
    const image = await storage.get(page.page_image_object_key);
    await writeFile(`${directory}/page-${page.physical_page_number}.png`, image.content);
    results.push({ pageId: page.id, versionId: page.version_id, physical: page.physical_page_number, recordedLabel: page.page_label,
      recordedLabelSource: page.page_label_source, recordedLabelVerified: page.page_label_verified, fingerprint: confirmedHeaderFingerprint(data),
      imageObjectKey: page.page_image_object_key, imageSha256: createHash("sha256").update(image.content).digest("hex"), title: data.pageTitle,
      sourceExcerpt: data.fullText.slice(-700), systems: data.systems.map(system => ({ name: system.systemName, code: system.constructionCode, layers: system.layers, options: system.options })) });
  }
  await writeFile(`${directory}/source-pages.json`, JSON.stringify({ sourceMode: "READ_ONLY", pages: results }, null, 2));
  console.log(JSON.stringify({ downloaded: results.map(row => row.physical), sourceMode: "READ_ONLY" }));
} finally { await db.end({ timeout: 2 }); }
