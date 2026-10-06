import { canonicalizeCollectionUrl, isSameOrigin } from "./collection-fingerprint.js";

export const COLLECTION_AGENT_LIMITS = {
  maxSteps: 12,
  maxPages: 8,
  overallTimeoutMs: 120_000,
  pageTimeoutMs: 15_000,
  retries: 2,
  minIntervalMs: 500
} as const;

export type CollectionHttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type PageCache = {
  url: string;
  title: string;
  text: string;
  links: string[];
};

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtml(match?.[1] ?? "").slice(0, 200) || "未命名页面";
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((item) => item[1] ?? "");
  const unique = new Set<string>();
  for (const href of hrefs) {
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
    try {
      unique.add(new URL(href, baseUrl).toString());
    } catch {
      // ignore
    }
  }
  return [...unique];
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchPageTool(
  httpFetch: CollectionHttpFetch,
  url: string,
  timeoutMs = COLLECTION_AGENT_LIMITS.pageTimeoutMs
): Promise<PageCache> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= COLLECTION_AGENT_LIMITS.retries; attempt += 1) {
    try {
      const response = await httpFetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
        headers: { "User-Agent": "lg-vicp-collection-agent/1.0" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      return {
        url: canonicalizeCollectionUrl(url),
        title: extractTitle(html),
        text: stripHtml(html).slice(0, 20_000),
        links: extractLinks(html, url)
      };
    } catch (error) {
      lastError = error;
      await sleep(200 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("页面抓取失败");
}

export function searchInPageTool(page: PageCache, keywords: string[]) {
  const haystack = `${page.title}\n${page.text}`.toLowerCase();
  const hits = keywords.filter((keyword) => keyword.trim() && haystack.includes(keyword.trim().toLowerCase()));
  return { hits, matched: hits.length > 0 };
}

export function followLinkTool(input: {
  sourceUrl: string;
  candidateUrl: string;
  visited: Set<string>;
}) {
  const canonical = canonicalizeCollectionUrl(new URL(input.candidateUrl, input.sourceUrl).toString());
  if (!isSameOrigin(input.sourceUrl, canonical)) {
    return { skipped: true, reason: "CROSS_ORIGIN" as const, url: canonical };
  }
  if (input.visited.has(canonical)) {
    return { skipped: true, reason: "DUPLICATE_URL" as const, url: canonical };
  }
  return { skipped: false as const, url: canonical };
}

export function extractContentTool(page: PageCache, keywords: string[]) {
  return {
    title: page.title,
    url: page.url,
    summary: page.text.slice(0, 500),
    keywordsJson: keywords,
    rawDataJson: { textPreview: page.text.slice(0, 4000), linkCount: page.links.length }
  };
}
