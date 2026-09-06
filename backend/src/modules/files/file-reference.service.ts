import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  constructionSchemes,
  enterpriseCertificates,
  enterpriseProfiles,
  files,
  knowledgeDocumentAssets,
  knowledgeDocuments,
  knowledgeDocumentVersions,
  nodeDrawings,
  productAttachments,
  reportArtifacts,
  reports,
  thermalImportJobs
} from "../../db/schema.js";
import { NotFoundError } from "../../shared/errors.js";

/** 文件引用聚合视图：业务关系表仍是唯一事实源，这里只做只读 UNION 聚合，不落第二真相源。 */
export type FileReference = {
  bizType:
    | "KNOWLEDGE"
    | "REPORT_ARTIFACT"
    | "ENTERPRISE_PROFILE"
    | "ENTERPRISE_CERTIFICATE"
    | "PRODUCT_ATTACHMENT"
    | "CONSTRUCTION_SCHEME"
    | "NODE_DRAWING"
    | "THERMAL_IMPORT";
  bizId: string;
  bizName: string;
  role: string;
};

type Db = FastifyInstance["db"];

async function selectReferences(db: Db, fileId: string, limit: number | undefined): Promise<FileReference[]> {
  const rows = await Promise.all([
    // 知识资料双源资产（ORIGINAL/SEARCH_SOURCE/OCR_SOURCE/PREVIEW）
    db.select({
      bizType: sql<"KNOWLEDGE">`'KNOWLEDGE'`,
      bizId: knowledgeDocumentAssets.documentId,
      bizName: knowledgeDocuments.title,
      role: knowledgeDocumentAssets.role
    }).from(knowledgeDocumentAssets)
      .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeDocumentAssets.documentId))
      .where(eq(knowledgeDocumentAssets.fileId, fileId)),
    // 历史版本主文件（无 ORIGINAL 资产行的旧数据）
    db.select({
      bizType: sql<"KNOWLEDGE">`'KNOWLEDGE'`,
      bizId: knowledgeDocumentVersions.documentId,
      bizName: knowledgeDocuments.title,
      role: sql<string>`'ORIGINAL'`
    }).from(knowledgeDocumentVersions)
      .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeDocumentVersions.documentId))
      .leftJoin(knowledgeDocumentAssets, and(
        eq(knowledgeDocumentAssets.versionId, knowledgeDocumentVersions.id),
        eq(knowledgeDocumentAssets.fileId, knowledgeDocumentVersions.fileId),
        eq(knowledgeDocumentAssets.role, "ORIGINAL")
      ))
      .where(and(eq(knowledgeDocumentVersions.fileId, fileId), isNull(knowledgeDocumentAssets.id))),
    // 报告产物（HTML/IMAGE/WORD/PDF 导出文件）
    db.select({
      bizType: sql<"REPORT_ARTIFACT">`'REPORT_ARTIFACT'`,
      bizId: reportArtifacts.reportId,
      bizName: reports.reportType,
      role: reportArtifacts.type
    }).from(reportArtifacts)
      .innerJoin(reports, eq(reports.id, reportArtifacts.reportId))
      .where(eq(reportArtifacts.fileId, fileId)),
    // 企业介绍 Logo
    db.select({
      bizType: sql<"ENTERPRISE_PROFILE">`'ENTERPRISE_PROFILE'`,
      bizId: enterpriseProfiles.id,
      bizName: enterpriseProfiles.name,
      role: sql<string>`'LOGO'`
    }).from(enterpriseProfiles)
      .where(eq(enterpriseProfiles.logoFileId, fileId)),
    // 企业证书
    db.select({
      bizType: sql<"ENTERPRISE_CERTIFICATE">`'ENTERPRISE_CERTIFICATE'`,
      bizId: enterpriseCertificates.id,
      bizName: enterpriseCertificates.certName,
      role: sql<string>`'CERTIFICATE'`
    }).from(enterpriseCertificates)
      .where(eq(enterpriseCertificates.fileId, fileId)),
    // 产品附件
    db.select({
      bizType: sql<"PRODUCT_ATTACHMENT">`'PRODUCT_ATTACHMENT'`,
      bizId: productAttachments.targetId,
      bizName: sql<string>`coalesce(${productAttachments.name}, ${productAttachments.targetType})`,
      role: productAttachments.attachmentType
    }).from(productAttachments)
      .where(eq(productAttachments.fileId, fileId)),
    // 构造方案图集图
    db.select({
      bizType: sql<"CONSTRUCTION_SCHEME">`'CONSTRUCTION_SCHEME'`,
      bizId: constructionSchemes.id,
      bizName: constructionSchemes.name,
      role: sql<string>`'DRAWING'`
    }).from(constructionSchemes)
      .where(eq(constructionSchemes.drawingFileId, fileId)),
    // 节点图高清图/CAD
    db.select({
      bizType: sql<"NODE_DRAWING">`'NODE_DRAWING'`,
      bizId: nodeDrawings.id,
      bizName: nodeDrawings.name,
      role: sql<string>`'IMAGE'`
    }).from(nodeDrawings)
      .where(eq(nodeDrawings.imageFileId, fileId)),
    db.select({
      bizType: sql<"NODE_DRAWING">`'NODE_DRAWING'`,
      bizId: nodeDrawings.id,
      bizName: nodeDrawings.name,
      role: sql<string>`'CAD'`
    }).from(nodeDrawings)
      .where(eq(nodeDrawings.cadFileId, fileId)),
    // 热工 Excel 导入作业
    db.select({
      bizType: sql<"THERMAL_IMPORT">`'THERMAL_IMPORT'`,
      bizId: thermalImportJobs.id,
      bizName: sql<string>`coalesce(${thermalImportJobs.name}, ${thermalImportJobs.setCode})`,
      role: sql<string>`'IMPORT_SOURCE'`
    }).from(thermalImportJobs)
      .where(eq(thermalImportJobs.fileId, fileId))
  ]);

  const seen = new Set<string>();
  const merged: FileReference[] = [];
  for (const group of rows) {
    for (const row of group) {
      const key = `${row.bizType}:${row.bizId}:${row.role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
      if (limit !== undefined && merged.length >= limit) return merged;
    }
  }
  return merged;
}

/** 文件被哪些业务使用（详情/回收保护提示用）；limit 用于列表摘要场景。 */
export async function getFileReferences(db: Db, fileId: string, limit?: number): Promise<FileReference[]> {
  return selectReferences(db, fileId, limit);
}

/** 单文件引用计数（回收/永久删除保护判断用），一次查询完成。 */
export async function getFileReferenceCount(db: Db, fileId: string): Promise<number> {
  const references = await selectReferences(db, fileId, undefined);
  return references.length;
}

/** 批量引用计数：列表页 referenceCount 专用，一次 UNION ALL 分组统计，避免 N+1。 */
export async function getFileReferenceCounts(db: Db, fileIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (fileIds.length === 0) return result;
  const rows = await db.execute(sql`
    select file_id, count(*)::int as total from (
      select file_id from knowledge_document_assets where file_id = any(${fileIds}::uuid[])
      union all
      select file_id from knowledge_document_versions where file_id = any(${fileIds}::uuid[])
      union all
      select file_id from report_artifacts where file_id = any(${fileIds}::uuid[])
      union all
      select logo_file_id as file_id from enterprise_profiles where logo_file_id = any(${fileIds}::uuid[])
      union all
      select file_id from enterprise_certificates where file_id = any(${fileIds}::uuid[])
      union all
      select file_id from product_attachments where file_id = any(${fileIds}::uuid[])
      union all
      select drawing_file_id as file_id from construction_schemes where drawing_file_id = any(${fileIds}::uuid[])
      union all
      select image_file_id as file_id from node_drawings where image_file_id = any(${fileIds}::uuid[])
      union all
      select cad_file_id as file_id from node_drawings where cad_file_id = any(${fileIds}::uuid[])
      union all
      select file_id from thermal_import_jobs where file_id = any(${fileIds}::uuid[])
    ) refs
    where file_id is not null
    group by file_id
  `);
  for (const row of rows as unknown as Array<{ file_id: string; total: number }>) {
    result.set(row.file_id, Number(row.total));
  }
  return result;
}

/** 回收保护：引用数 > 0 的文件禁止回收/永久删除。 */
export async function canRecycleFile(db: Db, fileId: string): Promise<{ recyclable: boolean; references: FileReference[] }> {
  const references = await getFileReferences(db, fileId);
  return { recyclable: references.length === 0, references };
}

/** 文件中心状态兜底：文件必须存在且未进入终态删除。 */
export async function requireActiveFileRow(db: Db, fileId: string) {
  const [file] = await db.select().from(files).where(and(eq(files.id, fileId), isNull(files.deletedAt))).limit(1);
  if (!file) throw new NotFoundError("文件不存在或已被删除");
  return file;
}
