import { createHash } from "node:crypto";

export function canonicalizeCollectionUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.endsWith("/") && url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return raw.trim().toLowerCase();
  }
}

export function collectionFingerprint(input: { url: string; title?: string | null; content?: string | null }): string {
  const canonical = canonicalizeCollectionUrl(input.url);
  const title = (input.title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const content = (input.content ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 4000);
  return createHash("sha256").update(`${canonical}\n${title}\n${content}`).digest("hex");
}

export function isSameOrigin(baseUrl: string, nextUrl: string): boolean {
  try {
    return new URL(baseUrl).origin === new URL(nextUrl, baseUrl).origin;
  } catch {
    return false;
  }
}
