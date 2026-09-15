/**
 * 报告访问与项目绑定：report.projectId 可空。
 * 无项目报告归创建者；有项目时沿用项目可见性/管理权限。
 */
import type { AuthUser } from "../../shared/auth-user.js";
import { ReportError } from "../../shared/report-errors.js";
import { canManageProject, canViewProject } from "../../shared/permissions.js";
import { reportTypeDisplayName } from "./report-types.js";

export type ReportAccessRow = {
  id: string;
  projectId: string | null;
  createdById: string;
  reportType: string;
  contentJson: Record<string, unknown> | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  createdById: string;
  visibility: "PUBLIC" | "PRIVATE";
};

/** 会话有项目则继承；无项目则为 null。不要求用户再次选择项目。 */
export function resolveReportProjectId(conversationProjectId: string | null | undefined): string | null {
  return conversationProjectId ?? null;
}

export function assertReportProjectRequirement(options: {
  requiresProject: boolean;
  projectId: string | null | undefined;
}): void {
  if (options.requiresProject && !options.projectId) {
    throw new ReportError("REPORT_PROJECT_REQUIRED");
  }
}

export function canViewReport(
  user: AuthUser,
  report: Pick<ReportAccessRow, "createdById">,
  project: ProjectSummary | null
): boolean {
  if (project) return canViewProject(user, project);
  return user.role === "SUPER_ADMIN" || report.createdById === user.id;
}

export function canManageReport(
  user: AuthUser,
  report: Pick<ReportAccessRow, "createdById">,
  project: ProjectSummary | null
): boolean {
  if (project) return canManageProject(user, project);
  return user.role === "SUPER_ADMIN" || report.createdById === user.id;
}

export function reportListTitle(report: Pick<ReportAccessRow, "reportType" | "contentJson">): string {
  const raw = report.contentJson && typeof report.contentJson.title === "string"
    ? report.contentJson.title.trim()
    : "";
  if (raw) return raw;
  return reportTypeDisplayName(report.reportType);
}

export function toMyReportItem(report: ReportAccessRow & {
  status: string;
  createdAt: Date;
}, project: { id: string; name: string } | null) {
  return {
    id: report.id,
    title: reportListTitle(report),
    reportType: report.reportType,
    status: report.status,
    createdAt: report.createdAt,
    project: project ? { id: project.id, name: project.name } : null
  };
}
