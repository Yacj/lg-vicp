import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import type { ReportTemplateSection } from "../../db/schema.js";
import { reportSettings } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { listPublishedEnterpriseProfiles } from "../masterdata/md-read.service.js";
import type { reportSettingsUpdateSchema } from "./report-settings.schemas.js";
import type { z } from "zod";

export type ReportExportFormat = "PDF" | "DOCX";

/** 生成时冻结进快照的报告设置（不含只读派生字段） */
export type ReportSettingsValues = {
  defaultReportType: string | null;
  coverTitle: string | null;
  showCalculationProcess: boolean;
  showSourceReferences: boolean;
  showDisclaimer: boolean;
  disclaimerText: string | null;
  headerText: string | null;
  footerText: string | null;
  defaultExportFormat: ReportExportFormat;
};

export const DEFAULT_REPORT_SETTINGS: ReportSettingsValues = {
  defaultReportType: "technical_scheme",
  coverTitle: null,
  showCalculationProcess: true,
  showSourceReferences: true,
  showDisclaimer: true,
  disclaimerText: null,
  headerText: null,
  footerText: null,
  defaultExportFormat: "PDF"
};

export type ReportSettingsDto = ReportSettingsValues & {
  companyLogoFileId: string | null;
  updatedAt: Date | null;
};

type SettingsUpdateInput = z.infer<typeof reportSettingsUpdateSchema>;

function toValues(row: typeof reportSettings.$inferSelect | undefined): ReportSettingsValues {
  if (!row) return { ...DEFAULT_REPORT_SETTINGS };
  const format = row.defaultExportFormat === "DOCX" ? "DOCX" : "PDF";
  return {
    defaultReportType: row.defaultReportType ?? DEFAULT_REPORT_SETTINGS.defaultReportType,
    coverTitle: row.coverTitle,
    showCalculationProcess: row.showCalculationProcess,
    showSourceReferences: row.showSourceReferences,
    showDisclaimer: row.showDisclaimer,
    disclaimerText: row.disclaimerText,
    headerText: row.headerText,
    footerText: row.footerText,
    defaultExportFormat: format
  };
}

async function publishedCompanyLogoFileId(app: FastifyInstance): Promise<string | null> {
  const profiles = await listPublishedEnterpriseProfiles(app.db);
  const logoFileId = profiles[0]?.logoFileId;
  return typeof logoFileId === "string" ? logoFileId : null;
}

export async function loadReportSettingsValues(app: FastifyInstance): Promise<ReportSettingsValues> {
  const [row] = await app.db.select().from(reportSettings)
    .where(eq(reportSettings.key, "default")).limit(1);
  return toValues(row);
}

export async function getReportSettings(app: FastifyInstance): Promise<ReportSettingsDto> {
  const [row] = await app.db.select().from(reportSettings)
    .where(eq(reportSettings.key, "default")).limit(1);
  return {
    ...toValues(row),
    companyLogoFileId: await publishedCompanyLogoFileId(app),
    updatedAt: row?.updatedAt ?? null
  };
}

export async function updateReportSettings(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: SettingsUpdateInput
): Promise<ReportSettingsDto> {
  const current = await loadReportSettingsValues(app);
  const next: ReportSettingsValues = {
    defaultReportType: input.defaultReportType === undefined ? current.defaultReportType : input.defaultReportType,
    coverTitle: input.coverTitle === undefined ? current.coverTitle : input.coverTitle,
    showCalculationProcess: input.showCalculationProcess ?? current.showCalculationProcess,
    showSourceReferences: input.showSourceReferences ?? current.showSourceReferences,
    showDisclaimer: input.showDisclaimer ?? current.showDisclaimer,
    disclaimerText: input.disclaimerText === undefined ? current.disclaimerText : input.disclaimerText,
    headerText: input.headerText === undefined ? current.headerText : input.headerText,
    footerText: input.footerText === undefined ? current.footerText : input.footerText,
    defaultExportFormat: input.defaultExportFormat ?? current.defaultExportFormat
  };

  await app.db.transaction(async (tx) => {
    const [existing] = await tx.select().from(reportSettings)
      .where(eq(reportSettings.key, "default")).limit(1);
    if (existing) {
      await tx.update(reportSettings).set({
        ...next,
        updatedById: actor.id,
        updatedAt: new Date()
      }).where(eq(reportSettings.id, existing.id));
    } else {
      await tx.insert(reportSettings).values({
        key: "default",
        ...next,
        updatedById: actor.id
      });
    }
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.REPORT_SETTINGS_UPDATED, targetType: "report_settings", targetId: existing?.id ?? "default",
      beforeJson: current, afterJson: next
    });
  });

  return getReportSettings(app);
}

/** 按报告设置开关裁剪内部模板章节；免责声明文案优先使用设置。 */
export function applyReportSettingsToSections(
  sections: ReportTemplateSection[],
  settings: ReportSettingsValues
): ReportTemplateSection[] {
  return sections.map((section) => {
    if (section.key === "thermal" && !settings.showCalculationProcess) {
      return { ...section, enabled: false };
    }
    if (section.key === "sources" && !settings.showSourceReferences) {
      return { ...section, enabled: false };
    }
    if (section.key === "disclaimer") {
      if (!settings.showDisclaimer) return { ...section, enabled: false };
      const content = settings.disclaimerText?.trim() || section.content;
      return { ...section, content };
    }
    return section;
  });
}
