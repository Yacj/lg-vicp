import "dotenv/config";
import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  flattenValue,
  isEmptyValue,
  MISSING_MARK,
  renderTemplateHtml,
  type ReportSnapshotPayload
} from "./report-template-render.js";

const sections = [
  { key: "enterprise", title: "企业介绍", enabled: true, order: 1, sourceType: "DATA" as const },
  { key: "disclaimer", title: "免责声明", enabled: true, order: 2, sourceType: "TEXT" as const, content: "本报告仅供参考。" },
  { key: "comparison", title: "材料对比", enabled: false, order: 3, sourceType: "DATA" as const }
];

describe("模板报告确定性渲染（无 AI、无数据库）", () => {
  it("DATA 章节渲染快照数据、TEXT 章节渲染配置文案、禁用章节跳过、按 order 排序", () => {
    const html = renderTemplateHtml({
      title: "测试报告",
      template: { name: "标准工程报告", sections },
      enterprise: { name: "蓝格节能科技有限公司" }
    } as ReportSnapshotPayload);
    expect(html).toContain("<h1>测试报告</h1>");
    expect(html).toContain("<h2>企业介绍</h2>");
    expect(html).toContain("蓝格节能科技有限公司");
    expect(html).toContain("<h2>免责声明</h2>");
    expect(html).toContain("本报告仅供参考。");
    // 禁用章节不输出
    expect(html).not.toContain("<h2>材料对比</h2>");
    // 企业介绍（order 1）出现在免责声明（order 2）之前
    expect(html.indexOf("<h2>企业介绍</h2>")).toBeLessThan(html.indexOf("<h2>免责声明</h2>"));
  });

  it("快照内冻结的页眉页脚与封面标题参与渲染，不影响历史默认页脚", () => {
    const html = renderTemplateHtml({
      title: "原标题",
      template: { name: "标准工程报告", sections },
      enterprise: { name: "蓝格" },
      settings: { coverTitle: "封面标题", headerText: "页眉", footerText: "自定义页脚" }
    } as ReportSnapshotPayload);
    expect(html).toContain("封面标题");
    expect(html).toContain("页眉");
    expect(html).toContain("自定义页脚");
    expect(html).not.toContain("<h1>原标题</h1>");
  });

  it("缺失数据不吞错：章节显式标注待补充", () => {
    const html = renderTemplateHtml({
      title: "空报告",
      template: { sections }
    } as ReportSnapshotPayload);
    expect(html).toContain(MISSING_MARK);
    // 免责声明为 TEXT 章节不标缺失
    expect(html).toContain("本报告仅供参考。");
  });

  it("HTML 转义：标题与数据中的特殊字符不注入页面结构", () => {
    const html = renderTemplateHtml({
      title: "<script>alert(1)</script>",
      template: { sections },
      enterprise: { name: "A&B\"C" }
    } as ReportSnapshotPayload);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(escapeHtml("<script>alert(1)</script>"));
  });
});

describe("渲染辅助函数", () => {
  it("flattenValue：数组编号、对象键值、缺失标注", () => {
    expect(flattenValue([{ name: "A" }, { name: "B" }])).toContain("name：");
    expect(flattenValue([{ name: "A" }, { name: "B" }])).toContain("A");
    expect(flattenValue({ k: "v" })).toContain("k：");
    expect(flattenValue(null)).toBe(MISSING_MARK);
    expect(flattenValue("")).toBe(MISSING_MARK);
  });

  it("isEmptyValue：null/undefined/空串/空数组/空对象均为空", () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue("  ")).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue({})).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue("0")).toBe(false);
  });
});