/**
 * 只读：正式候选资格就绪度审计。
 * 目标：在不写库的前提下，算清 890 档里哪些条件已满足、哪些缺身份/版本/绑定证据。
 * 约束：单事务 READ ONLY；不生成/不写 optionId、页码、规格。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });
const num = value => (value === null || value === undefined ? null : Number(value));
const canonical = value => (value ?? "").normalize("NFKC").replace(/\s/g, "").replace(/^外墙/i, "").toUpperCase();

function constructionKey(system) {
  const code = canonical(system.constructionCode);
  const base = canonical(system.baseMaterial);
  const thickness = system.baseThicknessMm == null ? "" : String(system.baseThicknessMm);
  const roof = canonical(system.roofForm);
  const placement = canonical(system.placement);
  const fallback = canonical(system.systemName ?? system.rawConstructionLabel);
  return [code || fallback, base, thickness, roof, placement].join("|");
}
const fingerprint = option => createHash("sha256").update(JSON.stringify([option.thicknessMm, option.productThermalResistance,
  option.totalThermalResistance, option.kValue, option.sourceRowLabel ?? null])).digest("hex").slice(0, 16);

const main = async () => {
  const out = { generatedAt: new Date().toISOString(), scope: "PUBLISHED + AI_ENABLED + ACTIVE + CURRENT_VERSION + GLOBAL" };
  await sql.begin(async tx => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    const pages = await tx`
      SELECT p.id page_id, p.page_number, p.page_label, p.page_label_source, p.page_label_verified,
             (p.page_image_object_key IS NOT NULL) has_image, d.id doc_id, d.title, d.doc_number,
             v.id version_id, v.version, v.status, p.metadata->'confirmedStructuredData' data
      FROM knowledge_pages p
      JOIN knowledge_documents d ON d.id = p.document_id
      JOIN knowledge_document_versions v ON v.id = p.version_id
      WHERE v.status='PUBLISHED' AND v.usage_mode='AI_ENABLED' AND d.status='ACTIVE' AND d.deleted_at IS NULL
        AND d.current_version_id = v.id AND d.project_id IS NULL
      ORDER BY p.page_number`;
    const labels = new Map();
    const keyIndex = new Map();
    const specClasses = new Map();
    const lambdaValues = new Map();
    const tiers = [];
    const constructionRows = [];
    let revisions = 0, pagesWithImage = 0, systems = 0;
    for (const page of pages) {
      if (page.data?.schemaVersion === 2) revisions += 1;
      if (page.has_image) pagesWithImage += 1;
      labels.set(page.page_label, (labels.get(page.page_label) ?? 0) + 1);
      for (const system of page.data?.systems ?? []) {
        systems += 1;
        const key = constructionKey(system);
        if (!keyIndex.has(key)) keyIndex.set(key, []);
        keyIndex.get(key).push({ pageId: page.page_id, pageLabel: page.page_label, code: system.constructionCode ?? null });
        const specClass = system.specClass ?? "(未声明)";
        specClasses.set(specClass, (specClasses.get(specClass) ?? 0) + 1);
        let productLambda = null;
        for (const layer of system.layers ?? []) {
          if (!/vicp|真空绝热|复合保温/i.test(layer.name ?? "")) continue;
          const lambda = num(layer.lambda);
          if (lambda == null) continue;
          lambdaValues.set(lambda, (lambdaValues.get(lambda) ?? 0) + 1);
          productLambda = productLambda ?? lambda;
        }
        constructionRows.push({ pageId: page.page_id, pageLabel: page.page_label, docNumber: page.doc_number,
          code: system.constructionCode ?? null, key, specClass: system.specClass ?? null,
          baseMaterial: system.baseMaterial ?? null, baseThicknessMm: num(system.baseThicknessMm),
          roofForm: system.roofForm ?? null, placement: system.placement ?? null,
          revision: page.data?.schemaVersion === 2 ? "V2" : "NONE", productLambda, options: (system.options ?? []).length });
        for (const option of system.options ?? []) {
          tiers.push({ pageId: page.page_id, pageLabel: page.page_label, versionId: page.version_id, docNumber: page.doc_number,
            key, code: system.constructionCode ?? null, specClass: system.specClass ?? null,
            thicknessMm: num(option.thicknessMm), productR: num(option.productThermalResistance),
            totalR: num(option.totalThermalResistance), k: num(option.kValue),
            sourceRowLabel: option.sourceRowLabel ?? null, hasFieldEvidence: Boolean(option.fieldEvidence),
            productLambda, specClassRaw: system.specClass ?? null,
            fingerprint: fingerprint(option), revisioned: page.data?.schemaVersion === 2 });
        }
      }
    }
    const duplicateKeys = [...keyIndex.entries()].filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({ key, count: list.length, pages: [...new Set(list.map(item => item.pageLabel))] }));
    const uniqueKeys = keyIndex.size;
    const duplicateLabels = [...labels.entries()].filter(([, count]) => count > 1).map(([label, count]) => ({ label, count }));
    const complete = tiers.filter(t => t.thicknessMm != null && t.productR != null && t.totalR != null && t.k != null);
    // 页内重复才是真冲突；跨页同编码属于不同页/不同系统，不能并成一条，也不能据此判重。
    const withinPage = new Map();
    for (const tier of tiers) {
      const key = `${tier.pageId}|${tier.key}|${tier.thicknessMm}`;
      withinPage.set(key, (withinPage.get(key) ?? 0) + 1);
    }
    const conflicts = tiers.filter(tier => (withinPage.get(`${tier.pageId}|${tier.key}|${tier.thicknessMm}`) ?? 0) > 1);
    const eligiblePage = tier => labels.get(tier.pageLabel) === 1
      && (withinPage.get(`${tier.pageId}|${tier.key}|${tier.thicknessMm}`) ?? 0) === 1;
    const identityOk = complete.filter(eligiblePage);
    const bindable = identityOk.filter(t => t.revisioned);
    const identityOnly = identityOk.filter(t => !t.revisioned);
    out.summary = {
      pages: pages.length, pagesWithImage, pagesWithRevision: revisions, systems, uniqueConstructionKeys: uniqueKeys,
      duplicateConstructionKeys: duplicateKeys.length, duplicatePageLabels: duplicateLabels,
      tiers: tiers.length, completeTiers: complete.length,
      withSourceRowLabel: tiers.filter(t => t.sourceRowLabel).length,
      withFieldEvidence: tiers.filter(t => t.hasFieldEvidence).length,
      specClasses: [...specClasses.entries()].sort((a, b) => b[1] - a[1]),
      productLambda: [...lambdaValues.entries()].sort((a, b) => b[1] - a[1]),
      withinPageConflicts: conflicts.length,
      typeLambdaCrosstab: [...new Map(constructionRows.map(row => [`${row.specClass ?? "未声明"}|${row.productLambda ?? "无"}`, {
        specClass: row.specClass ?? "未声明", lambda: row.productLambda ?? null,
        systems: constructionRows.filter(item => (item.specClass ?? "未声明") === (row.specClass ?? "未声明") && item.productLambda === row.productLambda).length,
        tiers: tiers.filter(tier => (tier.specClassRaw ?? "未声明") === (row.specClass ?? "未声明") && tier.productLambda === row.productLambda).length
      }])).values()].sort((a, b) => String(a.specClass).localeCompare(String(b.specClass)) || Number(b.systems) - Number(a.systems)),
      readiness: {
        L0_readable: tiers.length,
        L1_numericComplete: complete.length,
        L2_stableIdentityCandidate: identityOk.length,
        L2_withRevisionEvidence: bindable.length,
        L2_withoutRevisionEvidence: identityOnly.length,
        L3_candidateEligible: 0
      }
    };
    out.duplicateKeys = duplicateKeys.slice(0, 30);
    out.specClassSamples = [...specClasses.keys()].slice(0, 10);
    out.constructionSample = constructionRows.slice(0, 8);
    out.tierSample = tiers.slice(0, 8);
    // 同页同构造同厚度是否出现重复档位（物化唯一键会冲突的信号）
    const tierKey = new Map();
    for (const tier of tiers) {
      const key = `${tier.pageId}|${tier.key}|${tier.thicknessMm}`;
      tierKey.set(key, (tierKey.get(key) ?? 0) + 1);
    }
    out.duplicateTierKeys = [...tierKey.entries()].filter(([, count]) => count > 1).length;
  });
  await sql.end({ timeout: 3 });

  const jsonPath = resolve("docs/ai/evidence/phase5-2026-10-20/candidate-readiness.json");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  const s = out.summary, r = s.readiness;
  const lines = [
    "# 正式候选资格就绪度（只读）", "",
    `生成时间：${out.generatedAt}；范围：${out.scope}`, "",
    "## 总体", "",
    `- 页 ${s.pages}（有原图 ${s.pagesWithImage}；带快照指纹 ${s.pagesWithRevision}）`,
    `- 构造系统 ${s.systems}；内容键唯一 ${s.uniqueConstructionKeys}；重复键 ${s.duplicateConstructionKeys}`,
    `- 厚度档 ${s.tiers}；四项数值齐全 ${s.completeTiers}；有原表行标签 ${s.withSourceRowLabel}；有字段证据 ${s.withFieldEvidence}`,
    `- 型号分布：${s.specClasses.map(([name, count]) => `${name}×${count}`).join("、")}`,
    `- 产品层 λ 分布：${s.productLambda.map(([value, count]) => `${value}×${count}`).join("、")}`,
    "", "## 资格分级", "",
    `- L0 可读：${r.L0_readable}`,
    `- L1 数值齐全：${r.L1_numericComplete}`,
    `- L2 身份唯一（构造键唯一 + 页码唯一）：${r.L2_stableIdentityCandidate}`,
    `- L2 且有快照指纹：${r.L2_withRevisionEvidence}；无指纹：${r.L2_withoutRevisionEvidence}`,
    `- L3 正式候选（需规格/构造绑定）：${r.L3_candidateEligible}`,
    "", "## 型号 × 产品层 λ（决定能否自动绑定目录规格）", "",
    `- ${s.typeLambdaCrosstab.map(item => `${item.specClass} / λ=${item.lambda ?? "无"}：构造 ${item.systems}`).join("；")}`,
    "", "## 重复与冲突", "",
    `- 页内同构造同厚度冲突：${s.withinPageConflicts}`,,
    `- 重复页码标签：${s.duplicatePageLabels.map(item => `${item.label}×${item.count}`).join("、") || "无"}`,
    `- 同页同构造同厚度重复档位：${out.duplicateTierKeys}`,
    `- 重复构造键（前 30）：${out.duplicateKeys.map(item => `${item.key}（${item.pages.join("/")}）`).join("；") || "无"}`,
    ""
  ];
  const mdPath = jsonPath.replace(/\.json$/, ".md");
  writeFileSync(mdPath, lines.join("\n"), "utf8");
  console.log(JSON.stringify({ jsonPath, mdPath, summary: out.summary }, null, 1));
};

main().catch(async error => { console.error(error); await sql.end({ timeout: 3 }).catch(() => {}); process.exitCode = 1; });
