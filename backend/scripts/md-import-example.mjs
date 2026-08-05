#!/usr/bin/env node
// ============================================================
// 主数据批量导入示例：系列/规格/材料/材料参数/企业内容
//
// - 所有记录落 DRAFT（version=1），随后走正常审核发布流程
//   （submit -> approve -> publish），不绕过状态机；
// - 同一逻辑键（code / specId+specCode 等）已存在时跳过（幂等）；
// - 打印每条记录 id 与下一步工作流端点，作为前端/脚本接入参考。
//
// 用法：pnpm md:import-example
// ============================================================
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const now = new Date();
const createdBy = null; // 脚本导入无登录用户，审核列留空，由后台流程补齐

const info = (msg) => console.log(`[主数据示例] ${msg}`);

/** 插入前按逻辑键查重，已存在则跳过（幂等） */
async function ensureRow(table, keyColumn, keyValue) {
  const [existing] = await sql`select id from ${sql(table)} where ${sql(keyColumn)} = ${keyValue} limit 1`;
  return existing ?? null;
}

const main = async () => {
  try {
    // ---------------------------------------------------------------- 产品系列
    let existing = await ensureRow("product_series", "code", "XPS-100");
    if (existing) {
      info(`产品系列 XPS-100 已存在（id=${existing.id}），跳过`);
    } else {
      const [series] = await sql`
        insert into product_series
          (code, version, name, description, change_note,
           evidence_source, evidence_ref, evidence_level, effective_at, expires_at,
           status, created_by_id, updated_by_id, created_at, updated_at)
        values
          ('XPS-100', 1, 'XPS 挤塑聚苯板系列', '示例导入：外墙外保温用 XPS 板系列', '首次导入',
           '示例来源：产品标准', 'T-001', 'B', ${now}, null,
           'DRAFT', ${createdBy}, ${createdBy}, ${now}, ${now})
        returning id, code, version`;
      info(`产品系列 ${series.code} v${series.version} -> id=${series.id}`);
    }

    // ---------------------------------------------------------------- 产品规格
    const [spec] = await sql`
      insert into product_specs
        (series_id, spec_code, version, spec_class, thickness_mm, length_mm, width_mm,
         combustion_grade, production_status, standard_type, supply_regions,
         evidence_source, evidence_ref, evidence_level, status, created_at, updated_at)
      select s.id, 'XPS-100-30', 1, 'I', 30, 1200, 600,
             'B1', 'PRODUCING', 'STANDARD', '["华东","华南"]'::jsonb,
             '示例来源：产品标准', 'T-001', 'B', 'DRAFT', ${now}, ${now}
      from product_series s
      where s.code = 'XPS-100' and not exists (
        select 1 from product_specs p where p.series_id = s.id and p.spec_code = 'XPS-100-30'
      )
      returning id, spec_code, version`;
    if (spec) {
      info(`产品规格 ${spec.spec_code} v${spec.version} -> id=${spec.id}`);
    } else {
      info("产品规格 XPS-100-30 已存在或系列不存在，跳过");
    }

    // ---------------------------------------------------------------- 产品性能参数（四来源并存 = 冲突可见）
    const specId = await sql`select id from product_specs where spec_code = 'XPS-100-30' limit 1`;
    if (specId.length > 0) {
      const sources = [
        { paramSource: "TECHNICAL_REGULATION", value: 0.03, name: "技术规程取值" },
        { paramSource: "ATLAS", value: 0.032, name: "图集取值" },
        { paramSource: "DETECTION", value: 0.031, name: "检测报告" },
        { paramSource: "ENTERPRISE_NOMINAL", value: 0.03, name: "企业标称" }
      ];
      for (const { paramSource, value, name } of sources) {
        const [param] = await sql`
          insert into product_parameters
            (spec_id, parameter_code, parameter_name, param_source, version, value, unit,
             allowed_usage, evidence_source, evidence_level, status, created_at, updated_at)
          select ${specId[0].id}, 'K', '导热系数', ${paramSource}, 1, ${value}, 'W/(m·K)',
                 '["ATLAS_QUERY"]'::jsonb, ${name}, 'B', 'DRAFT', ${now}, ${now}
          where not exists (
            select 1 from product_parameters p
            where p.spec_id = ${specId[0].id} and p.parameter_code = 'K' and p.param_source = ${paramSource}
          )
          returning id, parameter_code, param_source, value`;
        if (param) info(`产品参数 ${param.parameter_code}[${param.param_source}]=${param.value} -> id=${param.id}`);
      }
    } else {
      info("未找到规格 XPS-100-30，跳过产品参数");
    }

    // ---------------------------------------------------------------- 材料 + 材料参数版本
    existing = await ensureRow("materials", "code", "MAT-XPS-30");
    let materialId = existing?.id ?? null;
    if (!materialId) {
      const [material] = await sql`
        insert into materials
          (code, version, name, category, description, change_note,
           evidence_source, evidence_ref, evidence_level, status, created_at, updated_at)
        values
          ('MAT-XPS-30', 1, 'XPS 保温板 30mm', '保温板', '示例导入材料', '首次导入',
           '示例来源：检测报告', 'R-001', 'A', 'DRAFT', ${now}, ${now})
        returning id, code, version`;
      materialId = material.id;
      info(`材料 ${material.code} v${material.version} -> id=${material.id}`);
    } else {
      info(`材料 MAT-XPS-30 已存在（id=${existing.id}），跳过`);
    }

    if (materialId) {
      const [param] = await sql`
        insert into material_parameter_versions
          (material_id, version, thermal_conductivity, correction_factor, density,
           compressive_strength, bond_strength, combustion_grade, applicable_standard,
           source, allowed_usage, evidence_source, evidence_level, status, created_at, updated_at)
        values
          (${materialId}, 1, 0.03, 1.05, 38.0, 300, 0.2, 'B1', 'GB/T 10801.2',
           '示例导入', '["ATLAS_QUERY","LAYERED_CALC"]'::jsonb,
           '示例来源：检测报告', 'A', 'DRAFT', ${now}, ${now})
        returning id, material_id, version, thermal_conductivity`;
      info(`材料参数 v${param.version}（λ=${param.thermal_conductivity}）-> id=${param.id}`);
    }

    // ---------------------------------------------------------------- 企业内容
    existing = await ensureRow("enterprise_profiles", "code", "company_profile");
    if (existing) {
      info(`企业内容 company_profile 已存在（id=${existing.id}），跳过`);
    } else {
      const [profile] = await sql`
        insert into enterprise_profiles
          (code, version, name, short_name, intro, address, contact_phone, contact_email, website,
           change_note, evidence_source, evidence_level, status, created_at, updated_at)
        values
          ('company_profile', 1, '示例节能科技有限公司', '示例节能', '示例企业简介', '示例市示例区',
           '400-000-0000', 'contact@example.com', 'https://example.com',
           '首次导入', '示例来源：企业资料', 'C', 'DRAFT', ${now}, ${now})
        returning id, code, version`;
      info(`企业内容 ${profile.code} v${profile.version} -> id=${profile.id}`);
    }

    info("导入完成。下一步：通过工作流端点提交审核（submit -> approve -> publish）");
  } finally {
    await sql.end();
  }
};

main().catch((error) => {
  console.error("[主数据示例] 执行失败：", error.message);
  process.exit(1);
});