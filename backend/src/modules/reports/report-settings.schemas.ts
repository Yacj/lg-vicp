import { z } from "zod";
import { PUBLIC_REPORT_TYPE_CODES } from "./report-types.js";

export const reportExportFormatSchema = z.enum(["PDF", "DOCX"]);

export const reportSettingsUpdateSchema = z.object({
  defaultReportType: z.enum(PUBLIC_REPORT_TYPE_CODES).nullable().optional(),
  coverTitle: z.string().trim().max(200).nullable().optional(),
  showCalculationProcess: z.boolean().optional(),
  showSourceReferences: z.boolean().optional(),
  showDisclaimer: z.boolean().optional(),
  disclaimerText: z.string().trim().max(10000).nullable().optional(),
  headerText: z.string().trim().max(200).nullable().optional(),
  footerText: z.string().trim().max(200).nullable().optional(),
  defaultExportFormat: reportExportFormatSchema.optional()
});

export const reportSettingsDto = z.object({
  defaultReportType: z.string().nullable(),
  companyLogoFileId: z.string().uuid().nullable(),
  coverTitle: z.string().nullable(),
  showCalculationProcess: z.boolean(),
  showSourceReferences: z.boolean(),
  showDisclaimer: z.boolean(),
  disclaimerText: z.string().nullable(),
  headerText: z.string().nullable(),
  footerText: z.string().nullable(),
  defaultExportFormat: reportExportFormatSchema,
  updatedAt: z.date().nullable()
});

export const publicReportTypeDto = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string(),
  requiresProject: z.boolean(),
  enabled: z.boolean()
});
