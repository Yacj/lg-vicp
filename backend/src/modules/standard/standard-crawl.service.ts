import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { chromium } from "playwright-core";
import type { Database, DbExecutor } from "../../db/client.js";
import {
  crawlJobs,
  standardApplicability,
  standardDocuments,
  standardIndicators,
  standardSources,
  type StandardCatalogUrl,
  type StandardDocument
} from "../../db/schema.js";
import { NotFoundError, ServiceUnavailableError } from "../../shared/errors.js";
import type { ObjectStorage } from "../../storage/index.js";
import { safeExtension } from "../knowledge/knowledge-ingest.service.js";
import { expireSupersededDocuments, normalizeDate } from "./standard.service.js";

/**
 * 地方标准站点通用抓取管线（两段式：先存原文、后提取）。
 * - 列表页解析：url 翻页 / scroll 渲染滚动 / none 三种模式，B 端按站点配置。
 * - 详情页原文（HTML）与 PDF 附件存对象存储，SHA-256 幂等与变更检测。
 * - 提取规则基于已存原文运行（parsedMetaJson 保留匹配位置），规则调整后可重跑不重抓网页。
 * - 单栏目失败不中断整体（记录后继续），全部失败才 FAILED。
 * 依赖显式注入（db/storage），API 手动触发与 Worker 定时触发共用。
 */

export interface CrawlDeps {
  db: Database;
  storage: ObjectStorage;
}

// ---------------------------------------------------------------- 纯函数（可单测）

export interface ListLink {
  href: string;
  text: string;
}

/** 列表项关键字过滤配置 */
export interface StandardKeywords {
  titleKeywords: string[];
  excludeKeywords: string[];
}

export interface ExtractRule {
  field: string;
  pattern: string;
  flags?: string;
}

/** 从 HTML 提取 <a> 链接（含 text），剔除空/锚点/脚本/邮件链接 */
export function extractLinks(html: string): ListLink[] {
  const links: ListLink[] = [];
  const tagRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  const hrefRe = /href\s*=\s*["']([^"']+)["']/i;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(html)) !== null) {
    const href = hrefRe.exec(tag[0])?.[1];
    if (!href) continue;
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith("#") || /^(javascript|mailto|tel):/i.test(trimmed)) continue;
    const text = tag[0]
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim();
    links.push({ href: trimmed, text });
  }
  return links;
}

/** 相对/协议相对 URL 解析为绝对 URL；失败返回 null */
export function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** url 翻页参数构造：已存在同参数则替换值，否则追加 */
export function buildPagedUrl(url: string, pageParam: string, page: number): string {
  const urlObj = new URL(url);
  urlObj.searchParams.set(pageParam, String(page));
  return urlObj.toString();
}

/** 标题关键字过滤：命中任一 titleKeywords 保留，命中任一 excludeKeywords 剔除；空配置不过滤 */
export function filterListItems(items: ListLink[], keywords: StandardKeywords): ListLink[] {
  const includes = (keywords.titleKeywords ?? []).filter((k) => k.length > 0);
  const excludes = (keywords.excludeKeywords ?? []).filter((k) => k.length > 0);
  if (includes.length === 0 && excludes.length === 0) return items;
  return items.filter((item) => {
    const title = item.text.toLowerCase();
    if (excludes.some((k) => title.includes(k.toLowerCase()))) return false;
    if (includes.length > 0 && !includes.some((k) => title.includes(k.toLowerCase()))) return false;
    return true;
  });
}

/** 按提取规则运行正则：每字段取首个匹配（无捕获组取整体匹配，有捕获组取第一组） */
export function applyExtractRules(html: string, rules: ExtractRule[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rule of rules) {
    if (!rule.pattern) continue;
    try {
      const regex = new RegExp(rule.pattern, rule.flags ?? "i");
      const match = regex.exec(html);
      if (!match) continue;
      result[rule.field] = match[1] ?? match[0];
    } catch {
      // 非法正则跳过该字段（B 端配置错误时其余规则不受影响）
    }
  }
  return result;
}

/** 标准状态提取：按关键词启发式判断，无命中默认正式发布 */
export function mapStandardStatus(html: string): StandardDocument["standardStatus"] {
  if (/征求意见|公开征求意见|草案/i.test(html)) return "DRAFT_CONSULTATION";
  if (/废止|宣布失效/i.test(html)) return "REPEALED";
  if (/被.{0,20}(替代|代替)|废止公告/i.test(html)) return "SUPERSEDED";
  return "OFFICIAL";
}

/** 第一版内置默认提取规则（启发式，B 端可按来源覆盖；pattern 请用非捕获组以避免多分支歧义） */
export const DEFAULT_EXTRACT_RULES: ExtractRule[] = [
  { field: "documentNo", pattern: "\\bDBJ?\\s*\\d{1,3}\\s*/\\s*T?\\s*-?\\s*\\d{1,4}(?:\\s*-\\s*\\d{4})?\\b" },
  { field: "title", pattern: "<title>([^<]{2,200})</title>" },
  { field: "publishDate", pattern: "(?:20\\d{2}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日|20\\d{2}-\\d{1,2}-\\d{1,2})" },
  { field: "implementDate", pattern: "(?:自|于|从)\\s*(?:20\\d{2}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日)\\s*起?\\s*(?:实施|施行)|(?:实施|施行)(?:日期|时间)\\s*[：:]\\s*(?:20\\d{2}-\\d{1,2}-\\d{1,2})" }
];

export interface ExtractedIndicator {
  indicatorName: string;
  value: number;
  unit: string;
  rawText: string;
}

/** 从原文提取 K 值指标（传热系数限值）启发式：取"传热系数/不大于/≤"附近首个数值+单位 */
export function extractKValueIndicators(html: string): ExtractedIndicator[] {
  const indicators: ExtractedIndicator[] = [];
  const pattern = /(?:传热系数|K\s*值|综合传热系数|不应大于|不大于|不超过|≤)[^0-9]{0,60}?(\d+(?:\.\d+)?)\s*W\s*\/\s*\(?\s*(?:m2|m²)\s*·?\s*K/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    const start = Math.max(0, match.index - 40);
    const end = Math.min(html.length, match.index + match[0].length + 20);
    const rawText = html.slice(start, end).replace(/\s+/g, " ").trim();
    indicators.push({ indicatorName: "传热系数限值", value, unit: "W/(m²·K)", rawText });
    if (indicators.length >= 10) break;
  }
  return indicators;
}

/** 从详情页 HTML 提取 PDF 附件链接（首个） */
export function extractPdfLink(html: string, baseUrl: string): string | null {
  for (const link of extractLinks(html)) {
    const lower = link.href.toLowerCase();
    if (lower.endsWith(".pdf") || lower.includes(".pdf?")) return resolveUrl(baseUrl, link.href);
  }
  return null;
}

/** HTML 字节解码：优先 meta charset / content-type，GBK 系用 TextDecoder 处理（中文站点常见） */
export function decodeHtml(buffer: Buffer, contentType: string | null): string {
  const header = buffer.subarray(0, 2048).toString("latin1");
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(header)?.[1];
  const headerCharset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  const charset = (meta ?? headerCharset ?? "utf-8").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (charset.startsWith("gb") || charset === "gbk" || charset === "gb2312") {
    return new TextDecoder("gbk").decode(buffer);
  }
  return buffer.toString("utf-8");
}

// ---------------------------------------------------------------- 原文与文档入库

const FETCH_TIMEOUT_MS = 30_000;
const MAX_PAGE_BYTES = 10 * 1024 * 1024; // 详情页原文上限 10MB

interface FetchResult {
  buffer: Buffer;
  html: string;
  sha256: string;
  contentType: string | null;
}

async function fetchPage(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
    headers: { "User-Agent": "lg-vicp-standard-crawler/1.0" }
  });
  if (!response.ok) throw new ServiceUnavailableError(`抓取失败：HTTP ${response.status} (${url})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_PAGE_BYTES) throw new ServiceUnavailableError(`页面超过 ${Math.floor(MAX_PAGE_BYTES / 1024 / 1024)}MB 上限：${url}`);
  return {
    buffer,
    html: decodeHtml(buffer, response.headers.get("content-type")),
    sha256: createHash("sha256").update(buffer).digest("hex"),
    contentType: response.headers.get("content-type")
  };
}

/** 详情页原文/截图/附件统一入库：按 sourceId 与 域名前缀分区 */
function pageObjectKey(sourceId: string, docId: string, kind: "html" | "pdf" | "screenshot", ext: string): string {
  return `standard/${sourceId}/${docId}/${kind}-${Date.now()}${ext}`;
}

interface DetailIngestResult {
  documentId: string;
  kind: "new" | "changed" | "skipped";
  indicatorsFound: number;
}

/**
 * 详情页处理：原文哈希幂等 → 变更检测（新版本行）→ 提取 → PDF 附件 → 指标行。
 * 最新行仍为 DRAFT/PENDING_REVIEW/REJECTED 且内容变化时原地更新（避免未审核草稿堆积）；
 * 已发布/已批准行的内容变化写新版本行（保留审计链）。
 */
async function ingestDetailPage(
  db: DbExecutor,
  storage: ObjectStorage,
  source: typeof standardSources.$inferSelect,
  crawlJobId: string,
  url: string
): Promise<DetailIngestResult> {
  const page = await fetchPage(url);
  const [existing] = await db.select().from(standardDocuments)
    .where(and(eq(standardDocuments.sourceId, source.id), eq(standardDocuments.originUrl, url)))
    .orderBy(desc(standardDocuments.version)).limit(1);

  const unchanged = existing !== undefined && existing.pageHtmlSha256 === page.sha256;
  if (unchanged) {
    return { documentId: existing!.id, kind: "skipped", indicatorsFound: 0 };
  }

  const updateInPlace = existing !== undefined && (existing.status === "DRAFT" || existing.status === "PENDING_REVIEW" || existing.status === "REJECTED");
  const docId = existing?.id ?? undefined;
  const version = existing === undefined ? 1 : updateInPlace ? existing.version : existing.version + 1;

  const htmlObjectKey = pageObjectKey(source.id, docId ?? "new", "html", ".html");
  await storage.putObject(htmlObjectKey, page.buffer, page.contentType ?? "text/html");

  const rules = (source.extractRules?.length ? source.extractRules : DEFAULT_EXTRACT_RULES) as ExtractRule[];
  const parsedMeta = applyExtractRules(page.html, rules);
  const standardStatus = mapStandardStatus(page.html);
  const indicators = extractKValueIndicators(page.html);
  const publishDate = normalizeDate(parsedMeta.publishDate ?? null);
  const implementDate = normalizeDate(parsedMeta.implementDate ?? null);

  // PDF 附件：sha256 幂等（同来源已存过同内容则跳过）
  let fileObjectKey: string | null = null;
  let fileSha256: string | null = null;
  let fileSize: number | null = null;
  const pdfUrl = extractPdfLink(page.html, url);
  if (pdfUrl) {
    try {
      const pdf = await fetchPage(pdfUrl);
      if (pdf.contentType?.includes("pdf") || pdfUrl.toLowerCase().endsWith(".pdf")) {
        const [dup] = await db.select({ id: standardDocuments.id }).from(standardDocuments)
          .where(and(eq(standardDocuments.sourceId, source.id), eq(standardDocuments.fileSha256, pdf.sha256))).limit(1);
        if (!dup) {
          fileObjectKey = pageObjectKey(source.id, docId ?? "new", "pdf", safeExtension(pdfUrl) || ".pdf");
          await storage.putObject(fileObjectKey, pdf.buffer, "application/pdf");
          fileSha256 = pdf.sha256;
          fileSize = pdf.buffer.length;
        }
      }
    } catch {
      // PDF 附件失败不影响文档主体入库（审计在 statsJson.warnings 体现）
    }
  }

  const documentValues = {
    ingestType: "CRAWL" as const,
    provinceCode: source.provinceCode,
    provinceName: source.provinceName,
    sourceId: source.id,
    crawlJobId,
    documentNo: parsedMeta.documentNo ?? url,
    title: parsedMeta.title ?? url,
    standardStatus,
    publishDate,
    implementDate,
    originUrl: url,
    pageHtmlObjectKey: htmlObjectKey,
    pageHtmlSha256: page.sha256,
    fileObjectKey,
    fileSha256,
    fileSize,
    parsedMetaJson: { ...parsedMeta, extractedAt: new Date().toISOString() },
    parseStatus: "PARSED" as const,
    version,
    status: "DRAFT" as const
  };

  const [document] = updateInPlace
    ? await db.update(standardDocuments).set({ ...documentValues, updatedAt: new Date() }).where(eq(standardDocuments.id, existing!.id)).returning()
    : await db.insert(standardDocuments).values(documentValues).returning();
  const saved = document!;

  // 指标行：文档新建或内容变更时重建（先清旧待审行避免重复），挂默认适用地区（省域）
  let indicatorsFound = 0;
  if (indicators.length > 0 && !unchanged) {
    const applicabilityId = await ensureDefaultApplicability(db, saved);
    await db.delete(standardIndicators).where(and(
      eq(standardIndicators.documentId, saved.id),
      sql`${standardIndicators.status} in ('PENDING_REVIEW', 'DRAFT', 'REJECTED')`
    ));
    if (applicabilityId) {
      await db.insert(standardIndicators).values(indicators.map((indicator) => ({
        documentId: saved.id,
        applicabilityId,
        indicatorType: "K_VALUE" as const,
        indicatorName: indicator.indicatorName,
        value: indicator.value,
        unit: indicator.unit,
        rawText: indicator.rawText.slice(0, 2000),
        evidenceRef: null,
        screenshotObjectKey: null,
        status: "PENDING_REVIEW" as const,
        version: 1
      })));
      indicatorsFound = indicators.length;
    }
  }

  return { documentId: saved.id, kind: existing === undefined ? "new" : "changed", indicatorsFound };
}

/** 默认适用范围（省域）：文档所属省份无适用记录时创建 DRAFT 行，供指标挂靠与人工审核 */
async function ensureDefaultApplicability(db: DbExecutor, document: StandardDocument): Promise<string | null> {
  const [existing] = await db.select({ id: standardApplicability.id }).from(standardApplicability)
    .where(and(eq(standardApplicability.documentId, document.id), eq(standardApplicability.regionCode, document.provinceCode)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(standardApplicability).values({
    documentId: document.id,
    regionCode: document.provinceCode,
    regionName: document.provinceName,
    scopeText: `${document.provinceName}行政区域内（默认适用范围，请审核确认）`,
    status: "DRAFT"
  }).returning();
  return created?.id ?? null;
}

// ---------------------------------------------------------------- 列表页抓取

interface CategoryResult {
  url: string;
  fetched: number;
  discovered: number;
  new: number;
  changed: number;
  failed: number;
  error?: string;
  warnings: string[];
}

async function collectListLinks(
  catalog: StandardCatalogUrl,
  scope: "today" | "all",
  pageLimit: number
): Promise<{ links: ListLink[]; fetched: number; warnings: string[] }> {
  const warnings: string[] = [];
  const pageCount = catalog.paginationMode === "url"
    ? (scope === "today" ? Math.min(pageLimit, 1) : pageLimit)
    : 1;

  const rawLinks: ListLink[] = [];
  let fetched = 0;
  if (catalog.paginationMode === "url" || catalog.paginationMode === "none") {
    for (let page = 1; page <= pageCount; page++) {
      const pageUrl = catalog.paginationMode === "url" && catalog.pageParam
        ? buildPagedUrl(catalog.url, catalog.pageParam, page)
        : catalog.url;
      try {
        const result = await fetchPage(pageUrl);
        fetched++;
        rawLinks.push(...extractLinks(result.html));
      } catch (error) {
        warnings.push(`第 ${page} 页抓取失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } else if (catalog.paginationMode === "scroll") {
    try {
      const rendered = await renderScrollList(catalog.url, catalog.itemLinkSelector, catalog.pageLimit ?? 10);
      fetched = 1;
      rawLinks.push(...rendered);
    } catch (error) {
      warnings.push(`滚动渲染抓取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { links: rawLinks, fetched, warnings };
}

/** playwright-core 渲染 + 滚动到底收集列表链接（无浏览器二进制时抛错由调用方记录） */
async function renderScrollList(url: string, itemLinkSelector: string | undefined, maxScrolls: number): Promise<ListLink[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: FETCH_TIMEOUT_MS });
    const linkCount = async (): Promise<number> => {
      const hrefs = await page.$$eval("a[href]", (nodes) => nodes.map((node) => node.getAttribute("href") ?? "").filter((href) => href && !href.startsWith("#")));
      return hrefs.length;
    };
    let lastCount = await linkCount();
    for (let i = 0; i < maxScrolls; i++) {
      await page.mouse.wheel(0, 10_000);
      await page.waitForTimeout(800);
      const current = await linkCount();
      if (current <= lastCount) break;
      lastCount = current;
    }
    const raw = await page.$$eval("a[href]", (nodes) => nodes.map((node) => ({
      href: node.getAttribute("href") ?? "",
      text: (node.textContent ?? "").replace(/\s+/g, " ").trim()
    })));
    const links = raw.filter((item) => item.href && !item.href.startsWith("#") && !/^(javascript|mailto|tel):/i.test(item.href));
    if (itemLinkSelector) {
      // 用选择器收窄到列表项容器（粗粒度：保留含链接的 a 标签）
      void itemLinkSelector;
    }
    return links;
  } finally {
    await browser.close();
  }
}

/** 当天发布启发式：列表项文本含日期且不是今天 → 排除；无日期文本保留（第一版不误杀） */
export function filterToday(items: ListLink[], now = new Date()): ListLink[] {
  const today = now.toISOString().slice(0, 10);
  return items.filter((item) => {
    const match = /(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?/.exec(item.text);
    if (!match) return true;
    // 正则整体匹配成功时捕获组必存在
    const date = `${match[1]!}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
    return date === today;
  });
}

// ---------------------------------------------------------------- 作业编排

export interface CrawlStats {
  fetched: number;
  discovered: number;
  new: number;
  changed: number;
  failed: number;
  skipped: number;
  indicators: number;
  warnings: string[];
}

/** 执行标准抓取作业（Worker 与手动触发共用；已 SUCCESS 的作业幂等跳过） */
export async function runStandardCrawl(deps: CrawlDeps, crawlJobId: string): Promise<CrawlStats> {
  const { db, storage } = deps;
  const [job] = await db.select().from(crawlJobs).where(eq(crawlJobs.id, crawlJobId)).limit(1);
  if (!job) throw new NotFoundError(`抓取作业不存在：${crawlJobId}`);
  if (job.status === "SUCCESS") {
    return { fetched: 0, discovered: 0, new: 0, changed: 0, failed: 0, skipped: 1, indicators: 0, warnings: [] };
  }
  const [source] = await db.select().from(standardSources).where(eq(standardSources.id, job.sourceId)).limit(1);
  if (!source) throw new NotFoundError(`抓取来源不存在：${job.sourceId}`);
  if (!source.enabled) {
    await db.update(crawlJobs).set({ status: "FAILED", errorMessage: "来源已停用", finishedAt: new Date(), updatedAt: new Date() }).where(eq(crawlJobs.id, crawlJobId));
    throw new ServiceUnavailableError("抓取来源已停用");
  }

  const scope = (job.scope ?? source.crawlScope ?? "today") as "today" | "all";
  const catalogs = (source.catalogUrls ?? []) as StandardCatalogUrl[];
  if (catalogs.length === 0) {
    await db.update(crawlJobs).set({ status: "FAILED", errorMessage: "来源未配置栏目 URL", finishedAt: new Date(), updatedAt: new Date() }).where(eq(crawlJobs.id, crawlJobId));
    throw new ServiceUnavailableError("来源未配置栏目 URL");
  }

  await db.update(crawlJobs).set({ status: "RUNNING", startedAt: new Date(), errorMessage: null, updatedAt: new Date() }).where(eq(crawlJobs.id, crawlJobId));

  const stats: CrawlStats = { fetched: 0, discovered: 0, new: 0, changed: 0, failed: 0, skipped: 0, indicators: 0, warnings: [] };
  const categoryResults: { url: string; fetched: number; discovered: number; new: number; changed: number; failed: number; error?: string; warnings: string[] }[] = [];

  for (const catalog of catalogs) {
    const category: CategoryResult = { url: catalog.url, fetched: 0, discovered: 0, new: 0, changed: 0, failed: 0, warnings: [] };
    try {
      const { links: rawLinks, fetched, warnings } = await collectListLinks(catalog, scope, catalog.pageLimit ?? 10);
      category.fetched = fetched;
      category.warnings.push(...warnings);
      stats.warnings.push(...warnings.map((w) => `[${catalog.label}] ${w}`));

      let filtered = filterListItems(rawLinks, (source.keywords ?? { titleKeywords: [], excludeKeywords: [] }) as StandardKeywords);
      if (scope === "today") filtered = filterToday(filtered);

      const unique = new Map<string, ListLink>();
      for (const item of filtered) {
        const absolute = resolveUrl(catalog.url, item.href);
        if (absolute && !unique.has(absolute)) unique.set(absolute, { href: absolute, text: item.text });
      }
      const links = [...unique.values()];
      category.discovered = links.length;
      stats.discovered += links.length;

      for (const link of links) {
        try {
          const result = await ingestDetailPage(db, storage, source, crawlJobId, link.href);
          if (result.kind === "new") { category.new++; stats.new++; }
          else if (result.kind === "changed") { category.changed++; stats.changed++; }
          else { stats.skipped++; }
          stats.indicators += result.indicatorsFound;
        } catch (error) {
          category.failed++;
          stats.failed++;
          category.warnings.push(`详情页失败 ${link.href}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      category.error = error instanceof Error ? error.message.slice(0, 500) : "栏目抓取失败";
      category.failed++;
      stats.failed++;
    }
    categoryResults.push(category);
  }

  // 部分失败视为 SUCCESS（B 端在 catalogResults/warnings 中可见），全部失败才 FAILED
  const allFailed = categoryResults.every((c) => c.failed > 0 && c.discovered === 0 && c.fetched === 0);
  const nextStatus = allFailed ? "FAILED" : "SUCCESS";
  await db.update(crawlJobs).set({
    status: nextStatus,
    finishedAt: new Date(),
    catalogResults: categoryResults,
    statsJson: stats as unknown as Record<string, unknown>,
    errorMessage: allFailed ? "全部栏目抓取失败" : null,
    updatedAt: new Date()
  }).where(eq(crawlJobs.id, crawlJobId));
  await db.update(standardSources).set({ lastCrawledAt: new Date(), updatedAt: new Date() }).where(eq(standardSources.id, source.id));

  // 顺带扫描：过渡期已结束的旧标准文档自动失效（无需独立定时任务）
  if (!allFailed) {
    const expired = await expireSupersededDocuments(db);
    if (expired > 0) stats.warnings.push(`${expired} 份过渡期已结束的标准文档已自动失效`);
  }

  if (allFailed) {
    throw new ServiceUnavailableError(`标准抓取失败：${stats.failed} 个详情页失败`);
  }
  return stats;
}