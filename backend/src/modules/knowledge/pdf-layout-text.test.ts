import { describe, expect, it } from "vitest";
import { detectColumnGutter, reconstructPageText } from "./pdf-layout-text.js";

describe("reconstructPageText", () => {
  it("双栏按左栏从上到下、再右栏从上到下，不把同一 Y 的左右栏拼成一行", () => {
    const items = [
      { text: "一、概述", x: 80, y: 420, width: 50, height: 12 },
      { text: "左栏段落一", x: 80, y: 400, width: 80, height: 12 },
      { text: "左栏段落二", x: 80, y: 380, width: 80, height: 12 },
      { text: "左栏段落三", x: 80, y: 360, width: 80, height: 12 },
      { text: "二、编制依据", x: 80, y: 340, width: 60, height: 12 },
      { text: "GB 55015", x: 80, y: 320, width: 50, height: 12 },
      { text: "《民用建筑热工设计规范》", x: 400, y: 420, width: 140, height: 12 },
      { text: "GB 50176-2016", x: 400, y: 400, width: 80, height: 12 },
      { text: "右栏标准二", x: 400, y: 380, width: 80, height: 12 },
      { text: "右栏标准三", x: 400, y: 360, width: 80, height: 12 },
      { text: "右栏标准四", x: 400, y: 340, width: 80, height: 12 },
      { text: "三、适用范围", x: 400, y: 200, width: 60, height: 12 }
    ];
    const result = reconstructPageText(items, 700, 500);
    expect(result.columnCount).toBe(2);
    expect(result.text).toContain("一、概述");
    expect(result.text.indexOf("一、概述")).toBeLessThan(result.text.indexOf("《民用建筑热工设计规范》"));
    expect(result.text.indexOf("一、概述")).toBeLessThan(result.text.indexOf("三、适用范围"));
    expect(result.text).not.toContain("一、概述《民用建筑热工设计规范》");
  });

  it("单栏页面保持从上到下、从左到右", () => {
    const result = reconstructPageText([
      { text: "总说明", x: 80, y: 400, width: 40, height: 14 },
      { text: "正文", x: 80, y: 380, width: 30, height: 12 }
    ], 600, 500);
    expect(result.columnCount).toBe(1);
    expect(result.text).toBe("总说明\n正文");
  });

  it("剔除页脚图框模板，不把页次数字拼进正文", () => {
    const result = reconstructPageText([
      { text: "一、概述", x: 80, y: 300, width: 50, height: 12 },
      { text: "页 次", x: 500, y: 40, width: 20, height: 10 },
      { text: "4", x: 560, y: 40, width: 8, height: 10 },
      { text: "图集号", x: 500, y: 55, width: 22, height: 10 },
      { text: "J/CABEE 26J702", x: 540, y: 55, width: 50, height: 10 }
    ], 700, 500);
    expect(result.text).toContain("一、概述");
    expect(result.text).not.toContain("J/CABEE");
    expect(result.text.split("\n").includes("4")).toBe(false);
  });
});

describe("detectColumnGutter", () => {
  it("左右两簇文本才能判定为双栏", () => {
    const left = Array.from({ length: 10 }, (_, index) => ({
      text: `L${index}`, x: 60, y: 400 - index * 12, width: 40, height: 10
    }));
    const right = Array.from({ length: 10 }, (_, index) => ({
      text: `R${index}`, x: 420, y: 400 - index * 12, width: 40, height: 10
    }));
    expect(detectColumnGutter([...left, ...right], 700)).toBeGreaterThan(200);
    expect(detectColumnGutter(left, 700)).toBeNull();
  });
});
