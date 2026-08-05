import { describe, expect, it } from "vitest";
import { splitText, worksheetToSheetData } from "./document.worker.js";

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
