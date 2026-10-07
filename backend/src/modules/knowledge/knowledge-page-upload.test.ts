import { describe, expect, it } from "vitest";
import { unzipSync, zipSync, strToU8 } from "fflate";
import {
  extractPageLabelFromFileName,
  PAGE_IMAGE_MAX_BYTES,
  ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES
} from "../../shared/page-recognition.js";
import { detectPageImageMime, inspectZipCentralDirectory } from "./knowledge-page-upload.security.js";

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

  it("拒绝超过 200 张图片", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 1; i <= 201; i += 1) files[`page-${i}.png`] = new Uint8Array([1]);
    expect(() => inspectZipCentralDirectory(Buffer.from(zipSync(files))))
      .toThrowError(expect.objectContaining({ code: "ZIP_TOO_MANY_IMAGES" }));
  });

  it("拒绝 ZIP 路径穿越", () => {
    const zipped = zipSync({ "../evil.png": new Uint8Array([1]) });
    expect(() => inspectZipCentralDirectory(Buffer.from(zipped)))
      .toThrowError(expect.objectContaining({ code: "INVALID_ZIP_PATH" }));
  });

  it("解压前拒绝单图和总展开量超限", () => {
    const single = Buffer.from(zipSync({ "large.png": new Uint8Array([1]) }));
    const singleCentral = single.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    single.writeUInt32LE(PAGE_IMAGE_MAX_BYTES + 1, singleCentral + 24);
    expect(() => inspectZipCentralDirectory(single))
      .toThrowError(expect.objectContaining({ code: "PAGE_IMAGE_TOO_LARGE" }));

    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 21; i += 1) files[`p${i}.png`] = new Uint8Array([1]);
    const total = Buffer.from(zipSync(files));
    let offset = 0;
    while ((offset = total.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) >= 0) {
      total.writeUInt32LE(PAGE_IMAGE_MAX_BYTES, offset + 24);
      offset += 46;
    }
    expect(ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES).toBeLessThan(21 * PAGE_IMAGE_MAX_BYTES);
    expect(() => inspectZipCentralDirectory(total))
      .toThrowError(expect.objectContaining({ code: "ZIP_EXPANDED_TOO_LARGE" }));
  });

  it("拒绝 PNG 扩展名伪装的非图片内容", async () => {
    await expect(detectPageImageMime(Buffer.from("not an image"), "fake.png"))
      .rejects.toMatchObject({ code: "INVALID_PAGE_IMAGE" });
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
