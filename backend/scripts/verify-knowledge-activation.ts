import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

// 仅运行隔离联调库；现有 .env 的数据库不会被读写。
const connectionUrl = process.env.KNOWLEDGE_ACTIVATION_DATABASE_URL;
assert(connectionUrl, "请提供临时 PostgreSQL 的 KNOWLEDGE_ACTIVATION_DATABASE_URL");
const connection = new URL(connectionUrl);
assert(["127.0.0.1", "localhost"].includes(connection.hostname), "联调脚本仅连接本机临时 PostgreSQL");
const databaseName = `vicp_knowledge_activation_${randomUUID().replaceAll("-", "")}`;
connection.pathname = `/${databaseName}`;
process.env.DATABASE_URL = connection.toString();
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "knowledge-activation-isolated-test-secret";
const s = await import("../src/db/schema.js");
const { authPlugin } = await import("../src/plugins/auth.js");
const { errorHandlerPlugin } = await import("../src/plugins/error-handler.js");
const { knowledgeRoutes } = await import("../src/modules/knowledge/knowledge.routes.js");
const admin = postgres(connectionUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
const client = postgres(connection.toString(), { max: 5, connect_timeout: 5, onnotice: () => {} });
const db = drizzle(client, { schema: s });
const app = fastify({ logger: false });
const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "vicp-knowledge-activation-state-"));
let created = false;
try {
  assert(/^vicp_knowledge_activation_[a-f0-9]{32}$/.test(databaseName));
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await migrate(db, { migrationsFolder: path.resolve("drizzle") });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("db", db);
  // 原页签名不参与本次状态联调；固定夹具对象位于隔离库中。
  app.decorate("storage", { createDownloadUrl: async () => "https://example.test/protocol-page.png" } as never);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(knowledgeRoutes, { prefix: "/api/v1/platform/knowledge" });
  const owner = (await db.insert(s.users).values({ displayName: "知识版本协议验收管理员", role: "SUPER_ADMIN" }).returning())[0]!;
  await db.insert(s.userAppAccess).values({ userId: owner.id, app: "ADMIN", role: "SUPER_ADMIN", status: "ACTIVE" });
  const document = (await db.insert(s.knowledgeDocuments).values({ title: "知识版本协议验收资料", createdById: owner.id }).returning())[0]!;
  const version = (await db.insert(s.knowledgeDocumentVersions).values({
    documentId: document.id, version: 1, title: document.title, status: "PUBLISHED", pipelineStatus: "PUBLISHED",
    usageMode: "BROWSE_ONLY", approvedById: owner.id, approvedAt: new Date(), publishedById: owner.id, publishedAt: new Date(),
    indexStatus: "INDEX_READY", indexDirty: false, pageCount: 1,
  }).returning())[0]!;
  await db.update(s.knowledgeDocuments).set({ currentVersionId: version.id }).where(eq(s.knowledgeDocuments.id, document.id));
  const pageInput = {
    documentId: document.id, versionId: version.id, pageNumber: 1, physicalPageNumber: 1,
    pageLabel: "A1", pageLabelSource: "MANUAL" as const, pageLabelVerified: true,
    pageImageObjectKey: "protocol-fixture/original-page.png", parsedText: "协议资料原文",
    metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED" },
  };
  await db.insert(s.knowledgePages).values(pageInput);
  const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  const token = app.jwt.sign({ sub: owner.id, tokenType: "access", clientType: "B_ADMIN", aud: "admin" }, { expiresIn: "10m" });
  const statePath = path.join(stateDirectory, "state.json");
  await writeFile(statePath, JSON.stringify({ baseUrl, token, documentId: document.id, versionId: version.id }));
  console.info("隔离 PostgreSQL 与真实 JWT API 已启动，正在执行前端 HTTP 联调。");
  const testExit = await new Promise<number>((resolve, reject) => {
    const child = spawn("pnpm", ["test", "src/test/knowledge-activation.integration.test.ts", "--pool=threads", "--maxWorkers=1"], {
      cwd: path.resolve("../admin-web"), windowsHide: true, shell: process.platform === "win32", stdio: "inherit",
      env: { ...process.env, KNOWLEDGE_ACTIVATION_TEST_STATE: statePath },
    });
    child.on("error", reject);
    child.on("exit", code => resolve(code ?? 1));
  });
  assert.equal(testExit, 0, "前端 HTTP 联调失败");
  const restored = (await db.select().from(s.knowledgeDocumentVersions).where(eq(s.knowledgeDocumentVersions.id, version.id)))[0]!;
  assert.equal(restored.version, version.version);
  assert.equal(restored.approvedAt?.getTime(), version.approvedAt?.getTime());
  assert.equal(restored.approvedById, version.approvedById);
  const lifecycleAudit = await db.select().from(s.auditLogs).where(eq(s.auditLogs.targetId, version.id));
  assert.deepEqual(lifecycleAudit.map(row => row.action).sort(), ["knowledge.version_disabled", "knowledge.version_enabled"].sort());
  const headers = { authorization: `Bearer ${token}` };
  const post = async (id: string, action: string) => (await fetch(`${baseUrl}/api/v1/platform/knowledge/versions/${id}/${action}`, { method: "POST", headers })).json() as Promise<{ success: boolean }>;
  assert((await post(version.id, "disable")).success);
  const other = (await db.insert(s.knowledgeDocumentVersions).values({
    documentId: document.id, version: 2, title: document.title, status: "DISABLED", pipelineStatus: "PUBLISHED", usageMode: "BROWSE_ONLY",
    approvedById: owner.id, approvedAt: new Date(), publishedById: owner.id, publishedAt: new Date(),
    indexStatus: "INDEX_READY", indexDirty: false, pageCount: 1,
  }).returning())[0]!;
  await db.insert(s.knowledgePages).values({ ...pageInput, versionId: other.id });
  const concurrent = await Promise.all([post(version.id, "enable"), post(other.id, "enable")]);
  assert.equal(concurrent.filter(result => result.success).length, 1, "并发启用只能成功一个版本");
  const published = await db.select().from(s.knowledgeDocumentVersions).where(eq(s.knowledgeDocumentVersions.documentId, document.id));
  assert.equal(published.filter(row => row.status === "PUBLISHED").length, 1);
  const pointer = (await db.select().from(s.knowledgeDocuments).where(eq(s.knowledgeDocuments.id, document.id)))[0]!;
  assert.equal(pointer.currentVersionId, published.find(row => row.status === "PUBLISHED")!.id);
  assert.equal((await db.select().from(s.knowledgePages)).length, 2, "启用不能删除原文页面");
  assert.equal((await db.select().from(s.auditLogs)).filter(row => row.action === "knowledge.version_enabled").length, 2, "冲突请求不能写入启用审计");
  console.info("联调通过：前端请求 → 真实 JWT/后台权限 → PostgreSQL 状态/原文/审计；并发启用仅保留一个发布版本。");
} finally {
  await app.close();
  await client.end({ timeout: 5 });
  if (created) {
    assert(/^vicp_knowledge_activation_[a-f0-9]{32}$/.test(databaseName));
    await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  }
  await admin.end({ timeout: 5 });
  // 只删除 mkdtemp 返回的固定前缀目录。
  assert(stateDirectory.startsWith(path.join(os.tmpdir(), "vicp-knowledge-activation-state-")));
  await rm(stateDirectory, { recursive: true, force: true });
}
