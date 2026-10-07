import { describe, expect, it } from "vitest";
import { getPageImageDownloadName } from "./knowledge-page-image.js";

describe("getPageImageDownloadName", () => {
  it("preserves PNG and JPEG extensions for signed page URLs", () => {
    expect(getPageImageDownloadName("knowledge/page-images/p1.png", 1)).toBe("page-1.png");
    expect(getPageImageDownloadName("knowledge/page-images/p2.jpg", 2)).toBe("page-2.jpg");
    expect(getPageImageDownloadName("knowledge/page-images/p3.jpeg", 3)).toBe("page-3.jpeg");
  });
});
