import { describe, expect, it } from "vitest";
import { ReportError } from "../../shared/report-errors.js";
import {
  isTemplateBackedReportType,
  listPublicReportTypes,
  reportTypeRequiresReview,
  resolveReportType
} from "./report-types.js";
import { applyReportSettingsToSections, DEFAULT_REPORT_SETTINGS } from "./report-settings.service.js";
import type { ReportTemplateSection } from "../../db/schema.js";

describe("系统预置报告类型", () => {
  it("普通列表只返回 code/name/description/requiresProject/enabled，不暴露模板内部字段", () => {
    const items = listPublicReportTypes();
    expect(items.map((item) => item.code)).toEqual([
      "technical_scheme",
      "project_brief",
      "material_compare",
      "ai_conversation"
    ]);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(["code", "description", "enabled", "name", "requiresProject"].sort());
      expect(item).not.toHaveProperty("templateCode");
      expect(item).not.toHaveProperty("renderer");
      expect(item).not.toHaveProperty("templateVersionId");
    }
  });

  it("requiresProject：技术方案/简报需要项目，对话整理与材料对比不强制", () => {
    expect(resolveReportType("technical_scheme").requiresProject).toBe(true);
    expect(resolveReportType("project_brief").requiresProject).toBe(true);
    expect(resolveReportType("material_compare").requiresProject).toBe(false);
    expect(resolveReportType("ai_conversation").requiresProject).toBe(false);
  });

  it("未知类型拒绝", () => {
    expect(() => resolveReportType("not_a_type")).toThrow(ReportError);
  });

  it("历史 TEMPLATE 仍走模板渲染与审核；AI 旧类型不审核", () => {
    expect(isTemplateBackedReportType("TEMPLATE")).toBe(true);
    expect(isTemplateBackedReportType("technical_scheme")).toBe(true);
    expect(isTemplateBackedReportType("ai_conversation")).toBe(false);
    expect(reportTypeRequiresReview("TEMPLATE")).toBe(true);
    expect(reportTypeRequiresReview("energy_design")).toBe(false);
  });
});

describe("报告设置裁剪内部章节", () => {
  const sections: ReportTemplateSection[] = [
    { key: "thermal", title: "计算", enabled: true, order: 1, sourceType: "DATA" },
    { key: "sources", title: "引用", enabled: true, order: 2, sourceType: "DATA" },
    { key: "disclaimer", title: "免责声明", enabled: true, order: 3, sourceType: "TEXT", content: "模板文案" }
  ];

  it("默认设置不关闭章节", () => {
    const result = applyReportSettingsToSections(sections, DEFAULT_REPORT_SETTINGS);
    expect(result.every((section) => section.enabled)).toBe(true);
    expect(result.find((section) => section.key === "disclaimer")?.content).toBe("模板文案");
  });

  it("关闭计算过程/引用来源/免责声明，并允许覆盖免责声明文案", () => {
    const result = applyReportSettingsToSections(sections, {
      ...DEFAULT_REPORT_SETTINGS,
      showCalculationProcess: false,
      showSourceReferences: false,
      showDisclaimer: true,
      disclaimerText: "设置中的免责声明"
    });
    expect(result.find((section) => section.key === "thermal")?.enabled).toBe(false);
    expect(result.find((section) => section.key === "sources")?.enabled).toBe(false);
    expect(result.find((section) => section.key === "disclaimer")).toMatchObject({
      enabled: true,
      content: "设置中的免责声明"
    });
  });
});
