/**
 * 只读：A3-1 试点九档逐项核对（不写库、不生成规格/页码/optionId）。
 * 校验：快照数值 vs 原页图（人工已核）/ 逐层复算 / K=1/R0 / 身份唯一性。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 15 });
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
const canonical = value => (value ?? "").normalize("NFKC").replace(/\s/g, "").replace(/^外墙/i, "").toUpperCase();

const keyOf = system => [canonical(system.constructionCode) || canonical(system.systemName), canonical(system.baseMaterial),
  system.baseThicknessMm == null ? "" : String(system.baseThicknessMm), canonical(system.roofForm), canonical(system.placement)].join("|");
const fpOf = option => createHash("sha256").update(JSON.stringify([option.thicknessMm, option.productThermalResistance,
  option.totalThermalResistance, option.kValue, option.sourceRowLabel ?? null])).digest("hex").slice(0, 16);

const main = async () => {
  const out = { generatedAt: new Date().toISOString(), page: {}, layers: null, tiers: [], checks: {} };
  await sql.begin(async tx => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    const rows = await tx`
      SELECT p.id, p.page_number, p.page_label, p.page_label_source, p.page_label_verified, p.page_image_object_key,
             d.title, d.doc_number, v.id version_id, p.metadata->'confirmedStructuredData' data
      FROM knowledge_pages p
      JOIN knowledge_documents d ON d.id = p.document_id
      JOIN knowledge_document_versions v ON v.id = p.version_id
      WHERE v.status='PUBLISHED' AND d.current_version_id=v.id AND d.project_id IS NULL
        AND p.metadata->'confirmedStructuredData'->'systems' @> '[{"constructionCode":"A3-1"}]'::jsonb
      ORDER BY p.page_number`;
    out.pagesWithSameCode = rows.map(row => ({ pageId: row.id, physicalPage: row.page_number, storedLabel: row.page_label,
      systems: (row.data?.systems ?? []).filter(s => (s.constructionCode ?? "").includes("A3-1")).length,
      titles: [...new Set((row.data?.systems ?? []).map(s => s.systemName))] }));
    const page = rows.find(row => row.page_number === 5) ?? rows[0];
    const system = (page.data.systems ?? []).find(s => (s.constructionCode ?? "").includes("A3-1"));
    out.page = { pageId: page.id, physicalPage: page.page_number, storedLabel: page.page_label, labelSource: page.page_label_source,
      labelVerified: page.page_label_verified, document: page.title, docNumber: page.doc_number, versionId: page.version_id,
      hasConfirmedRevision: page.data?.schemaVersion === 2, pageTitle: page.data?.pageTitle,
      constructionKey: keyOf(system), specClass: system.specClass, baseMaterial: system.baseMaterial,
      baseThicknessMm: system.baseThicknessMm, systemName: system.systemName, imageKey: page.page_image_object_key };
    out.layers = (system.layers ?? []).map(layer => ({ order: layer.order, name: layer.name, thicknessMm: layer.thicknessMm,
      lambda: layer.lambda, alpha: layer.alpha, storedR: layer.rValue,
      computedR: layer.thicknessMm != null && layer.lambda ? round(layer.thicknessMm / 1000 / (layer.lambda * (layer.alpha ?? 1)), 6) : null }));
    const surface = 0.11 + 0.04;
    const fixedLayers = out.layers.filter(layer => layer.name !== "III型VICP复合保温板")
      .reduce((sum, layer) => sum + (layer.thicknessMm != null && layer.lambda ? layer.thicknessMm / 1000 / (layer.lambda * (layer.alpha ?? 1)) : 0), 0);
    out.checks.fixedLayerResistance = round(fixedLayers, 6);
    out.checks.surfaceResistance = surface;
    out.checks.expectedGap = round(fixedLayers + surface, 6);
    for (const option of system.options ?? []) {
      const thickness = Number(option.thicknessMm);
      const productR = Number(option.productThermalResistance);
      const totalR = Number(option.totalThermalResistance);
      const k = Number(option.kValue);
      const computedProductR = thickness / 1000 / (0.012 * 1.25);
      const predictedTotalR = computedProductR + fixedLayers + surface;
      out.tiers.push({ thicknessMm: thickness, productR, totalR, k, sourceRowLabel: option.sourceRowLabel ?? null,
        fingerprint: fpOf(option), computedProductR: round(computedProductR, 6),
        productRDelta: round(productR - computedProductR, 6),
        predictedTotalR: round(predictedTotalR, 6), totalRDelta: round(totalR - predictedTotalR, 6),
        kFromTotalR: round(1 / totalR, 6), kDelta: round(k - 1 / totalR, 6),
        identityKey: `${out.page.pageId}|${out.page.constructionKey}|${thickness}` });
    }
    const dup = await tx`SELECT p.id, p.page_number, jsonb_array_length(COALESCE(s->'options','[]'::jsonb)) n
      FROM knowledge_pages p JOIN knowledge_document_versions v ON v.id=p.version_id
      CROSS JOIN LATERAL jsonb_array_elements(p.metadata->'confirmedStructuredData'->'systems') s
      WHERE v.status='PUBLISHED' AND s->>'constructionCode' LIKE '%A3-1%'`;
    out.checks.sameCodeElsewhere = dup.filter(item => item.id !== page.id).map(item => ({ pageId: item.id, physicalPage: item.page_number, tiers: item.n }));
    out.checks.productionSpecs = await tx`SELECT s.spec_code, s.spec_class, s.thickness_mm, p.thermal_conductivity, p.correction_factor
      FROM product_specs s LEFT JOIN catalog_products p ON p.id = s.catalog_product_id
      WHERE s.status='PUBLISHED' ORDER BY s.spec_code`;
    out.checks.mismatchedLayers = out.layers.filter(layer => layer.storedR != null && layer.computedR != null
      && Math.abs(layer.storedR - layer.computedR) > 0.003).map(layer => ({ name: layer.name, thicknessMm: layer.thicknessMm,
        lambda: layer.lambda, storedR: layer.storedR, computedR: layer.computedR }));
  });
  await sql.end({ timeout: 3 });

  const jsonPath = resolve("docs/ai/evidence/phase5-2026-10-20/a31-pilot-audit.json");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");

  const lines = [
    "# A3-1 试点九档只读核对", "",
    `生成时间：${out.generatedAt}`, "",
    `- 页：物理 ${out.page.physicalPage}，库内标签 ${out.page.storedLabel}（来源 ${out.page.labelSource}）；文档《${out.page.document}》`,
    `- 构造：${out.page.systemName}；型号 ${out.page.specClass}；基层 ${out.page.baseMaterial} ${out.page.baseThicknessMm}mm；内容键 \`${out.page.constructionKey}\``,
    `- 快照指纹：${out.page.hasConfirmedRevision ? "有" : "无（schemaVersion 不是 2）"}`,
    `- 固定层热阻合计 ${out.checks.fixedLayerResistance}，内外表面 ${out.checks.surfaceResistance}，合计 ${out.checks.expectedGap}`,
    "", "| 厚度 | 产品R | R₀ | K | 复算产品R | ΔR | 复算R₀ | ΔR₀ | 1/R₀ | ΔK |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...out.tiers.map(tier => `| ${tier.thicknessMm} | ${tier.productR} | ${tier.totalR} | ${tier.k} | ${tier.computedProductR} | ${tier.productRDelta} | ${tier.predictedTotalR} | ${tier.totalRDelta} | ${tier.kFromTotalR} | ${tier.kDelta} |`),
    "", `- 逐层热阻与 t/(λ·α) 偏差 >0.003 的层：${out.checks.mismatchedLayers.map(layer => `${layer.name} 存 ${layer.storedR} / 算 ${layer.computedR}`).join("；") || "无"}`,
    `- 同编码出现在其它页：${out.checks.sameCodeElsewhere.map(item => `物理 ${item.physicalPage}（${item.tiers} 档）`).join("、") || "无"}`,
    `- 已发布目录规格：${out.checks.productionSpecs.map(spec => `${spec.spec_code} / ${spec.spec_class ?? "无型号"} / ${spec.thickness_mm}mm`).join("、") || "无"}`,
    ""
  ];
  const mdPath = jsonPath.replace(/\.json$/, ".md");
  writeFileSync(mdPath, lines.join("\n"), "utf8");
  console.log(JSON.stringify({ jsonPath, mdPath, tiers: out.tiers.length }, null, 1));
};

main().catch(async error => { console.error(error); await sql.end({ timeout: 3 }).catch(() => {}); process.exitCode = 1; });
