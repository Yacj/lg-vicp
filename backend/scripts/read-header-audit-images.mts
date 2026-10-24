import "dotenv/config";
import postgres from "postgres";
import OSS from "ali-oss";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const directory = "docs/ai/evidence/table-header-repair-2026-10-19";
const audit = JSON.parse(await readFile(`${directory}/source-header-audit.json`, "utf8"));
const visual = JSON.parse((await readFile(`${directory}/visual-header-review.json`, "utf8")).replace(/^\uFEFF/, ""));
const baseline = JSON.parse(await readFile("C:/Users/admin/xwechat_files/zhai579670_8a65/msg/file/2026-10/小格AI阶段03修复交接包-v3/03-AI修复交接/baseline/published-engineering-facts.json", "utf8"));
const db = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 5, connection: { options: "-c default_transaction_read_only=on" } });
const storage = new OSS({ region: process.env.OSS_REGION, bucket: process.env.STORAGE_BUCKET, accessKeyId: process.env.STORAGE_ACCESS_KEY!, accessKeySecret: process.env.STORAGE_SECRET_KEY!, secure: true, endpoint: process.env.OSS_ENDPOINT || undefined });
await mkdir(`${directory}/source-images`, { recursive: true });
try {
  for (const item of [...new Map([...audit.unmatched, ...visual.reviews].map(item => [item.page, item])).values()]) {
    const [page] = await db`select page_image_object_key from knowledge_pages where version_id=${baseline.documents[0].current_version_id} and physical_page_number=${item.page}`;
    if (!page?.page_image_object_key) throw new Error(`原表${item.page}没有原图，不补造核验`);
    const result = await storage.get(page.page_image_object_key);
    await writeFile(`${directory}/source-images/table-${item.page}.png`, result.content);
    console.log(`只读取得原表 ${item.page}`);
  }
} finally { await db.end({ timeout: 2 }); }
