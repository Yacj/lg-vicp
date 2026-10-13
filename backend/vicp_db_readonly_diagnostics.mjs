import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  console.error('错误：.env 中没有 DATABASE_URL');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 8,
  idle_timeout: 5,
  prepare: false
});

const checks = [
  {
    name: '1. 知识库文档及发布状态',
    query: `
      SELECT
        d.title,
        d.status AS document_status,
        d.page_count,
        v.version,
        v.status AS version_status,
        v.pipeline_status,
        v.parse_status,
        v.usage_mode,
        v.index_status,
        v.index_dirty,
        v.content_revision,
        v.index_revision,
        (d.current_version_id = v.id) AS is_current,
        v.published_at IS NOT NULL AS is_published
      FROM knowledge_documents d
      LEFT JOIN knowledge_document_versions v
        ON v.document_id = d.id
      WHERE d.deleted_at IS NULL
      ORDER BY d.title, v.version DESC
      LIMIT 20
    `
  },

  {
    name: '2. 知识库页面识别情况',
    query: `
      SELECT
        COUNT(*)::int AS total_pages,

        COUNT(*) FILTER (
          WHERE page_image_object_key IS NOT NULL
        )::int AS pages_with_images,

        COUNT(*) FILTER (
          WHERE parsed_text IS NOT NULL
          AND BTRIM(parsed_text) <> ''
        )::int AS pages_with_text,

        COUNT(*) FILTER (
          WHERE page_label_verified = true
        )::int AS verified_page_labels,

        COUNT(*) FILTER (
          WHERE metadata->>'recognitionStatus' = 'CONFIRMED'
        )::int AS recognition_confirmed,

        COUNT(*) FILTER (
          WHERE metadata->'confirmedStructuredData' IS NOT NULL
        )::int AS structured_confirmed,

        COUNT(*) FILTER (
          WHERE metadata->>'recognitionStatus' = 'REVIEW_REQUIRED'
        )::int AS review_required,

        COUNT(*) FILTER (
          WHERE metadata->>'recognitionStatus' = 'FAILED'
        )::int AS recognition_failed

      FROM knowledge_pages
    `
  },

  {
    name: '3. 知识库 Chunk 检索索引',
    query: `
      SELECT
        COUNT(*)::int AS total_chunks,

        COUNT(*) FILTER (
          WHERE page_block_id IS NOT NULL
        )::int AS linked_to_page_blocks,

        COUNT(*) FILTER (
          WHERE invalid = true
        )::int AS invalid_chunks,

        COUNT(*) FILTER (
          WHERE search_text IS NOT NULL
          AND BTRIM(search_text) <> ''
        )::int AS searchable_chunks

      FROM knowledge_chunks
    `
  },

  {
    name: '4. 热工参考集状态与来源',
    query: `
      SELECT
        s.code,
        s.name,
        s.status,
        s.description,

        COUNT(r.id)::int AS reference_rows,

        COUNT(r.id) FILTER (
          WHERE r.source_page_id IS NOT NULL
        )::int AS rows_with_source_page,

        COUNT(r.id) FILTER (
          WHERE r.source_document_id IS NOT NULL
        )::int AS rows_with_source_document

      FROM thermal_reference_sets s

      LEFT JOIN thermal_reference_rows r
        ON r.set_id = s.id

      GROUP BY
        s.id,
        s.code,
        s.name,
        s.status,
        s.description

      ORDER BY s.code
      LIMIT 30
    `
  },

  {
    name: '5. 热工参考行详细数据',
    query: `
      SELECT
        s.code AS set_code,
        c.scheme_code,
        i.name AS system_name,

        c.substrate_material,
        c.substrate_thickness,

        r.thickness_mm,
        r.product_thermal_resistance AS product_r,
        r.total_thermal_resistance AS total_r,
        r.k_value AS k,

        r.source_page_id IS NOT NULL AS has_source_page,
        r.source_page_label,
        r.evidence_ref

      FROM thermal_reference_rows r

      JOIN thermal_reference_sets s
        ON s.id = r.set_id

      JOIN construction_schemes c
        ON c.id = r.scheme_id

      JOIN insulation_systems i
        ON i.id = c.system_id

      ORDER BY
        s.code,
        c.scheme_code,
        r.thickness_mm

      LIMIT 30
    `
  },

  {
    name: '6. 产品目录及热工参数',
    query: `
      SELECT
        name,
        product_type,
        spec_class,
        status,
        thickness_options_mm,
        thermal_conductivity,
        correction_factor

      FROM catalog_products

      ORDER BY name
      LIMIT 30
    `
  },

  {
    name: '7. 核心业务数据统计',
    query: `
      SELECT
        (SELECT COUNT(*) FROM insulation_systems)::int
          AS systems_total,

        (SELECT COUNT(*) FROM construction_schemes)::int
          AS schemes_total,

        (SELECT COUNT(*) FROM knowledge_facts)::int
          AS knowledge_facts_total,

        (SELECT COUNT(*) FROM thermal_reference_rows)::int
          AS thermal_rows_total,

        (SELECT COUNT(*) FROM thermal_standard_limits)::int
          AS standard_limits_total,

        (SELECT COUNT(*) FROM standard_documents)::int
          AS standard_documents_total,

        (SELECT COUNT(*) FROM solution_states)::int
          AS solution_states_total,

        (SELECT COUNT(*) FROM solution_snapshots)::int
          AS solution_snapshots_total
    `
  }
];

console.log('\n蓝格智配 Backend 数据诊断开始');
console.log('运行方式：只读事务');
console.log('-----------------------------------');

try {
  for (const check of checks) {
    console.log('\n===================================');
    console.log(check.name);
    console.log('===================================');

    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe('SET TRANSACTION READ ONLY');
        return await tx.unsafe(check.query);
      });

      console.log(JSON.stringify(rows, null, 2));

    } catch (err) {
      console.error('检查失败：', err.message);
    }
  }

  console.log('\n===================================');
  console.log('数据库诊断完成');
  console.log('===================================');

} catch (err) {
  console.error('数据库连接失败：', err.message);

} finally {
  await sql.end();
}
