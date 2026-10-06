import { describe, expect, it } from "vitest";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { extractPageLabelFromFileName } from "../../shared/page-recognition.js";

/** 纯函数级 ZIP/manifest 约定测试（不落库） */
describe("ZIP page import conventions", () => {
  it("79 张 page-NNN.png 文件名可解析 label，且数量正确", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 1; i <= 79; i += 1) {
      const label = String(i).padStart(3, "0");
      files[`page-${label}.png`] = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    }
    const zipped = zipSync(files);
    const extracted = unzipSync(zipped);
    const names = Object.keys(extracted).filter((name) => name.endsWith(".png")).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    expect(names).toHaveLength(79);
    expect(extractPageLabelFromFileName(names[20]!)).toBe("21");
    expect(extractPageLabelFromFileName("page-021.png")).toBe("21");
  });

  it("manifest.json 可指定 pageLabel / physicalPageNumber", () => {
    const manifest = [
      { file: "page-022.png", pageLabel: "22", physicalPageNumber: 2, pageTitle: "热工选用表" }
    ];
    const files = {
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "page-022.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    };
    const extracted = unzipSync(zipSync(files));
    const parsed = JSON.parse(Buffer.from(extracted["manifest.json"]!).toString("utf8"));
    expect(parsed[0].pageLabel).toBe("22");
    expect(parsed[0].physicalPageNumber).toBe(2);
    expect(extractPageLabelFromFileName(parsed[0].file)).toBe("22");
  });
});
