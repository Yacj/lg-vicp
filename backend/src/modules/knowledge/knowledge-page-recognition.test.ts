import { describe, expect, it } from "vitest";
import {
  extractPageLabelFromFileName,
  emptyRecognitionMetadata,
  mergePageMetadata,
  pageRecognitionResultSchema,
  readPageRecognitionMeta
} from "../../shared/page-recognition.js";

function readPngWidth(buffer: Buffer): number | null {
  if (buffer.length < 24) return null;
  return buffer.readUInt32BE(16);
}

describe("extractPageLabelFromFileName", () => {
  it("解析 page-021.png → 21", () => {
    expect(extractPageLabelFromFileName("page-021.png")).toBe("21");
  });

  it("解析 page_022.jpg → 22", () => {
    expect(extractPageLabelFromFileName("page_022.jpg")).toBe("22");
  });

  it("解析嵌套路径 basename", () => {
    expect(extractPageLabelFromFileName("pages/page-023.png")).toBe("23");
  });
});

describe("page recognition metadata state", () => {
  it("识别完成进入 REVIEW_REQUIRED，不直接 CONFIRMED", () => {
    const meta = mergePageMetadata(null, emptyRecognitionMetadata({
      recognitionStatus: "REVIEW_REQUIRED",
      structuredData: pageRecognitionResultSchema.parse({
        fullText: "示例",
        systems: [{ constructionCode: "A1-1", options: [{ thicknessMm: 50, rValue: 1.2, kValue: 0.7 }] }]
      })
    }));
    expect(readPageRecognitionMeta(meta).recognitionStatus).toBe("REVIEW_REQUIRED");
    expect(readPageRecognitionMeta(meta).confirmedStructuredData).toBeNull();
  });

  it("重新识别保留 confirmedStructuredData", () => {
    const confirmed = pageRecognitionResultSchema.parse({ fullText: "旧确认", systems: [] });
    const meta = mergePageMetadata(
      emptyRecognitionMetadata({
        recognitionStatus: "CONFIRMED",
        structuredData: confirmed,
        confirmedStructuredData: confirmed
      }),
      {
        recognitionStatus: "PENDING",
        structuredData: null,
        confirmedStructuredData: confirmed
      }
    );
    const read = readPageRecognitionMeta(meta);
    expect(read.recognitionStatus).toBe("PENDING");
    expect(read.confirmedStructuredData?.fullText).toBe("旧确认");
  });
});

describe("PNG IHDR width", () => {
  it("读取最小 PNG IHDR 宽度", () => {
    const png = Buffer.alloc(33);
    png.write("\u0089PNG\r\n\u001a\n", 0, "binary");
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12);
    png.writeUInt32BE(1600, 16);
    png.writeUInt32BE(900, 20);
    expect(readPngWidth(png)).toBe(1600);
  });
});
