#!/usr/bin/env node
// ============================================================
// 保温系统/构造方案 批量导入示例：外墙外保温系统 + A1-1/A1-2 占位方案
//
// - 所有记录落 DRAFT（version=1），随后走正常审核发布流程
//   （submit -> approve -> publish，submit 前结构校验会强制核对）；
// - 同一逻辑键（system.code / (system_id, scheme_code)）已存在时跳过（幂等）；
// - 构造层按 (scheme_id, layer_order) 幂等：方案已有层则跳过整组；
// - 产品选项引用示例规格 XPS-100-30（md:import-example 导入，未发布时
//   结构校验会拒绝——这是期望行为，占位数据仅供演示结构，发布前需人工替换
//   为已发布的产品规格/材料；
// - 打印每条记录 id 与下一步工作流端点，作为前端/脚本接入参考。
//
// 用法：pnpm construction:import-example
// ============================================================
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const now = new Date();
const createdBy = null; // 脚本导入无登录用户，审核列留空，由后台流程补齐

const info = (msg) => console.log(`[构造示例] ${msg}`);

/** 按逻辑键查重，已存在则跳过（幂等） */
async function ensureRow(table, keyColumn, keyValue) {
  const [existing] = await sql`select id from ${sql(table)} where ${sql(keyColumn)} = ${keyValue} limit 1`;
  return existing ?? null;
}

/** 保温系统：同 code 多版本行并存（版本化实体） */
async function ensureSystem(code, name, systemType) {
  const existing = await ensureRow("insulation_systems", "code", code);
  if (existing) {
    info(`保温系统 ${code} 已存在（id=${existing.id}），跳过`);
    return existing.id;
  }
  const [row] = await sql`
    insert into insulation_systems
      (code, version, name, system_type, description, change_note,
       evidence_source, evidence_ref, evidence_level, effective_at, expires_at,
       status, created_by_id, updated_by_id, created_at, updated_at)
    values
      (${code}, 1, ${name}, ${systemType}, '示例导入：外墙外保温系统', '首次导入',
       '示例来源：图集', 'ATLAS-DEMO', 'B', ${now}, null,
       'DRAFT', ${createdBy}, ${createdBy}, ${now}, ${now})
    returning id, code, version`;
  info(`保温系统 ${row.code} v${row.version} -> id=${row.id}`);
  return row.id;
}

/** 构造方案：同 (systemId, schemeCode) 多版本行并存（版本化实体） */
async function ensureScheme(systemId, schemeCode, name, substrateMaterial, atlasPage) {
  const [existing] = await sql`
    select id from construction_schemes
    where system_id = ${systemId} and scheme_code = ${schemeCode} limit 1`;
  if (existing) {
    info(`构造方案 ${schemeCode} 已存在（id=${existing.id}），跳过`);
    return existing.id;
  }
  const [row] = await sql`
    insert into construction_schemes
      (system_id, scheme_code, version, name, substrate_material, substrate_thickness,
       drawing_file_id, atlas_page, change_note,
       evidence_source, evidence_ref, evidence_level, effective_at, expires_at,
       status, created_by_id, updated_by_id, created_at, updated_at)
    values
      (${systemId}, ${schemeCode}, 1, ${name}, ${substrateMaterial}, null,
       null, ${atlasPage}, '首次导入',
       '示例来源：图集', 'ATLAS-DEMO', 'B', ${now}, null,
       'DRAFT', ${createdBy}, ${createdBy}, ${now}, ${now})
    returning id, system_id, scheme_code, version`;
  info(`构造方案 ${row.scheme_code} v${row.version} -> id=${row.id}`);
  return row.id;
}

/**
 * 构造层：外到内 layerOrder 从 1 递增，最内层为 BASE_LAYER（基层）。
 * 方案已有层则跳过整组（占位数据一次性写入，后续人工维护）。
 */
async function ensureLayers(schemeId, layers) {
  const [existing] = await sql`select id from construction_layers where scheme_id = ${schemeId} limit 1`;
  if (existing) {
    info(`构造方案 ${schemeId} 已有构造层，跳过`);
    return;
  }
  // material_id 引用示例材料（md:import-example 导入）；未发布时结构校验会拒绝，属期望行为
  const [material] = await sql`select id from materials where code = 'MAT-XPS-30' limit 1`;
  for (const layer of layers) {
    const materialId = layer.layerType === "PRODUCT_LAYER" ? (material?.id ?? null) : null;
    const [row] = await sql`
      insert into construction_layers
        (scheme_id, layer_order, layer_type, layer_name, material_id, thickness,
         evidence_source, evidence_ref, evidence_level, effective_at, expires_at,
         created_by_id, updated_by_id, created_at, updated_at)
      values
        (${schemeId}, ${layer.layerOrder}, ${layer.layerType}, ${layer.layerName},
         ${materialId}, ${layer.thickness ?? null},
         '示例来源：图集', 'ATLAS-DEMO', 'B', ${now}, null,
         ${createdBy}, ${createdBy}, ${now}, ${now})
      returning id, layer_order, layer_type, layer_name`;
    info(`构造层 [${row.layer_order}] ${row.layer_type} ${row.layer_name} -> id=${row.id}`);
  }
}

/** 产品选项：引用示例规格 XPS-100-30（md:import-example 导入），按 (scheme_id, product_spec_id) 幂等 */
async function ensureOption(schemeId, specCode, minThickness, maxThickness, defaultThickness) {
  const [spec] = await sql`select id from product_specs where spec_code = ${specCode} limit 1`;
  if (!spec) {
    info(`未找到规格 ${specCode}（先执行 pnpm md:import-example），跳过产品选项`);
    return;
  }
  const [existing] = await sql`
    select id from scheme_product_options
    where scheme_id = ${schemeId} and product_spec_id = ${spec.id} limit 1`;
  if (existing) {
    info(`产品选项（${specCode}）已存在，跳过`);
    return;
  }
  const [row] = await sql`
    insert into scheme_product_options
      (scheme_id, product_spec_id, min_thickness, max_thickness, default_thickness,
       evidence_source, evidence_ref, evidence_level, effective_at, expires_at,
       created_by_id, updated_by_id, created_at, updated_at)
    values
      (${schemeId}, ${spec.id}, ${minThickness}, ${maxThickness}, ${defaultThickness},
       '示例来源：图集选用表', 'ATLAS-DEMO', 'B', ${now}, null,
       ${createdBy}, ${createdBy}, ${now}, ${now})
    returning id, product_spec_id, min_thickness, max_thickness`;
  info(`产品选项 ${specCode} [${row.min_thickness}~${row.max_thickness}mm] -> id=${row.id}`);
}

const main = async () => {
  try {
    const systemId = await ensureSystem("ETICS-WALL", "外墙外保温系统", "外墙外保温");

    // A1-1：外墙外保温（占位构造，真实层组合待图集人工录入）
    const schemeA1 = await ensureScheme(
      systemId, "A1-1", "A1-1 外墙外保温构造", "钢筋混凝土", "P12"
    );
    if (schemeA1) {
      await ensureLayers(schemeA1, [
        { layerOrder: 1, layerType: "VARIABLE_LAYER", layerName: "饰面层（占位）", thickness: null },
        { layerOrder: 2, layerType: "FIXING_LAYER", layerName: "聚合物抗裂砂浆抹面层（占位）", thickness: 5 },
        { layerOrder: 3, layerType: "PRODUCT_LAYER", layerName: "XPS 保温板", thickness: 30 },
        { layerOrder: 4, layerType: "BASE_LAYER", layerName: "钢筋混凝土基层", thickness: null }
      ]);
      await ensureOption(schemeA1, "XPS-100-30", 20, 40, 30);
    }

    // A1-2：外墙外保温变体（占位构造）
    const schemeA2 = await ensureScheme(
      systemId, "A1-2", "A1-2 外墙外保温构造（加厚保温层）", "加气混凝土砌块", "P14"
    );
    if (schemeA2) {
      await ensureLayers(schemeA2, [
        { layerOrder: 1, layerType: "VARIABLE_LAYER", layerName: "饰面层（占位）", thickness: null },
        { layerOrder: 2, layerType: "FIXING_LAYER", layerName: "聚合物抗裂砂浆抹面层（占位）", thickness: 5 },
        { layerOrder: 3, layerType: "PRODUCT_LAYER", layerName: "XPS 保温板", thickness: 50 },
        { layerOrder: 4, layerType: "BASE_LAYER", layerName: "加气混凝土砌块基层", thickness: null }
      ]);
      await ensureOption(schemeA2, "XPS-100-30", 20, 60, 50);
    }

    info("导入完成。下一步：");
    info("  1. 通过工作流端点提交审核（submit -> approve -> publish）；");
    info("  2. 占位层引用的材料/规格未发布，submit 时结构校验会拒绝，属期望行为——");
    info("     发布引用数据后再调整占位构造（真实图集数据人工录入）。");
  } finally {
    await sql.end();
  }
};

main().catch((error) => {
  console.error("[构造示例] 执行失败：", error.message);
  process.exit(1);
});