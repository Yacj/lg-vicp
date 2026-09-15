import { describe, expect, it } from "vitest";
import { ReportError } from "../../shared/report-errors.js";
import {
  assertReportProjectRequirement,
  canManageReport,
  canViewReport,
  reportListTitle,
  resolveReportProjectId,
  toMyReportItem
} from "./report-access.js";

const owner = { id: "u-1", role: "NORMAL_USER" } as const;
const other = { id: "u-2", role: "NORMAL_USER" } as const;
const admin = { id: "u-9", role: "SUPER_ADMIN" } as const;
const project = { id: "p-1", name: "苏州住宅", createdById: "u-1", visibility: "PRIVATE" as const };

describe("报告 projectId 可空", () => {
  it("会话有项目则报告继承项目，无项目则为 null", () => {
    expect(resolveReportProjectId("p-1")).toBe("p-1");
    expect(resolveReportProjectId(null)).toBeNull();
    expect(resolveReportProjectId(undefined)).toBeNull();
  });

  it("默认报告类型不要求项目；requiresProject 才拦截", () => {
    expect(() => assertReportProjectRequirement({ requiresProject: false, projectId: null })).not.toThrow();
    expect(() => assertReportProjectRequirement({ requiresProject: true, projectId: null }))
      .toThrow(ReportError);
    expect(() => assertReportProjectRequirement({ requiresProject: true, projectId: "p-1" })).not.toThrow();
  });
});

describe("无项目报告权限", () => {
  const report = { createdById: "u-1" };

  it("无项目报告仅创建者和超级管理员可看可管", () => {
    expect(canViewReport(owner as never, report, null)).toBe(true);
    expect(canManageReport(owner as never, report, null)).toBe(true);
    expect(canViewReport(other as never, report, null)).toBe(false);
    expect(canManageReport(admin as never, report, null)).toBe(true);
  });

  it("有项目时沿用项目权限", () => {
    expect(canViewReport(owner as never, report, project)).toBe(true);
    expect(canManageReport(other as never, report, project)).toBe(false);
  });
});

describe("我的报告列表项", () => {
  it("无项目时 project 为 null，不返回“无”", () => {
    const item = toMyReportItem({
      id: "r-1",
      projectId: null,
      createdById: "u-1",
      reportType: "energy_design",
      contentJson: { title: "节能说明" },
      status: "DRAFT",
      createdAt: new Date("2026-09-12T00:00:00.000Z")
    }, null);
    expect(item.project).toBeNull();
    expect(item.title).toBe("节能说明");
    expect(JSON.stringify(item)).not.toContain("无");
  });

  it("按项目筛选时返回项目摘要", () => {
    const item = toMyReportItem({
      id: "r-2",
      projectId: "p-1",
      createdById: "u-1",
      reportType: "design_note",
      contentJson: {},
      status: "READY",
      createdAt: new Date()
    }, { id: "p-1", name: "苏州住宅" });
    expect(item.project).toEqual({ id: "p-1", name: "苏州住宅" });
    expect(item.title).toBe("VICP 设计说明");
  });

  it("标题回退到报告类型中文名", () => {
    expect(reportListTitle({ reportType: "marketing_copy", contentJson: null })).toBe("VICP 项目说明");
    expect(reportListTitle({ reportType: "technical_scheme", contentJson: null })).toBe("综合技术方案报告");
    expect(reportListTitle({ reportType: "ai_conversation", contentJson: null })).toBe("AI对话整理报告");
  });
});
