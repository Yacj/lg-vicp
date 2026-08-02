#!/usr/bin/env node
// ============================================================
// 迁移预检脚本：在临时 PostgreSQL 容器中验证全部迁移可执行
//
// 场景一（干净库）：按 _journal.json 顺序执行全部迁移，必须成功。
// 场景二（脏数据模拟）：执行 0000-0008 后写入重复场景的旧模板数据
//   （复现生产环境 prompt_templates.project_design 重复事故），
//   再执行 0009/0010，断言 prompts 恰好 6 行且旧表已删除。
//
// 依赖：本机 Docker（postgres:16-alpine 镜像）。
// 用法：pnpm db:verify
// ============================================================
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRIZZLE_DIR = path.join(ROOT, "drizzle");
const IMAGE = "postgres:16-alpine";
const CONTAINER = `lg-vicp-migrate-verify-${Date.now()}`;
const PASSWORD = "verify";

let failures = 0;
const fail = (msg) => {
  console.error(`[失败] ${msg}`);
  failures += 1;
};
const info = (msg) => console.log(`[预检] ${msg}`);

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(" ")} 失败：${r.stderr || r.stdout}`);
  }
  return r;
};

// 按 _journal.json 顺序读取迁移 SQL 文件
const migrationFiles = () => {
  const journal = JSON.parse(readFileSync(path.join(DRIZZLE_DIR, "meta/_journal.json"), "utf8"));
  return journal.entries.map((e) => `${e.tag}.sql`);
};

const psql = (db, sql, opts = {}) => {
  const r = spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-X", "-q"], {
    input: sql,
    encoding: "utf8",
    ...opts
  });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`psql 失败：${r.stderr || r.stdout}`);
  return r;
};

const psqlFile = (db, file, opts = {}) =>
  psql(db, readFileSync(file, "utf8"), opts);

const psqlScalar = (db, query) => {
  const r = spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-X", "-A", "-t", "-c", query], {
    encoding: "utf8"
  });
  if (r.status !== 0) throw new Error(`psql 查询失败：${r.stderr || r.stdout}`);
  return r.stdout.trim();
};

const waitReady = () => {
  for (let i = 0; i < 30; i++) {
    const r = spawnSync("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres"], { encoding: "utf8", allowFail: true });
    if (r.status === 0) return;
    spawnSync("node", ["-e", "setTimeout(()=>{},1000)"], { stdio: "ignore" });
  }
  throw new Error("临时 postgres 容器未在 30 秒内就绪");
};

const main = async () => {
  info(`启动临时 PostgreSQL 容器（${IMAGE}）`);
  run("docker", ["run", "-d", "--name", CONTAINER, "-e", `POSTGRES_PASSWORD=${PASSWORD}`, IMAGE]);
  try {
    waitReady();
    info("容器就绪");

    // ---------- 场景一：干净库全量迁移 ----------
    info("场景一：干净库全量迁移");
    for (const file of migrationFiles()) {
      try {
        psqlFile("postgres", path.join(DRIZZLE_DIR, file));
      } catch (e) {
        fail(`干净库迁移失败（${file}）：${e.message}`);
        break;
      }
    }
    if (failures === 0) info("场景一通过：全部迁移执行成功");

    // ---------- 场景二：脏数据模拟 ----------
    info("场景二：脏数据模拟（0000-0008 + 重复模板 + 0009/0010）");
    try {
      psql("postgres", "CREATE DATABASE lg_vicp_dirty;");
      const files = migrationFiles();
      const legacy = files.filter((f) => f.startsWith("000") && parseInt(f.slice(0, 4), 10) <= 8);
      for (const file of legacy) {
        psqlFile("lg_vicp_dirty", path.join(DRIZZLE_DIR, file));
      }
      // 模拟旧 seed 产生的脏数据：project_design 重复两行（唯一约束 scene+version 不同）
      psql("lg_vicp_dirty", `
        INSERT INTO ai_providers (name, type, base_url, enabled)
        VALUES ('verify-provider', 'OPENAI_COMPATIBLE', 'https://example.com', true);
        INSERT INTO ai_models (provider_id, display_name, model_id, capabilities, timeout_ms, enabled)
        SELECT id, 'verify-model', 'verify-model', '{}', 60000, true FROM ai_providers LIMIT 1;
        INSERT INTO ai_scene_bindings (scene, primary_model_id, fallback_model_id, prompt_template_id, settings, enabled)
        SELECT s, (SELECT id FROM ai_models LIMIT 1), NULL, NULL, '{}', true
        FROM unnest(ARRAY['general_chat','project_design','material_compare','standard_qa','report_generate','information_extract']) AS t(s);
        INSERT INTO prompt_templates (scene, name, version, system_prompt, enabled, created_at) VALUES
          ('general_chat', '通用对话', 1, '你是通用助手', true, now()),
          ('project_design', '项目设计', 1, '你是项目设计助手', true, now()),
          ('project_design', '通用对话提示', 2, '错误重复行', true, now()),
          ('material_compare', '材料对比', 1, '你是材料对比助手', true, now()),
          ('standard_qa', '标准问答', 1, '你是标准问答助手', true, now()),
          ('report_generate', '报告生成', 1, '你是报告生成助手', true, now()),
          ('information_extract', '信息抽取', 1, '你是信息抽取助手', true, now());
      `);
      const files0010 = files.filter((f) => f.startsWith("0009") || f.startsWith("0010"));
      for (const file of files0010) {
        psqlFile("lg_vicp_dirty", path.join(DRIZZLE_DIR, file));
      }
      const promptCount = psqlScalar("lg_vicp_dirty", "SELECT count(*) FROM prompts;");
      if (promptCount !== "6") {
        fail(`脏数据迁移后 prompts 行数应为 6，实际 ${promptCount}`);
      }
      const legacyTables = psqlScalar(
        "lg_vicp_dirty",
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('ai_scene_bindings','prompt_templates');"
      );
      if (legacyTables !== "0") {
        fail(`旧表应已删除，残留 ${legacyTables} 张`);
      }
      if (failures === 0) info("场景二通过：重复模板数据下迁移成功且 prompts 恰好 6 行");
    } catch (e) {
      fail(`脏数据模拟失败：${e.message}`);
    }
  } catch (e) {
    fail(`预检执行失败：${e.message}`);
  } finally {
    info("清理临时容器");
    spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore", allowFail: true });
  }

  if (failures > 0) {
    console.error(`\n[预检] 共 ${failures} 项失败`);
    process.exit(1);
  }
  console.log("\n[预检] 全部通过");
};

main();