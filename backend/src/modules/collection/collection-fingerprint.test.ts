import { describe, expect, it } from "vitest";
import { canonicalizeCollectionUrl, collectionFingerprint, isSameOrigin } from "./collection-fingerprint.js";

describe("采集指纹与 URL 去重", () => {
  it("规范化 URL 后相同内容得到同一指纹", () => {
    const a = collectionFingerprint({ url: "https://Example.com/a/?b=1#x", title: "图集", content: "VICP 保温" });
    const b = collectionFingerprint({ url: "https://example.com/a?b=1", title: "图集", content: "VICP 保温" });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("不同正文不重复计数", () => {
    const a = collectionFingerprint({ url: "https://example.com/a", title: "A", content: "one" });
    const b = collectionFingerprint({ url: "https://example.com/a", title: "A", content: "two" });
    expect(a).not.toBe(b);
  });

  it("跟随链接限制同源", () => {
    expect(canonicalizeCollectionUrl("https://example.com/path/")).toBe("https://example.com/path");
    expect(isSameOrigin("https://example.com/a", "https://example.com/b")).toBe(true);
    expect(isSameOrigin("https://example.com/a", "https://other.com/b")).toBe(false);
  });
});
