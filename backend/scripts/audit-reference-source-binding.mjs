#!/usr/bin/env node
/**
 * 只读校验：正式参考行的真实来源、字段完整度、与知识页档位的对应关系、缺项与冲突。
 * 约束：单事务 default_transaction_read_only；只 SELECT；不写库、不补造 optionId / 页码。
 * 输出：docs/ai/evidence/phase4-2026-10-20/reference-source-audit.json 与 .md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 未配置");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });
const num = (value) => (value === null || value === undefined ? null : Number(value));

async function readPublishedPages(tx) {
  return tx`
    SELECT p.id page_id, p.page_number, p.page_label, p.page_title, d.id doc_id, d.title doc_title, d.doc_number,
           v.id version_id, v.version,
           p.metadata->'confirmedStructuredData'->'systems' systems
    FROM knowledge_pages p
    JOIN knowledge_documents d ON d.id = p.document_id
    JOIN knowledge_document_versions v ON v.id = p.version_id
    WHERE v.status = 'PUBLISHED' AND v.usage_mode = 'AI_ENABLED' AND d.status = 'ACTIVE' AND d.deleted_at IS NULL
      AND d.current_version_id = v.id AND d.project_id IS NULL
    ORDER BY d.title, p.page_number`;
}

/** 只在内存中比对：不生成 optionId、不写回任何字段。 */
function diagnoseBinding(row, pages) {
  if (!row.source_page_id) return { status: "NO_SOURCE_PAGE", detail: "正式行未绑定任何知识页，无法对应档位" };
  const page = pages.find((item) => item.page_id === row.source_page_id);
  if (!page) return { status: "PAGE_NOT_READABLE", detail: "绑定的页不在当前已发布可读范围" };
  const schemes = (page.systems ?? []).filter((system) => {
    const code = (system.constructionCode ?? "").replace(/^外墙/, "").trim();
    return code && code === (row.scheme_code ?? "").replace(/^外墙/, "").trim();
  });
  if (!schemes.length) return { status: "NO_CONSTRUCTION_MATCH", detail: `页内无构造编码 ${row.scheme_code}` };
  const hits = schemes.flatMap((system) => (system.options ?? [])
    .map((option, index) => ({ index, thicknessMm: num(option.thicknessMm), kValue: num(option.kValue),
      productThermalResistance: num(option.productThermalResistance), totalThermalResistance: num(option.totalThermalResistance) }))
    .filter((option) => option.thicknessMm === num(row.thickness_mm)));
  if (!hits.length) return { status: "NO_THICKNESS_MATCH", detail: `页内 ${row.scheme_code} 无 ${row.thickness_mm}mm 档` };
  if (hits.length > 1) return { status: "AMBIGUOUS", detail: `同厚度命中 ${hits.length} 档，必须人工裁定`, hits };
  return { status: "UNIQUE_MATCH_UNVERIFIED", detail: "厚度唯一命中，但数值一致性仍需人工核对后才可声明绑定", hits };
}

const MAIN = async () => {
  const out = { generatedAt: new Date().toISOString(), database: (url.match(/@([^/]+)\//) ?? [])[1] ?? "unknown" };
  await sql.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    const pages = await readPublishedPages(tx);
    const rows = await tx`
      SELECT r.id row_id, r.thickness_mm, r.product_thermal_resistance, r.total_thermal_resistance, r.k_value,
             r.raw_thickness, r.raw_product_resistance, r.raw_total_resistance, r.raw_k_value,
             r.evidence_source, r.evidence_ref, r.evidence_level,
             r.source_document_id, r.source_page_id, r.source_page_label, r.sort_order,
             r.set_id, r.scheme_id, r.product_spec_id, r.catalog_product_id,
             s.code set_code, s.name set_name, s.version set_version, s.status set_status,
             s.atlas_document_id, s.effective_at, s.expires_at,
             sc.scheme_code, sc.name scheme_name, sc.status scheme_status, sc.atlas_page,
             ps.spec_code, ps.spec_class, ps.thickness_mm spec_thickness, ps.status spec_status,
             cp.name product_name, cp.status product_status
      FROM thermal_reference_rows r
      LEFT JOIN thermal_reference_sets s ON s.id = r.set_id
      LEFT JOIN construction_schemes sc ON sc.id = r.scheme_id
      LEFT JOIN product_specs ps ON ps.id = r.product_spec_id
      LEFT JOIN catalog_products cp ON cp.id = r.catalog_product_id
      ORDER BY r.sort_order`;
    out.rows = rows.map((row) => {
      const missing = [];
      if (!row.source_document_id) missing.push("source_document_id");
      if (!row.source_page_id) missing.push("source_page_id");
      if (!row.source_page_label) missing.push("source_page_label");
      if (!row.atlas_document_id) missing.push("atlas_document_id（参考集未声明图集文件）");
      if (!row.atlas_page) missing.push("atlas_page（构造未声明图集页）");
      if (!row.effective_at) missing.push("effective_at（参考集无生效时间）");
      const conflicts = [];
      if (num(row.thickness_mm) !== num(row.spec_thickness)) {
        conflicts.push(`行厚 ${row.thickness_mm}mm 与规格 ${row.spec_code} ${row.spec_thickness}mm 不一致`);
      }
      if (!row.spec_class) conflicts.push("规格未声明 spec_class（I/II 型）");
      return { ...row, missing, conflicts, binding: diagnoseBinding(row, pages) };
    });

    let systems = 0;
    const sys = { withCode: 0, withBaseMaterial: 0, withRawLabel: 0 };
    let options = 0;
    const opt = { thickness: 0, productR: 0, totalR: 0, k: 0, allFour: 0, withSpec: 0 };
    const thicknessHist = new Map();
    const codeHist = new Map();
    for (const page of pages) {
      for (const system of page.systems ?? []) {
        systems += 1;
        const code = (system.constructionCode ?? "").trim();
        if (code) sys.withCode += 1;
        if (system.baseMaterial) sys.withBaseMaterial += 1;
        if (system.rawConstructionLabel) sys.withRawLabel += 1;
        codeHist.set(code || "(空)", (codeHist.get(code || "(空)") ?? 0) + 1);
        for (const option of system.options ?? []) {
          options += 1;
          const t = num(option.thicknessMm), r = num(option.productThermalResistance);
          const r0 = num(option.totalThermalResistance), k = num(option.kValue);
          thicknessHist.set(t, (thicknessHist.get(t) ?? 0) + 1);
          if (t != null) opt.thickness += 1;
          if (r != null) opt.productR += 1;
          if (r0 != null) opt.totalR += 1;
          if (k != null) opt.k += 1;
          if (t != null && r != null && r0 != null && k != null) opt.allFour += 1;
          if (option.productSpecId) opt.withSpec += 1;
        }
      }
    }
    out.publishedScope = { pages: pages.length, documents: new Set(pages.map((page) => page.doc_id)).size, systems, sys, options, opt,
      thicknessHist: [...thicknessHist.entries()].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)),
      codeTop: [...codeHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15) };

    out.catalog = {
      products: await tx`SELECT id, name, product_type, spec_class, thermal_conductivity, correction_factor, thickness_options_mm, status FROM catalog_products`,
      specs: await tx`SELECT id, spec_code, spec_class, thickness_mm, version, status FROM product_specs`,
      schemes: await tx`SELECT scheme_code, name, status, atlas_page FROM construction_schemes`,
      links: (await tx`SELECT count(*)::int n FROM product_knowledge_links`)[0].n,
      facts: (await tx`SELECT count(*)::int n FROM knowledge_facts`)[0].n,
      standardLimits: (await tx`SELECT count(*)::int n FROM thermal_standard_limits`)[0].n,
      standardDocs: (await tx`SELECT count(*)::int n FROM standard_documents`)[0].n
    };

    out.pageLabelIssues = {
      mismatch: await tx`SELECT p.page_number, p.page_label, p.page_label_source, p.page_label_verified, d.title, v.status, v.version
        FROM knowledge_pages p JOIN knowledge_documents d ON d.id=p.document_id JOIN knowledge_document_versions v ON v.id=p.version_id
        WHERE p.page_label IS NOT NULL AND p.page_label <> p.page_number::text ORDER BY d.title, p.page_number`,
      duplicateInPublished: await tx`SELECT d.title, p.page_label, count(*)::int n, array_agg(p.page_number ORDER BY p.page_number) page_numbers
        FROM knowledge_pages p JOIN knowledge_documents d ON d.id=p.document_id JOIN knowledge_document_versions v ON v.id=p.version_id
        WHERE v.status='PUBLISHED' GROUP BY 1,2 HAVING count(*)>1 ORDER BY 1,2`
    };
  });
  await sql.end({ timeout: 3 });

  const jsonPath = resolve("docs/ai/evidence/phase4-2026-10-20/reference-source-audit.json");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");

  const scope = out.publishedScope;
  const lines = [
    "# 正式参考行 / 知识库档位 只读校验",
    "",
    `生成时间：${out.generatedAt}；数据库：${out.database}；事务：READ ONLY`,
    "",
    "## 一、正式参考行（thermal_reference_rows）",
    "",
    "| 行 | 厚度 | 产品R | 总R | K | 参考集 | 构造 | 规格 | 原页 | 缺失 | 冲突 | 页内对应 |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |",
    ...out.rows.map((row) => `| \`${row.row_id.slice(0, 8)}\` | ${row.thickness_mm}mm | ${row.product_thermal_resistance} | ${row.total_thermal_resistance} | ${row.k_value} | ${row.set_code} v${row.set_version}（${row.set_status}） | ${row.scheme_code} ${row.scheme_name} | ${row.spec_code}（${row.spec_thickness}mm） | ${row.source_page_label ?? "无"} | ${row.missing.join("；") || "—"} | ${row.conflicts.join("；") || "—"} | ${row.binding.status} |`),
    "",
    "## 二、已发布可读范围（79 页 / 1 文档）",
    "",
    `- 构造系统 ${scope.systems} 个：有构造编码 ${scope.sys.withCode} 个、有基层材料 ${scope.sys.withBaseMaterial} 个、有原始构造标签 ${scope.sys.withRawLabel} 个。`,
    `- 厚度档 ${scope.options} 条：厚度 ${scope.opt.thickness}、产品R ${scope.opt.productR}、总R ${scope.opt.totalR}、K ${scope.opt.k}、四项齐全 ${scope.opt.allFour}、带目录规格绑定 ${scope.opt.withSpec}。`,
    `- 厚度分布前 12：${scope.thicknessHist.slice(0, 12).map(([t, n]) => `${t}mm×${n}`).join("、")}。`,
    `- 构造编码前 15：${scope.codeTop.map(([code, n]) => `${code}×${n}`).join("、")}。`,
    "",
    "## 三、目录与授权事实",
    "",
    `- 目录产品 ${out.catalog.products.length} 款；规格 ${out.catalog.specs.length} 条；构造方案 ${out.catalog.schemes.length} 条。`,
    `- product_knowledge_links=${out.catalog.links}、knowledge_facts=${out.catalog.facts}、thermal_standard_limits=${out.catalog.standardLimits}、standard_documents=${out.catalog.standardDocs}。`,
    "",
    "## 四、页码身份异常",
    "",
    `- 页码与物理页不一致：${out.pageLabelIssues.mismatch.map((item) => `${item.title} 物理${item.page_number}→标签${item.page_label}（${item.status}）`).join("；") || "无"}`,
    `- 已发布范围内标签重复：${out.pageLabelIssues.duplicateInPublished.map((item) => `标签 ${item.page_label} 对应物理页 ${item.page_numbers.join("/")}`).join("；") || "无"}`,
    ""
  ];
  const mdPath = jsonPath.replace(/\.json$/, ".md");
  writeFileSync(mdPath, lines.join("\n"), "utf8");
  console.log(JSON.stringify({ jsonPath, mdPath, rows: out.rows.length, options: scope.options, complete: scope.opt.allFour }, null, 1));
};

MAIN().catch(async (error) => {
  console.error(error);
  await sql.end({ timeout: 3 }).catch(() => {});
  process.exitCode = 1;
});
