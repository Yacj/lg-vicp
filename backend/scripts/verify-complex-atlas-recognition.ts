/** 真实Vision核心取证：只读运行配置，原PNG直传模型；不建库/迁移/队列/OSS/确认。 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { generateObject } from "ai";
import * as schema from "../src/db/schema.js";
import { resolveDefaultVisionModel } from "../src/modules/ai-config/ai-config.service.js";
import { getAiTaskRuntimePolicy, languageModelSamplingOptions } from "../src/modules/ai-config/ai-task-runtime-policy.js";
import { buildPageRecognitionPrompt } from "../src/modules/knowledge/knowledge-page-recognition.service.js";
import { normalizePageRecognitionAnnotations, repairPageRecognitionText } from "../src/modules/knowledge/knowledge-page-recognition-output.js";
import { pageRecognitionResultSchema, type PageRecognitionResult } from "../src/shared/page-recognition.js";
import { preparePageRecognitionCandidate } from "../src/shared/page-recognition-evidence.js";
import { buildKnowledgePageRenderModel } from "../src/shared/knowledge-page-render.js";

const args = process.argv.slice(2);
const argument = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
if (args.some((value, index) => index % 2 === 0 && !["--output", "--image-dir"].includes(value)) || args.length % 2) {
  throw new Error("仅支持--output目录、--image-dir原PNG目录");
}
const out = path.resolve(argument("--output") ?? `logs/complex-atlas-phase1/${Date.now()}`);
const imageDir = argument("--image-dir") ?? process.env.TEMP ?? ".";
const inputs = [
  ["89", "codex-clipboard-eb1ba37f-00cc-4d70-90d7-ec2373efc972.png"],
  ["90", "codex-clipboard-e99d2331-2e5f-47e3-9bce-9d134480de54.png"],
  ["75", "codex-clipboard-67016163-25ee-4378-9429-da43841aa84f.png"]
] as const;
const client = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 5,
  connection: { options: "-c default_transaction_read_only=on" }, onnotice: () => {} });
const report: { scope: string; readOnly?: unknown; pages: unknown[]; environmentError?: unknown } = {
  scope: "真实Vision推理及新草稿证据处理；正式Worker/确认/HTTP-SSE/B-H5-App均NOT_RUN", pages: []
};
const code = (value?: string | null) => value?.normalize("NFKC").replace(/^外墙/, "").replace(/\s/g, "") ?? null;
function compare(expected: PageRecognitionResult, actual: PageRecognitionResult) {
  return expected.systems.flatMap(system => {
    const own = actual.systems.filter(item => item.applicationPart === system.applicationPart
      && item.specClass === system.specClass && item.placement === system.placement && item.roofForm === system.roofForm
      && code(item.constructionCode) === code(system.constructionCode));
    return (system.options ?? []).map(option => {
      const matched = own.length === 1 ? own[0]!.options?.filter(item => item.thicknessMm === option.thicknessMm) ?? [] : [];
      const row = matched.length === 1 ? matched[0]! : null;
      return { construction: system.rawConstructionLabel, thicknessMm: option.thicknessMm,
        expectedR: option.totalThermalResistance, expectedK: option.kValue,
        actualR: row?.totalThermalResistance, actualK: row?.kValue,
        numericAndIdentity: row?.totalThermalResistance === option.totalThermalResistance && row?.kValue === option.kValue ? "PASS" : "FAIL",
        productSemantic: row && row.productThermalResistance == null && row.layerValues?.some(value => value.rValue != null) ? "PASS" : "FAIL" };
    });
  });
}
try {
  await mkdir(out, { recursive: true });
  report.readOnly = await client`show transaction_read_only`;
  const vision = await resolveDefaultVisionModel(drizzle(client, { schema }));
  for (const [page, filename] of inputs) {
    const source = JSON.parse(await readFile(path.resolve(`tests/fixtures/complex-atlas/page-${page}.json`), "utf8")) as { imageSha256: string; data: PageRecognitionResult };
    const bytes = await readFile(path.join(imageDir, filename));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== source.imageSha256) throw new Error("原图哈希与基线不符，停止识别，未修改原件");
    console.log(`[复杂图集] 开始原图${page}，模型${vision.modelId}；原图身份已核对。`);
    const progress = setInterval(() => console.log(`[复杂图集] 原图${page}真实模型仍在处理…`), 30_000);
    try {
      const result = await generateObject({ model: vision.languageModel, schema: pageRecognitionResultSchema,
        experimental_repairText: async ({ text }) => repairPageRecognitionText(text),
        ...buildPageRecognitionPrompt({ documentTitle: null, pageLabel: null, physicalPageNumber: 1,
          imageUrl: `data:image/png;base64,${bytes.toString("base64")}` }),
        ...languageModelSamplingOptions("PAGE_RECOGNITION"),
        abortSignal: AbortSignal.timeout(getAiTaskRuntimePolicy("PAGE_RECOGNITION").timeoutMs) });
      const data = normalizePageRecognitionAnnotations(preparePageRecognitionCandidate(result.object));
      // 不保存响应headers、凭据、请求data URL；原始模型正文仅作数据取证。
      const raw = { page, imageSha256: sha256, configuredModel: vision.modelId, finishReason: result.finishReason,
        usage: result.usage, object: result.object, responseBody: result.response.body };
      await writeFile(path.join(out, `page-${page}.raw.json`), JSON.stringify(raw, null, 2));
      await writeFile(path.join(out, `page-${page}.structured.json`), JSON.stringify(data, null, 2));
      await writeFile(path.join(out, `page-${page}.render.json`), JSON.stringify(buildKnowledgePageRenderModel(`fixture-${page}`, data), null, 2));
      const checks = compare(source.data, data);
      const failed = data.pageLabel !== page || data.systems.length !== source.data.systems.length
        || checks.some(item => item.numericAndIdentity !== "PASS" || item.productSemantic !== "PASS");
      if (failed) process.exitCode = 1;
      report.pages.push({ page, status: failed ? "FAIL" : "PARTIAL", explanation: "单次真实推理；所有结果仍REVIEW_REQUIRED，未人工确认、未正式发布",
        groups: data.systems.length, pageLabel: data.pageLabel, printedPage: data.pageLabel === page ? "PASS" : "FAIL",
        notes: data.notes, warnings: data.warnings, checks });
      console.log(`[复杂图集] 原图${page}返回${data.systems.length}组，${checks.filter(item => item.numericAndIdentity === "PASS").length}/${checks.length}档R/K及身份一致。`);
    } catch (error) {
      const failure = error as { name?: string; statusCode?: number; text?: string };
      const safe = { page, status: "FAIL", name: failure.name, statusCode: failure.statusCode,
        modelText: typeof failure.text === "string" ? failure.text.slice(0, 1_000_000) : undefined };
      report.pages.push(safe);
      await writeFile(path.join(out, `page-${page}.failure.json`), JSON.stringify(safe, null, 2));
      process.exitCode = 1;
      console.log(`[复杂图集] 原图${page}未完成，错误类型${failure.name ?? "UNKNOWN"}。`);
    } finally { clearInterval(progress); }
  }
} catch (error) {
  const failure = error as { name?: string; code?: string };
  report.environmentError = { name: failure.name, code: failure.code };
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 3 });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`[复杂图集] 证据已保存：${out}；没有数据库写入、迁移或正式确认。`);
}
