import { describe, expect, it, vi } from "vitest";

// document.worker 现在引用 env（页面预览/文本层阈值），导入前注入测试环境变量
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});
import { partitionParsedPages, splitText, worksheetToSheetData } from "./document.worker.js";

describe("知识文本切片", () => {
  it("保留全部文本并限制单片长度", () => {
    const source = Array.from({ length: 40 }, (_, index) => `第${index + 1}条建筑节能资料。`).join("\n");
    const chunks = splitText(source, 120, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
    expect(chunks[0]).toContain("第1条建筑节能资料");
    expect(chunks.at(-1)).toContain("第40条建筑节能资料");
  });

  it("空白文本不生成切片", () => {
    expect(splitText("  \n\n  ")).toEqual([]);
  });
});

describe("exceljs 工作表转纯数据", () => {
  it("保留行列单元格并过滤空值", () => {
    const worksheet = {
      name: "热工表1",
      eachRow: (callback: (row: any) => void) => {
        callback({
          eachCell: (_options: unknown, cellCallback: (cell: any) => void) => {
            cellCallback({ col: 1, text: "构造层" });
            cellCallback({ col: 2, text: "厚度" });
            cellCallback({ col: 3, text: "" });
          }
        });
        callback({
          eachCell: (_options: unknown, cellCallback: (cell: any) => void) => {
            cellCallback({ col: 1, text: "保温层" });
            cellCallback({ col: 2, text: "100" });
          }
        });
      },
      model: { merges: [] }
    } as any;

    const sheet = worksheetToSheetData(worksheet);
    expect(sheet.name).toBe("热工表1");
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]!.map((cell) => cell.value)).toEqual(["构造层", "厚度"]);
    expect(sheet.rows[1]!.map((cell) => cell.value)).toEqual(["保温层", "100"]);
    expect(sheet.mergedCells).toEqual([]);
  });

  it("合并单元格按模型字符串范围转换为行列", () => {
    const worksheet = {
      name: "表2",
      eachRow: () => undefined,
      model: {
        merges: ["A1:C1", "A2:A4"]
      }
    } as any;

    const sheet = worksheetToSheetData(worksheet);
    expect(sheet.mergedCells).toEqual([
      { rowStart: 1, colStart: 1, rowEnd: 1, colEnd: 3 },
      { rowStart: 2, colStart: 1, rowEnd: 4, colEnd: 1 }
    ]);
  });

  it("空工作表不产出行", () => {
    const worksheet = {
      name: "空表",
      eachRow: () => undefined,
      model: { merges: [] }
    } as any;
    expect(worksheetToSheetData(worksheet).rows).toEqual([]);
  });
});

describe("DOCX 文本与知识页分离", () => {
  it("page 为空时不生成第 0 页，全文留给检索", () => {
    const result = partitionParsedPages([{ page: null, text: "保温构造说明" }]);
    expect(result.originalPages).toEqual([]);
    expect(result.contentPages).toEqual([]);
    expect(result.documentText).toBe("保温构造说明");
  });

  it("稳定页码仍作为知识页", () => {
    const result = partitionParsedPages([{ page: 2, text: "第二页" }]);
    expect(result.originalPages.map((page) => page.physical)).toEqual([2]);
    expect(result.documentText).toBeUndefined();
  });
});
