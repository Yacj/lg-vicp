import "dotenv/config";
import postgres from "postgres";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { pageRecognitionResultSchema } from "../../src/shared/page-recognition.js";
import { confirmedHeaderFingerprint } from "../../src/shared/confirmed-source-table-headers.js";
const out=process.argv[2]!;
const environment=JSON.parse(await readFile(`${out}/environment.json`,"utf8"));
assert.match(environment.databaseName,/^vicp_h5_uat_[a-f0-9]{32}$/);
const url=new URL(process.env.AI_UAT_DATABASE_ADMIN_URL||process.env.DATABASE_URL!);url.pathname=`/${environment.databaseName}`;
const db=postgres(url.toString(),{max:1,connection:{options:"-c default_transaction_read_only=on"}});
try {
  const audit=JSON.parse(await readFile("src/shared/confirmed-page-source-audits.json","utf8"));
  const rows=await db`select id,version_id,physical_page_number,metadata from knowledge_pages where version_id='b93a1099-4f32-45b4-8683-b3a3ef5bb64e' and physical_page_number in (3,5,6,25,33,53) order by physical_page_number`;
  assert.equal(rows.length,6);
  const pages=rows.map(row=>{const data=pageRecognitionResultSchema.parse(row.metadata.confirmedStructuredData);
    const record=audit.records.find((item:any)=>item.pageId===row.id&&item.versionId===row.version_id);
    assert.equal(confirmedHeaderFingerprint(data),record.fingerprint);
    return {pageId:row.id,physicalPageNumber:row.physical_page_number,data};});
  await writeFile("tests/fixtures/confirmed-source-page-labels.json",JSON.stringify({source:"当前已发布确认页的只读复制，六页均经客户DOCX核对的确认内容指纹验证",versionId:rows[0]!.version_id,pages},null,2));
  console.log(JSON.stringify({pages:pages.map(page=>page.physicalPageNumber),fingerprintsVerified:true,sourceWrites:0}));
}finally{await db.end({timeout:2});}
