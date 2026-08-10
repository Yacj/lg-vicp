#!/usr/bin/env node
// ============================================================
// 材料对比规则引擎批量导入示例：版本 + 材料 + 规则 + 证据
//
// - 所有记录落 DRAFT（version=1），随后走正常审核发布流程
//   （submit -> approve -> publish），不绕过状态机；
// - 同一版本 code 已存在时跳过（幂等）；
// - 示例数值/型号/密度/测试条件均为占位符，标注"待甲方确认"，
//   正式数据需甲方提供并经 B 端审核后发布；
// - 打印每条记录 id 与下一步工作流端点，作为前端/脚本接入参考。
//
// 用法：pnpm comparison:import-example
// ============================================================
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const now = new Date();
const createdBy = null; // 脚本导入无登录用户，审核列留空，由后台流程补齐

const info = (msg) => console.log(`[材料对比示例] ${msg}`);

const VERSION_CODE = "VICP-VS-COMPETITORS-2026";

const main = async () => {
  try {
    // ---------------------------------------------------------------- 版本（DRAFT v1）
    let [version] = await sql`select id from comparison_versions where code = ${VERSION_CODE} and version = 1 limit 1`;
    if (version) {
      info(`版本 ${VERSION_CODE} v1 已存在（id=${version.id}），复用`);
    } else {
      [version] = await sql`
        insert into comparison_versions
          (code, version, name, description, change_note,
           evidence_source, evidence_ref, evidence_level, effective_at, expires_at,
           status, created_by_id, updated_by_id, created_at, updated_at)
        values
          (${VERSION_CODE}, 1, 'VICP 对比竞品（示例，待甲方确认）',
           '示例导入：VICP 与 EPS/XPS/岩棉/聚氨酯/传统一体板对比占位数据，数值全部待甲方确认',
           '首次导入，数值为占位符',
           '示例来源：待甲方提供检测报告', 'TBD', 'C', null, null,
           'DRAFT', ${createdBy}, ${createdBy}, ${now}, ${now})
        returning id, code, version`;
      info(`版本 ${version.code} v${version.version} -> id=${version.id}`);
    }
    const versionId = version.id;

    // 下一步工作流端点（全部为 B 端后台接口）
    info("工作流端点：submit -> POST /api/v1/platform/comparison/versions/:id/submit");
    info("            approve -> POST /api/v1/platform/comparison/versions/:id/approve");
    info("            publish -> POST /api/v1/platform/comparison/versions/:id/publish");

    // ---------------------------------------------------------------- 维度（seed 已预置五维，这里只查不插）
    const [thermalDim] = await sql`select id from comparison_dimensions where code = 'thermal' and enabled = true limit 1`;
    if (!thermalDim) throw new Error("五维维度未初始化，请先执行 pnpm db:seed");
    info(`维度 保温(thermal) -> id=${thermalDim.id}`);

    // ---------------------------------------------------------------- 材料（VICP 侧 + 竞品侧）
    const materials = [
      // VICP 侧
      { category: "VICP", name: "VICP 保温装饰一体板", model: "VICP-50-TBD", density: 999.999, densityUnit: "kg/m³", testConditions: "待甲方确认" },
      // 竞品侧（EPS/XPS/岩棉/聚氨酯/传统一体板各占位一条）
      { category: "EPS", name: "EPS 保温板", model: "EPS-50-TBD", density: 999.999, densityUnit: "kg/m³", testConditions: "待甲方确认" },
      { category: "XPS", name: "XPS 挤塑板", model: "XPS-50-TBD", density: 999.999, densityUnit: "kg/m³", testConditions: "待甲方确认" },
      { category: "ROCK_WOOL", name: "岩棉板", model: "RW-50-TBD", density: 999.999, densityUnit: "kg/m³", testConditions: "待甲方确认" },
      { category: "PU", name: "聚氨酯板", model: "PU-50-TBD", density: 999.999, densityUnit: "kg/m³", testConditions: "待甲方确认" },
      { category: "TRADITIONAL_BOARD", name: "传统一体板", model: "TB-50-TBD", density: 999.999, densityUnit: "kg/m³", testConditions: "待甲方确认" }
    ];

    const materialIds = {};
    for (const m of materials) {
      let [row] = await sql`
        select id from comparison_materials
        where version_id = ${versionId} and category = ${m.category} and name = ${m.name} and model = ${m.model}
        limit 1`;
      if (row) {
        info(`材料 ${m.name}(${m.model}) 已存在（id=${row.id}），复用`);
      } else {
        [row] = await sql`
          insert into comparison_materials
            (version_id, category, name, model, density, density_unit, test_conditions, description,
             evidence_source, evidence_ref, evidence_level, effective_at, expires_at,
             created_by_id, updated_by_id, created_at, updated_at)
          values
            (${versionId}, ${m.category}, ${m.name}, ${m.model}, ${m.density}, ${m.densityUnit}, ${m.testConditions},
             '占位示例：密度/测试条件待甲方确认',
             '示例来源：待甲方提供检测报告', 'TBD', 'C', null, null,
             ${createdBy}, ${createdBy}, ${now}, ${now})
          returning id`;
        info(`材料 ${m.name}(${m.model}) -> id=${row.id}`);
      }
      materialIds[m.category] = row.id;
    }

    // ---------------------------------------------------------------- 规则（维度：保温；数值全部占位）
    const vicpMaterialId = materialIds.VICP;
    const competitorRules = [
      { category: "EPS", benchmarkDesc: "同厚度 50mm（占位，待甲方确认口径）" },
      { category: "XPS", benchmarkDesc: "同厚度 50mm（占位，待甲方确认口径）" },
      { category: "ROCK_WOOL", benchmarkDesc: "同厚度 50mm（占位，待甲方确认口径）" },
      { category: "PU", benchmarkDesc: "同厚度 50mm（占位，待甲方确认口径）" },
      { category: "TRADITIONAL_BOARD", benchmarkDesc: "同厚度 50mm（占位，待甲方确认口径）" }
    ];

    for (const cr of competitorRules) {
      const competitorMaterialId = materialIds[cr.category];
      let [rule] = await sql`
        select id from comparison_rules
        where version_id = ${versionId} and dimension_id = ${thermalDim.id}
          and vicp_material_id = ${vicpMaterialId} and competitor_material_id = ${competitorMaterialId}
          and benchmark_type = 'SAME_THICKNESS'
        limit 1`;
      if (rule) {
        info(`规则 VICP vs ${cr.category} 已存在（id=${rule.id}），复用`);
        continue;
      }
      [rule] = await sql`
        insert into comparison_rules
          (version_id, dimension_id, dimension_name, sub_indicator_name,
           vicp_material_id, competitor_material_id,
           benchmark_type, benchmark_desc,
           vicp_value, vicp_unit, competitor_value, competitor_unit,
           advantage_text, applicability, mandatory_disclosure, forbidden_wording, sort_order,
           created_by_id, updated_by_id, created_at, updated_at)
        values
          (${versionId}, ${thermalDim.id}, '保温', '导热系数',
           ${vicpMaterialId}, ${competitorMaterialId},
           'SAME_THICKNESS', ${cr.benchmarkDesc},
           0.032, 'W/(m·K)', 0.042, 'W/(m·K)',
           '【占位】VICP 导热系数优于竞品，具体优势百分比待甲方确认',
           '【占位】适用于外墙外保温系统，具体适用条件待甲方确认',
           '【占位】数值以第三方检测报告为准；本示例数据未经审核，不得用于正式输出',
           '【占位】禁止使用绝对化用语，具体清单待甲方确认', 10,
           ${createdBy}, ${createdBy}, ${now}, ${now})
        returning id`;
      info(`规则 VICP vs ${cr.category} -> id=${rule.id}`);
    }

    // ---------------------------------------------------------------- 证据（VICP 侧 + 竞品侧，页码占位）
    const [firstRule] = await sql`select id from comparison_rules where version_id = ${versionId} order by sort_order limit 1`;
    if (firstRule) {
      for (const side of ["VICP", "COMPETITOR"]) {
        const [existing] = await sql`
          select id from comparison_evidence
          where version_id = ${versionId} and rule_id = ${firstRule.id} and side = ${side}
          limit 1`;
        if (existing) continue;
        const [ev] = await sql`
          insert into comparison_evidence
            (version_id, rule_id, material_id, side, source, page_ref, clause_ref, evidence_level, quote,
             created_by_id, created_at, updated_at)
          values
            (${versionId}, ${firstRule.id}, null, ${side},
             '待甲方提供检测报告', 'TBD', null, 'C',
             '【占位】证据原文与页码待甲方确认',
             ${createdBy}, ${now}, ${now})
          returning id`;
        info(`证据 ${side} -> id=${ev.id}`);
      }
    }

    info("完成。请通过 B 端继续补齐材料密度/测试条件、规则数值与证据页码，确认后走 submit -> approve -> publish；");
    info("发布后 AI material_compare 场景对话即会消费该版本规则。");
  } catch (error) {
    console.error("[材料对比示例] 失败：", error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
};

main();