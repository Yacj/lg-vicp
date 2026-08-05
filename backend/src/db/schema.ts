import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type PgColumn
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const userRoleEnum = pgEnum("user_role", ["SUPER_ADMIN", "CHANNEL_USER", "NORMAL_USER"]);
export const channelTypeEnum = pgEnum("channel_type", ["DEALER", "SALESPERSON"]);
export const userStatusEnum = pgEnum("user_status", ["ACTIVE", "DISABLED"]);
export const userGenderEnum = pgEnum("user_gender", ["UNKNOWN", "MALE", "FEMALE"]);
export const authClientEnum = pgEnum("auth_client", ["B_ADMIN", "C_APP", "PC_AI"]);
export const identityTypeEnum = pgEnum("identity_type", [
  "USERNAME",
  "PHONE",
  "EMAIL",
  "WECHAT_OPENID",
  "WECHAT_UNIONID"
]);
export const projectVisibilityEnum = pgEnum("project_visibility", ["PRIVATE", "PUBLIC"]);
export const visibilityPolicyEnum = pgEnum("visibility_policy", ["LOGGED_IN_USERS"]);
export const projectMemberRoleEnum = pgEnum("project_member_role", ["OWNER", "EDITOR", "VIEWER"]);
export const fileStatusEnum = pgEnum("file_status", [
  "UPLOADING",
  "UPLOADED",
  "QUEUED",
  "PARSING",
  "OCR_REQUIRED",
  "INDEXING",
  "READY",
  "FAILED",
  "DELETED"
]);
export const asyncTaskStatusEnum = pgEnum("async_task_status", [
  "QUEUED",
  "ACTIVE",
  "COMPLETED",
  "FAILED"
]);
export const cronJobStatusEnum = pgEnum("cron_job_status", ["PAUSED", "RUNNING", "DISABLED"]);
export const cronExecutionStatusEnum = pgEnum("cron_execution_status", ["QUEUED", "RUNNING", "SUCCESS", "FAILED", "CANCELLED"]);
export const loginResultEnum = pgEnum("login_result", ["SUCCESS", "FAILED"]);
export const aiProviderTypeEnum = pgEnum("ai_provider_type", ["OPENAI_COMPATIBLE"]);
export const aiPromptVersionStatusEnum = pgEnum("ai_prompt_version_status", ["DRAFT", "PUBLISHED", "DISABLED"]);
export const menuTypeEnum = pgEnum("menu_type", ["DIRECTORY", "MENU", "BUTTON"]);
export const dataScopeEnum = pgEnum("data_scope", ["ALL", "DEPT", "DEPT_AND_CHILDREN", "SELF", "CUSTOM", "PROJECT_OWNER"]);
export const aiMessageRoleEnum = pgEnum("ai_message_role", ["SYSTEM", "USER", "ASSISTANT", "TOOL"]);
export const aiMessageStatusEnum = pgEnum("ai_message_status", ["PENDING", "STREAMING", "COMPLETED", "STOPPED", "FAILED"]);
export const aiReasoningModeEnum = pgEnum("ai_reasoning_mode", ["OFF", "ON"]);
export const aiFeedbackReactionEnum = pgEnum("ai_feedback_reaction", ["LIKE", "DISLIKE"]);
export const reportStatusEnum = pgEnum("report_status", ["DRAFT", "QUEUED", "GENERATING", "READY", "FAILED"]);
export const reportArtifactTypeEnum = pgEnum("report_artifact_type", ["HTML", "IMAGE", "WORD", "PDF"]);
export const shareTargetTypeEnum = pgEnum("share_target_type", ["AI_MESSAGES", "REPORT", "REPORT_ARTIFACT", "PROJECT"]);

export const knowledgeDocTypeEnum = pgEnum("knowledge_doc_type", [
  "SPECIFICATION", // 应用技术规程
  "DETAIL_ATLAS", // 建筑构造图集
  "STANDARD", // 国家标准/行业标准
  "APPLICATION_GUIDE", // 应用技术资料
  "MATERIAL_COMPARISON", // 材料对比
  "COMPANY_PROFILE", // 企业简介
  "THERMAL_FORMULA", // 热工计算表格公式
  "OTHER"
]);
// 证据等级取值与对应关系待甲方确认（见 docs/knowledge/README.md）
export const knowledgeEvidenceLevelEnum = pgEnum("knowledge_evidence_level", ["A", "B", "C"]);
export const knowledgeDocStatusEnum = pgEnum("knowledge_doc_status", ["ACTIVE", "DISABLED"]);
export const knowledgeVersionStatusEnum = pgEnum("knowledge_version_status", [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "DISABLED"
]);
export const knowledgeParseStatusEnum = pgEnum("knowledge_parse_status", [
  "PENDING",
  "PARSING",
  "PARSED",
  "PARTIAL",
  "OCR_REQUIRED",
  "FAILED"
]);
export const knowledgeChunkContentTypeEnum = pgEnum("knowledge_chunk_content_type", [
  "PARAGRAPH",
  "TITLE",
  "SECTION",
  "CLAUSE",
  "TABLE",
  "NOTE",
  "FORMULA",
  "IMAGE_CAPTION"
]);
export const knowledgeTermTypeEnum = pgEnum("knowledge_term_type", ["KEYWORD", "SYNONYM", "ENTITY", "CLAUSE_NO"]);
export const parsingJobTypeEnum = pgEnum("parsing_job_type", ["PARSE", "REPARSE", "CHUNK_REBUILD", "OCR"]);
export const parsingJobStatusEnum = pgEnum("parsing_job_status", [
  "QUEUED",
  "ACTIVE",
  "COMPLETED",
  "FAILED",
  "OCR_REQUIRED"
]);
export const knowledgeFileSourceEnum = pgEnum("knowledge_file_source", [
  "USER_UPLOAD",
  "BATCH_IMPORT",
  "CRAWLER",
  "INTERNAL_API"
]);
// 版本处理管线状态：与 versions.status（受控审核 DRAFT/APPROVED/PUBLISHED/DISABLED）双轨
export const knowledgePipelineStatusEnum = pgEnum("knowledge_pipeline_status", [
  "UPLOAD_PENDING",
  "UPLOADED",
  "PARSING",
  "CHUNKING",
  "REVIEW_PENDING",
  "PUBLISHED",
  "FAILED"
]);
export const knowledgeEvaluationJudgementEnum = pgEnum("knowledge_evaluation_judgement", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PARTIAL"
]);
// ---------------------------------------------------------------- 主数据（企业/产品/材料参数）
// 审核状态机：DRAFT -> PENDING_REVIEW -> APPROVED -> PUBLISHED -> DISABLED；PENDING_REVIEW 可驳回为 REJECTED。
// 与知识库版本状态枚举差异：主数据需要"驳回"决议（甲方验收：参数冲突可见且有审核决议）。
export const mdReviewStatusEnum = pgEnum("md_review_status", [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "DISABLED",
  "REJECTED"
]);
// 产品性能参数来源：技术规程值 / 图集值 / 检测值 / 企业标称值，四种来源可并存展示冲突
export const mdParamSourceEnum = pgEnum("md_param_source", [
  "TECHNICAL_REGULATION",
  "ATLAS",
  "DETECTION",
  "ENTERPRISE_NOMINAL"
]);
export const mdSpecClassEnum = pgEnum("md_spec_class", ["I", "II", "III"]);
export const mdStandardTypeEnum = pgEnum("md_standard_type", ["STANDARD", "CUSTOM"]);
export const mdProductionStatusEnum = pgEnum("md_production_status", ["PRODUCING", "STOPPED"]);
export const mdAttachmentTargetTypeEnum = pgEnum("md_attachment_target_type", [
  "PRODUCT_SERIES",
  "PRODUCT_SPEC",
  "ENTERPRISE"
]);
// 构造层类型：基层层 / 产品层（VICP 板）/ 固定层 / 可变层；layerOrder 按外到内从 1 递增
export const constructionLayerTypeEnum = pgEnum("construction_layer_type", [
  "BASE_LAYER",
  "PRODUCT_LAYER",
  "FIXING_LAYER",
  "VARIABLE_LAYER"
]);
// 方案文档挂载目标：保温系统 / 构造方案（多态引用，应用层校验目标存在）
export const schemeDocumentTargetTypeEnum = pgEnum("scheme_document_target_type", ["SYSTEM", "SCHEME"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 255 }),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    gender: userGenderEnum("gender").notNull().default("UNKNOWN"),
    remark: text("remark"),
    role: userRoleEnum("role").notNull().default("NORMAL_USER"),
    channelType: channelTypeEnum("channel_type"),
    status: userStatusEnum("status").notNull().default("ACTIVE"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("users_phone_unique").on(table.phone),
    uniqueIndex("users_email_unique").on(table.email),
    index("users_role_status_idx").on(table.role, table.status)
  ]
);

export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: identityTypeEnum("type").notNull(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    passwordHash: text("password_hash"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("user_identities_type_identifier_unique").on(table.type, table.identifier),
    index("user_identities_user_idx").on(table.userId)
  ]
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    clientType: authClientEnum("client_type").notNull().default("B_ADMIN"),
    accessJti: varchar("access_jti", { length: 64 }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedByTokenId: uuid("replaced_by_token_id"),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("refresh_tokens_hash_unique").on(table.tokenHash),
    index("refresh_tokens_user_expires_idx").on(table.userId, table.expiresAt)
  ]
);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  dataScope: dataScopeEnum("data_scope").notNull().default("SELF"),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps
});

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 120 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  resource: varchar("resource", { length: 80 }).notNull(),
  action: varchar("action", { length: 40 }).notNull(),
  description: text("description"),
  ...timestamps
});

export const menus = pgTable(
  "menus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id"),
    menuType: menuTypeEnum("menu_type").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    routePath: varchar("route_path", { length: 255 }),
    component: varchar("component", { length: 255 }),
    icon: varchar("icon", { length: 120 }),
    sortOrder: integer("sort_order").notNull().default(0),
    isExternal: boolean("is_external").notNull().default(false),
    visible: boolean("visible").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    permissionCode: varchar("permission_code", { length: 120 }).references(() => permissions.code, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    index("menus_parent_sort_idx").on(table.parentId, table.sortOrder),
    index("menus_permission_idx").on(table.permissionCode),
    index("menus_enabled_visible_idx").on(table.enabled, table.visible),
    uniqueIndex("menus_route_path_unique").on(table.routePath)
  ]
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("user_roles_unique").on(table.userId, table.roleId)]
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("role_permissions_unique").on(table.roleId, table.permissionId)]
);

export const roleDepartments = pgTable(
  "role_departments",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("role_departments_unique").on(table.roleId, table.departmentId)]
);

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id"),
    code: varchar("code", { length: 80 }).notNull().unique(),
    name: varchar("name", { length: 120 }).notNull(),
    leader: varchar("leader", { length: 120 }),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 255 }),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [index("departments_parent_idx").on(table.parentId)]
);

export const userDepartments = pgTable(
  "user_departments",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("user_departments_unique").on(table.userId, table.departmentId)]
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    remark: text("remark"),
    ...timestamps
  },
  (table) => [index("posts_enabled_sort_idx").on(table.enabled, table.sortOrder)]
);

export const userPosts = pgTable(
  "user_posts",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("user_posts_unique").on(table.userId, table.postId)]
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    region: varchar("region", { length: 80 }),
    buildingType: varchar("building_type", { length: 80 }),
    visibility: projectVisibilityEnum("visibility").notNull().default("PRIVATE"),
    visibilityPolicy: visibilityPolicyEnum("visibility_policy").notNull().default("LOGGED_IN_USERS"),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdById: uuid("created_by_id").notNull().references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index("projects_creator_idx").on(table.createdById),
    index("projects_visibility_status_idx").on(table.visibility, table.status)
  ]
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: projectMemberRoleEnum("role").notNull().default("VIEWER"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("project_members_project_user_unique").on(table.projectId, table.userId),
    index("project_members_user_idx").on(table.userId)
  ]
);

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
    storageProvider: varchar("storage_provider", { length: 20 }).notNull(),
    bucket: varchar("bucket", { length: 120 }).notNull(),
    objectKey: text("object_key").notNull(),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 160 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }),
    source: knowledgeFileSourceEnum("source").notNull().default("USER_UPLOAD"),
    status: fileStatusEnum("status").notNull().default("UPLOADING"),
    errorMessage: text("error_message"),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("files_bucket_key_unique").on(table.bucket, table.objectKey),
    index("files_project_status_idx").on(table.projectId, table.status),
    index("files_owner_idx").on(table.ownerUserId),
    index("files_sha256_idx").on(table.sha256)
  ]
);

export const asyncTasks = pgTable(
  "async_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queueName: varchar("queue_name", { length: 80 }).notNull(),
    jobType: varchar("job_type", { length: 80 }).notNull(),
    businessType: varchar("business_type", { length: 80 }),
    businessId: uuid("business_id"),
    bullJobId: varchar("bull_job_id", { length: 120 }),
    status: asyncTaskStatusEnum("status").notNull().default("QUEUED"),
    progress: integer("progress").notNull().default(0),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index("async_tasks_business_idx").on(table.businessType, table.businessId),
    index("async_tasks_status_idx").on(table.status, table.createdAt)
  ]
);

export const knowledgeCategories = pgTable(
  "knowledge_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id"),
    name: varchar("name", { length: 120 }).notNull(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    description: text("description"),
    ...timestamps
  },
  (table) => [
    index("knowledge_categories_parent_idx").on(table.parentId),
    index("knowledge_categories_enabled_sort_idx").on(table.enabled, table.sortOrder)
  ]
);

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 兼容旧链路：新链路文件归属在版本表，文档本身可不持有文件
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    docNumber: varchar("doc_number", { length: 80 }),
    docType: knowledgeDocTypeEnum("doc_type").notNull().default("OTHER"),
    sourceOrg: varchar("source_org", { length: 255 }),
    region: varchar("region", { length: 80 }),
    issueDate: date("issue_date"),
    effectiveDate: date("effective_date"),
    evidenceLevel: knowledgeEvidenceLevelEnum("evidence_level"),
    allowedPurposes: jsonb("allowed_purposes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    categoryId: uuid("category_id").references((): PgColumn => knowledgeCategories.id, { onDelete: "set null" }),
    currentVersionId: uuid("current_version_id").references((): PgColumn => knowledgeDocumentVersions.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    pageCount: integer("page_count"),
    parser: varchar("parser", { length: 80 }).notNull().default("none"),
    status: knowledgeDocStatusEnum("status").notNull().default("ACTIVE"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("knowledge_documents_file_version_unique").on(table.fileId, table.version),
    index("knowledge_documents_status_category_idx").on(table.status, table.categoryId),
    index("knowledge_documents_doc_type_status_idx").on(table.docType, table.status),
    index("knowledge_documents_deleted_idx").on(table.deletedAt)
  ]
);

export const knowledgeDocumentVersions = pgTable(
  "knowledge_document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    title: varchar("title", { length: 255 }).notNull(),
    status: knowledgeVersionStatusEnum("status").notNull().default("DRAFT"),
    pipelineStatus: knowledgePipelineStatusEnum("pipeline_status").notNull().default("UPLOAD_PENDING"),
    parseStatus: knowledgeParseStatusEnum("parse_status").notNull().default("PENDING"),
    pageCount: integer("page_count"),
    parser: varchar("parser", { length: 80 }),
    evidenceLevel: knowledgeEvidenceLevelEnum("evidence_level"),
    changeNote: text("change_note"),
    effectiveDate: date("effective_date"),
    expiryDate: date("expiry_date"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    publishedById: uuid("published_by_id").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("knowledge_document_versions_document_version_unique").on(table.documentId, table.version),
    index("knowledge_document_versions_document_status_idx").on(table.documentId, table.status),
    index("knowledge_document_versions_status_updated_idx").on(table.status, table.updatedAt),
    index("knowledge_document_versions_pipeline_idx").on(table.pipelineStatus, table.updatedAt),
    index("knowledge_document_versions_file_idx").on(table.fileId)
  ]
);

export const knowledgePages = pgTable(
  "knowledge_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull().references(() => knowledgeDocumentVersions.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    parsedText: text("parsed_text"),
    pageImageObjectKey: varchar("page_image_object_key", { length: 512 }),
    sectionPath: varchar("section_path", { length: 255 }),
    hasTables: boolean("has_tables").notNull().default(false),
    hasImages: boolean("has_images").notNull().default(false),
    parseStatus: knowledgeParseStatusEnum("parse_status").notNull().default("PARSED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("knowledge_pages_version_page_unique").on(table.versionId, table.pageNumber),
    index("knowledge_pages_document_version_idx").on(table.documentId, table.versionId),
    index("knowledge_pages_version_section_idx").on(table.versionId, table.sectionPath)
  ]
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull().references(() => knowledgeDocumentVersions.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    sourcePage: integer("source_page"),
    pageEnd: integer("page_end"),
    sourceSection: varchar("source_section", { length: 255 }),
    headingLevel: integer("heading_level").notNull().default(0),
    contentType: knowledgeChunkContentTypeEnum("content_type").notNull().default("PARAGRAPH"),
    searchText: text("search_text"),
    keywords: jsonb("keywords").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    aliasTerms: jsonb("alias_terms").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    citationAnchor: varchar("citation_anchor", { length: 255 }),
    sortWeight: real("sort_weight").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("knowledge_chunks_version_index_unique").on(table.versionId, table.chunkIndex),
    index("knowledge_chunks_document_version_idx").on(table.documentId, table.versionId),
    index("knowledge_chunks_project_idx").on(table.projectId),
    index("knowledge_chunks_version_content_type_idx").on(table.versionId, table.contentType),
    index("knowledge_chunks_version_section_idx").on(table.versionId, table.sourceSection),
    index("knowledge_chunks_keywords_gin_idx").using("gin", sql`${table.keywords} jsonb_ops`),
    index("knowledge_chunks_search_text_trgm_idx").using("gin", sql`${table.searchText} gin_trgm_ops`)
  ]
);

export const knowledgeChunkTerms = pgTable(
  "knowledge_chunk_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chunkId: uuid("chunk_id").notNull().references(() => knowledgeChunks.id, { onDelete: "cascade" }),
    term: varchar("term", { length: 255 }).notNull(),
    termType: knowledgeTermTypeEnum("term_type").notNull().default("KEYWORD"),
    weight: real("weight").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("knowledge_chunk_terms_chunk_term_unique").on(table.chunkId, table.term),
    index("knowledge_chunk_terms_term_idx").on(table.term, table.termType)
  ]
);

export const knowledgeAliases = pgTable(
  "knowledge_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    term: varchar("term", { length: 255 }).notNull(),
    alias: varchar("alias", { length: 255 }).notNull(),
    termType: knowledgeTermTypeEnum("term_type").notNull().default("KEYWORD"),
    scope: varchar("scope", { length: 20 }).notNull().default("GLOBAL"),
    enabled: boolean("enabled").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("knowledge_aliases_term_alias_unique").on(table.term, table.alias),
    index("knowledge_aliases_alias_idx").on(table.alias),
    index("knowledge_aliases_enabled_idx").on(table.enabled)
  ]
);

export const knowledgeCitations = pgTable(
  "knowledge_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chunkId: uuid("chunk_id").notNull().references(() => knowledgeChunks.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull().references(() => knowledgeDocumentVersions.id, { onDelete: "cascade" }),
    sourceType: knowledgeDocTypeEnum("source_type").notNull().default("OTHER"),
    pageNumber: integer("page_number"),
    clauseNo: varchar("clause_no", { length: 80 }),
    evidenceLevel: knowledgeEvidenceLevelEnum("evidence_level"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("knowledge_citations_chunk_idx").on(table.chunkId),
    index("knowledge_citations_document_page_idx").on(table.documentId, table.versionId, table.pageNumber)
  ]
);

export const knowledgeSearchLogs = pgTable(
  "knowledge_search_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    searcherUserId: uuid("searcher_user_id").references(() => users.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    query: text("query").notNull(),
    normalizedQuery: text("normalized_query").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>(),
    matchModes: jsonb("match_modes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    resultCount: integer("result_count").notNull().default(0),
    topResults: jsonb("top_results").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
    durationMs: integer("duration_ms"),
    searchedAt: timestamp("searched_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("knowledge_search_logs_user_searched_idx").on(table.searcherUserId, table.searchedAt),
    index("knowledge_search_logs_searched_idx").on(table.searchedAt)
  ]
);

export const parsingJobs = pgTable(
  "parsing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull().references(() => knowledgeDocumentVersions.id, { onDelete: "cascade" }),
    jobType: parsingJobTypeEnum("job_type").notNull(),
    status: parsingJobStatusEnum("status").notNull().default("QUEUED"),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    progress: integer("progress").notNull().default(0),
    errorMessage: text("error_message"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    queuedById: uuid("queued_by_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index("parsing_jobs_document_version_status_idx").on(table.documentId, table.versionId, table.status),
    index("parsing_jobs_status_created_idx").on(table.status, table.createdAt)
  ]
);

/** 检索排序权重配置（B 端可维护，检索时读取） */
export const knowledgeRankingRules = pgTable(
  "knowledge_ranking_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: varchar("key", { length: 80 }).notNull().unique(),
    weight: real("weight").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    description: text("description"),
    ...timestamps
  }
);

/** 爬虫抓取源（站点规则由甲方确认后配置；抓取结果默认待审核） */
export const knowledgeCrawlerSources = pgTable(
  "knowledge_crawler_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    baseUrl: text("base_url").notNull(),
    downloadUrlPattern: text("download_url_pattern").notNull(),
    docType: knowledgeDocTypeEnum("doc_type").notNull().default("STANDARD"),
    enabled: boolean("enabled").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    index("knowledge_crawler_sources_enabled_idx").on(table.enabled)
  ]
);

/** 检索评测：保存测试问题、关键词解析、期望与实际命中、人工判定 */
export const knowledgeSearchEvaluations = pgTable(
  "knowledge_search_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    query: text("query").notNull(),
    normalizedQuery: text("normalized_query").notNull(),
    parsedKeywords: jsonb("parsed_keywords").$type<string[]>(),
    expectedDocumentId: uuid("expected_document_id").references(() => knowledgeDocuments.id, { onDelete: "set null" }),
    expectedPage: integer("expected_page"),
    actualTopResults: jsonb("actual_top_results").$type<Record<string, unknown>[]>(),
    judgement: knowledgeEvaluationJudgementEnum("judgement").notNull().default("PENDING"),
    judgedById: uuid("judged_by_id").references(() => users.id, { onDelete: "set null" }),
    judgedAt: timestamp("judged_at", { withTimezone: true }),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    index("knowledge_search_evaluations_judgement_idx").on(table.judgement, table.judgedAt)
  ]
);

export const aiProviders = pgTable("ai_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 80 }),
  name: varchar("name", { length: 120 }).notNull().unique(),
  description: text("description"),
  type: aiProviderTypeEnum("type").notNull().default("OPENAI_COMPATIBLE"),
  baseUrl: text("base_url").notNull(),
  apiKeyCiphertext: text("api_key_ciphertext"),
  apiKeyIv: varchar("api_key_iv", { length: 64 }),
  apiKeyTag: varchar("api_key_tag", { length: 64 }),
  timeoutMs: integer("timeout_ms").notNull().default(60000),
  priority: integer("priority").notNull().default(0),
  lastTestStatus: varchar("last_test_status", { length: 20 }),
  lastTestMessage: text("last_test_message"),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  enabled: boolean("enabled").notNull().default(true),
  createdById: uuid("created_by_id").references(() => users.id),
  updatedById: uuid("updated_by_id").references(() => users.id),
  ...timestamps
});

export const aiModels = pgTable(
  "ai_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id").notNull().references(() => aiProviders.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 80 }),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    modelId: varchar("model_id", { length: 160 }).notNull(),
    description: text("description"),
    capabilities: jsonb("capabilities").$type<Record<string, boolean>>().notNull().default(sql`'{}'::jsonb`),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    defaultTemperature: real("default_temperature"),
    timeoutMs: integer("timeout_ms").notNull().default(60000),
    priority: integer("priority").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps
  },
  (table) => [uniqueIndex("ai_models_provider_model_unique").on(table.providerId, table.modelId)]
);

export const aiScenes = pgTable(
  "ai_scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    description: text("description"),
    defaultModelId: uuid("default_model_id").references(() => aiModels.id, { onDelete: "set null" }),
    reasoningModelId: uuid("reasoning_model_id").references(() => aiModels.id, { onDelete: "set null" }),
    fallbackModelId: uuid("fallback_model_id").references(() => aiModels.id, { onDelete: "set null" }),
    allowReasoning: boolean("allow_reasoning").notNull().default(false),
    requireProject: boolean("require_project").notNull().default(false),
    allowFileUpload: boolean("allow_file_upload").notNull().default(false),
    allowKnowledgeSearch: boolean("allow_knowledge_search").notNull().default(false),
    allowTools: boolean("allow_tools").notNull().default(false),
    temperature: real("temperature"),
    maxOutputTokens: integer("max_output_tokens"),
    promptId: uuid("prompt_id").references((): PgColumn => prompts.id, { onDelete: "set null" }),
    enabled: boolean("enabled").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    ...timestamps
  },
  (table) => [index("ai_scenes_enabled_sort_idx").on(table.enabled, table.sort)]
);

export const prompts = pgTable(
  "prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id").notNull().references(() => aiScenes.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    description: text("description"),
    activeVersionId: uuid("active_version_id").references((): PgColumn => promptVersions.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [index("prompts_scene_idx").on(table.sceneId)]
);

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptId: uuid("prompt_id").notNull().references((): PgColumn => prompts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    status: aiPromptVersionStatusEnum("status").notNull().default("DRAFT"),
    changeNote: text("change_note"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    publishedById: uuid("published_by_id").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("prompt_versions_prompt_version_unique").on(table.promptId, table.version),
    index("prompt_versions_status_idx").on(table.promptId, table.status)
  ]
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    projectId: uuid("project_id").references(() => projects.id),
    clientApp: varchar("client_app", { length: 40 }).notNull(),
    scene: varchar("scene", { length: 80 }).notNull(),
    title: varchar("title", { length: 120 }),
    reasoningMode: aiReasoningModeEnum("reasoning_mode").notNull().default("OFF"),
    isPinned: boolean("is_pinned").notNull().default(false),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    groupId: varchar("group_id", { length: 80 }),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index("ai_conversations_user_created_idx").on(table.userId, table.createdAt),
    index("ai_conversations_user_status_pin_updated_idx").on(table.userId, table.status, table.isPinned, table.updatedAt),
    index("ai_conversations_project_idx").on(table.projectId),
    index("ai_conversations_deleted_idx").on(table.deletedAt)
  ]
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    role: aiMessageRoleEnum("role").notNull(),
    status: aiMessageStatusEnum("status").notNull().default("COMPLETED"),
    content: text("content").notNull(),
    reasoningMode: aiReasoningModeEnum("reasoning_mode").notNull().default("OFF"),
    provider: varchar("provider", { length: 120 }),
    model: varchar("model", { length: 160 }),
    providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    modelId: uuid("model_id").references(() => aiModels.id, { onDelete: "set null" }),
    promptTemplateVersion: integer("prompt_template_version"),
    promptVersionId: uuid("prompt_version_id").references(() => promptVersions.id, { onDelete: "set null" }),
    tokenInput: integer("token_input"),
    tokenOutput: integer("token_output"),
    reasoningTokens: integer("reasoning_tokens"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    errorCode: varchar("error_code", { length: 40 }),
    requestId: varchar("request_id", { length: 120 }),
    stopReason: varchar("stop_reason", { length: 40 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("ai_messages_conversation_created_idx").on(table.conversationId, table.createdAt)]
);

export const aiToolCalls = pgTable(
  "ai_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => aiMessages.id, { onDelete: "set null" }),
    toolName: varchar("tool_name", { length: 120 }).notNull(),
    inputJson: jsonb("input_json").$type<Record<string, unknown>>(),
    outputJson: jsonb("output_json").$type<Record<string, unknown>>(),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("ai_tool_calls_conversation_idx").on(table.conversationId)]
);

export const aiRetrievalLogs = pgTable(
  "ai_retrieval_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => aiMessages.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => knowledgeDocuments.id, { onDelete: "set null" }),
    chunkId: uuid("chunk_id").references(() => knowledgeChunks.id, { onDelete: "set null" }),
    score: real("score"),
    sourcePage: integer("source_page"),
    sourceTitle: varchar("source_title", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("ai_retrieval_logs_conversation_idx").on(table.conversationId)]
);

export const aiMessageFeedbacks = pgTable(
  "ai_message_feedbacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id").notNull().references(() => aiMessages.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reaction: aiFeedbackReactionEnum("reaction"),
    reasonCode: varchar("reason_code", { length: 40 }),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    content: text("content"),
    clientApp: varchar("client_app", { length: 40 }),
    handledById: uuid("handled_by_id").references(() => users.id, { onDelete: "set null" }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    handlingNote: text("handling_note"),
    ...timestamps
  },
  (table) => [
    uniqueIndex("ai_message_feedbacks_message_user_unique").on(table.messageId, table.userId),
    index("ai_message_feedbacks_project_created_idx").on(table.projectId, table.createdAt),
    index("ai_message_feedbacks_reaction_created_idx").on(table.reaction, table.createdAt)
  ]
);

export const aiMessageRegenerations = pgTable(
  "ai_message_regenerations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    originalMessageId: uuid("original_message_id").notNull().references(() => aiMessages.id, { onDelete: "cascade" }),
    regeneratedMessageId: uuid("regenerated_message_id").notNull().references(() => aiMessages.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("ai_message_regenerations_conversation_created_idx").on(table.conversationId, table.createdAt),
    index("ai_message_regenerations_original_idx").on(table.originalMessageId)
  ]
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    conversationId: uuid("conversation_id").references(() => aiConversations.id),
    reportType: varchar("report_type", { length: 80 }).notNull(),
    status: reportStatusEnum("status").notNull().default("DRAFT"),
    contentJson: jsonb("content_json").$type<Record<string, unknown>>(),
    templateVersion: varchar("template_version", { length: 40 }).notNull().default("1"),
    promptTemplateVersion: integer("prompt_template_version"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdById: uuid("created_by_id").notNull().references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [index("reports_project_idx").on(table.projectId), index("reports_creator_idx").on(table.createdById)]
);

export const reportArtifacts = pgTable(
  "report_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
    type: reportArtifactTypeEnum("type").notNull(),
    fileId: uuid("file_id").notNull().references(() => files.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("report_artifacts_report_type_unique").on(table.reportId, table.type)]
);

export const reportSources = pgTable(
  "report_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => aiMessages.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull().default(0),
    snapshotContent: text("snapshot_content").notNull(),
    snapshotMetadata: jsonb("snapshot_metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("report_sources_report_message_unique").on(table.reportId, table.messageId),
    uniqueIndex("report_sources_report_sort_unique").on(table.reportId, table.sortOrder)
  ]
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: varchar("token", { length: 80 }).notNull().unique(),
    targetType: shareTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 160 }).notNull(),
    snapshotJson: jsonb("snapshot_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxViews: integer("max_views"),
    viewCount: integer("view_count").notNull().default(0),
    ...timestamps
  },
  (table) => [
    index("share_links_target_idx").on(table.targetType, table.targetId),
    index("share_links_project_created_idx").on(table.projectId, table.createdAt)
  ]
);

export const shareViews = pgTable(
  "share_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareLinkId: uuid("share_link_id").notNull().references(() => shareLinks.id, { onDelete: "cascade" }),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    referer: text("referer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("share_views_link_created_idx").on(table.shareLinkId, table.createdAt)]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    action: varchar("action", { length: 120 }).notNull(),
    targetType: varchar("target_type", { length: 80 }),
    targetId: uuid("target_id"),
    beforeJson: jsonb("before_json").$type<unknown>(),
    afterJson: jsonb("after_json").$type<unknown>(),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    requestId: varchar("request_id", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt),
    index("audit_logs_project_created_idx").on(table.projectId, table.createdAt),
    index("audit_logs_action_created_idx").on(table.action, table.createdAt)
  ]
);

// ---------------------------------------------------------------- 主数据（企业/产品/材料参数）

/** 专业数据通用证据列：来源、页码/条款、证据等级（A/B/C，取值待甲方确认）、生效/失效时间 */
const mdEvidenceColumns = {
  evidenceSource: text("evidence_source"),
  evidenceRef: varchar("evidence_ref", { length: 120 }),
  evidenceLevel: knowledgeEvidenceLevelEnum("evidence_level"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true })
};

/** 主数据通用审核列：提交/审核通过/驳回/发布 四段决议，与 auditLogs 同事务写入 */
const mdReviewColumns = {
  status: mdReviewStatusEnum("status").notNull().default("DRAFT"),
  submittedById: uuid("submitted_by_id").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvalNote: text("approval_note"),
  rejectedById: uuid("rejected_by_id").references(() => users.id, { onDelete: "set null" }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectReason: text("reject_reason"),
  publishedById: uuid("published_by_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" })
};

/** 企业内容：同 code 多版本行并存，同一时刻仅一个 PUBLISHED 生效 */
export const enterpriseProfiles = pgTable(
  "enterprise_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 80 }).notNull().default("company_profile"),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 160 }).notNull(),
    shortName: varchar("short_name", { length: 80 }),
    intro: text("intro"),
    logoFileId: uuid("logo_file_id").references(() => files.id, { onDelete: "set null" }),
    address: varchar("address", { length: 255 }),
    contactPhone: varchar("contact_phone", { length: 40 }),
    contactEmail: varchar("contact_email", { length: 120 }),
    website: varchar("website", { length: 200 }),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("enterprise_profiles_code_version_unique").on(table.code, table.version),
    index("enterprise_profiles_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

/** 企业证书：文档引用型（fileId），无版本递增，走审核状态机 */
export const enterpriseCertificates = pgTable(
  "enterprise_certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    certName: varchar("cert_name", { length: 160 }).notNull(),
    certNo: varchar("cert_no", { length: 120 }),
    issuer: varchar("issuer", { length: 160 }),
    issueDate: date("issue_date"),
    expiryDate: date("expiry_date"),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    description: text("description"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    index("enterprise_certificates_status_created_idx").on(table.status, table.createdAt),
    index("enterprise_certificates_file_idx").on(table.fileId)
  ]
);

/** 产品系列：同 code 多版本行并存 */
export const productSeries = pgTable(
  "product_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 80 }).notNull(),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("product_series_code_version_unique").on(table.code, table.version),
    index("product_series_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

/** 产品规格：同 (seriesId, specCode) 多版本行并存；尺寸/燃烧等级等属性以图集选用表为准 */
export const productSpecs = pgTable(
  "product_specs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesId: uuid("series_id").notNull().references(() => productSeries.id, { onDelete: "cascade" }),
    specCode: varchar("spec_code", { length: 80 }).notNull(),
    version: integer("version").notNull().default(1),
    specClass: mdSpecClassEnum("spec_class").notNull(),
    thicknessMm: numeric("thickness_mm", { precision: 10, scale: 2, mode: "number" }).notNull(),
    lengthMm: numeric("length_mm", { precision: 10, scale: 2, mode: "number" }),
    widthMm: numeric("width_mm", { precision: 10, scale: 2, mode: "number" }),
    combustionGrade: varchar("combustion_grade", { length: 20 }),
    productionStatus: mdProductionStatusEnum("production_status").notNull().default("PRODUCING"),
    standardType: mdStandardTypeEnum("standard_type").notNull().default("STANDARD"),
    supplyRegions: jsonb("supply_regions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("product_specs_series_code_version_unique").on(table.seriesId, table.specCode, table.version),
    index("product_specs_series_status_idx").on(table.seriesId, table.status),
    index("product_specs_class_status_idx").on(table.specClass, table.status)
  ]
);

/** 产品性能参数：同 (specId, parameterCode, paramSource) 多版本并存，四来源可同屏展示冲突 */
export const productParameters = pgTable(
  "product_parameters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    specId: uuid("spec_id").notNull().references(() => productSpecs.id, { onDelete: "cascade" }),
    parameterCode: varchar("parameter_code", { length: 80 }).notNull(),
    parameterName: varchar("parameter_name", { length: 120 }).notNull(),
    paramSource: mdParamSourceEnum("param_source").notNull(),
    version: integer("version").notNull().default(1),
    value: numeric("value", { precision: 14, scale: 6, mode: "number" }).notNull(),
    unit: varchar("unit", { length: 40 }),
    allowedUsage: jsonb("allowed_usage").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    applicableScope: text("applicable_scope"),
    testReportFileId: uuid("test_report_file_id").references(() => files.id, { onDelete: "set null" }),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("product_parameters_spec_code_source_version_unique").on(table.specId, table.parameterCode, table.paramSource, table.version),
    index("product_parameters_spec_status_idx").on(table.specId, table.status),
    index("product_parameters_code_status_idx").on(table.parameterCode, table.status)
  ]
);

/** 产品附件：文档引用型（fileId），target 多态（应用层校验目标存在），无版本递增 */
export const productAttachments = pgTable(
  "product_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: mdAttachmentTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "restrict" }),
    attachmentType: varchar("attachment_type", { length: 40 }).notNull().default("OTHER"),
    name: varchar("name", { length: 160 }),
    description: text("description"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    index("product_attachments_target_idx").on(table.targetType, table.targetId, table.status),
    index("product_attachments_file_idx").on(table.fileId)
  ]
);

/** 材料：同 code 多版本行并存；类别值域待甲方确认 */
export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 80 }).notNull(),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 160 }).notNull(),
    category: varchar("category", { length: 60 }),
    description: text("description"),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("materials_code_version_unique").on(table.code, table.version),
    index("materials_status_updated_idx").on(table.status, table.updatedAt),
    index("materials_category_status_idx").on(table.category, table.status)
  ]
);

/** 材料参数版本：确定性计算唯一参数来源（导热系数/修正系数/密度/强度/燃烧等级），同 materialId 版本递增 */
export const materialParameterVersions = pgTable(
  "material_parameter_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    materialId: uuid("material_id").notNull().references(() => materials.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    thermalConductivity: numeric("thermal_conductivity", { precision: 12, scale: 6, mode: "number" }).notNull(),
    correctionFactor: numeric("correction_factor", { precision: 12, scale: 6, mode: "number" }),
    density: numeric("density", { precision: 12, scale: 2, mode: "number" }),
    compressiveStrength: numeric("compressive_strength", { precision: 12, scale: 3, mode: "number" }),
    bondStrength: numeric("bond_strength", { precision: 12, scale: 3, mode: "number" }),
    combustionGrade: varchar("combustion_grade", { length: 20 }),
    applicableStandard: varchar("applicable_standard", { length: 200 }),
    source: varchar("source", { length: 255 }),
    allowedUsage: jsonb("allowed_usage").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    applicableScope: text("applicable_scope"),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("material_parameter_versions_material_version_unique").on(table.materialId, table.version),
    index("material_parameter_versions_material_status_idx").on(table.materialId, table.status)
  ]
);

// ---------------------------------------------------------------- 保温系统 / 构造方案 / 构造层
// 版本化主体：保温系统、构造方案（同逻辑键多版本行并存，发布后 new-version 派生新草稿，历史版本保留）。
// 子表（构造层/产品选项/方案文档）随方案版本整组复制，无独立审核列，状态由父方案承载。

/** 保温系统：同 code 多版本行并存；systemType 值域待甲方确认 */
export const insulationSystems = pgTable(
  "insulation_systems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 80 }).notNull(),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 160 }).notNull(),
    systemType: varchar("system_type", { length: 80 }).notNull(),
    description: text("description"),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("insulation_systems_code_version_unique").on(table.code, table.version),
    index("insulation_systems_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

/** 构造方案：同 (systemId, schemeCode) 多版本行并存；构造编号如 A1-1，保存基层材料/厚度与图集页码 */
export const constructionSchemes = pgTable(
  "construction_schemes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    systemId: uuid("system_id").notNull().references(() => insulationSystems.id, { onDelete: "cascade" }),
    schemeCode: varchar("scheme_code", { length: 40 }).notNull(),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 160 }).notNull(),
    substrateMaterial: varchar("substrate_material", { length: 120 }).notNull(),
    substrateThickness: numeric("substrate_thickness", { precision: 8, scale: 2, mode: "number" }),
    drawingFileId: uuid("drawing_file_id").references(() => files.id, { onDelete: "set null" }),
    atlasPage: varchar("atlas_page", { length: 40 }),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("construction_schemes_system_code_version_unique").on(table.systemId, table.schemeCode, table.version),
    index("construction_schemes_system_status_idx").on(table.systemId, table.status),
    index("construction_schemes_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

/** 构造层：外到内 layerOrder 从 1 递增；产品层/基层层各自唯一（部分唯一索引兜底） */
export const constructionLayers = pgTable(
  "construction_layers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schemeId: uuid("scheme_id").notNull().references(() => constructionSchemes.id, { onDelete: "cascade" }),
    layerOrder: integer("layer_order").notNull(),
    layerType: constructionLayerTypeEnum("layer_type").notNull(),
    layerName: varchar("layer_name", { length: 120 }).notNull(),
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "set null" }),
    thickness: numeric("thickness", { precision: 8, scale: 2, mode: "number" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...mdEvidenceColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("construction_layers_scheme_order_unique").on(table.schemeId, table.layerOrder),
    uniqueIndex("construction_layers_product_unique").on(table.schemeId).where(sql`${table.layerType} = 'PRODUCT_LAYER'`),
    uniqueIndex("construction_layers_base_unique").on(table.schemeId).where(sql`${table.layerType} = 'BASE_LAYER'`)
  ]
);

/** 方案产品选项：方案允许绑定的产品规格与允许厚度范围（mm），产品层厚度必须落在区间内 */
export const schemeProductOptions = pgTable(
  "scheme_product_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schemeId: uuid("scheme_id").notNull().references(() => constructionSchemes.id, { onDelete: "cascade" }),
    productSpecId: uuid("product_spec_id").notNull().references(() => productSpecs.id, { onDelete: "restrict" }),
    minThickness: numeric("min_thickness", { precision: 8, scale: 2, mode: "number" }).notNull(),
    maxThickness: numeric("max_thickness", { precision: 8, scale: 2, mode: "number" }).notNull(),
    defaultThickness: numeric("default_thickness", { precision: 8, scale: 2, mode: "number" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...mdEvidenceColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("scheme_product_options_scheme_spec_unique").on(table.schemeId, table.productSpecId),
    index("scheme_product_options_spec_idx").on(table.productSpecId)
  ]
);

/** 方案文档：挂载于保温系统/构造方案的图集或规程文档引用（多态），记录引用页码 */
export const schemeDocuments = pgTable(
  "scheme_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: schemeDocumentTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    knowledgeDocumentId: uuid("knowledge_document_id").references(() => knowledgeDocuments.id, { onDelete: "set null" }),
    atlasPage: varchar("atlas_page", { length: 40 }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...mdEvidenceColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("scheme_documents_target_document_unique").on(table.targetType, table.targetId, table.knowledgeDocumentId),
    index("scheme_documents_document_idx").on(table.knowledgeDocumentId)
  ]
);

export const loginLogs = pgTable(
  "login_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    identifier: varchar("identifier", { length: 255 }),
    clientType: authClientEnum("client_type"),
    result: loginResultEnum("result").notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    message: varchar("message", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("login_logs_created_idx").on(table.createdAt), index("login_logs_user_idx").on(table.userId, table.createdAt)]
);

export const cronJobs = pgTable(
  "cron_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    jobType: varchar("job_type", { length: 80 }).notNull(),
    cronExpression: varchar("cron_expression", { length: 120 }).notNull(),
    queueName: varchar("queue_name", { length: 80 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    status: cronJobStatusEnum("status").notNull().default("PAUSED"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [index("cron_jobs_status_idx").on(table.status), uniqueIndex("cron_jobs_name_unique").on(table.name)]
);

export const cronExecutions = pgTable(
  "cron_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cronJobId: uuid("cron_job_id").notNull().references(() => cronJobs.id, { onDelete: "cascade" }),
    bullJobId: varchar("bull_job_id", { length: 120 }),
    status: cronExecutionStatusEnum("status").notNull().default("QUEUED"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("cron_executions_job_created_idx").on(table.cronJobId, table.createdAt)]
);

export const dictionaries = pgTable("dictionaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps
});

export const dictionaryItems = pgTable(
  "dictionary_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dictionaryId: uuid("dictionary_id").notNull().references(() => dictionaries.id, { onDelete: "cascade" }),
    value: varchar("value", { length: 120 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ...timestamps
  },
  (table) => [uniqueIndex("dictionary_items_dictionary_value_unique").on(table.dictionaryId, table.value)]
);

export const usersRelations = relations(users, ({ many }) => ({
  identities: many(userIdentities),
  projects: many(projects),
  conversations: many(aiConversations),
  reports: many(reports),
  aiMessageFeedbacks: many(aiMessageFeedbacks)
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  creator: one(users, { fields: [projects.createdById], references: [users.id] }),
  files: many(files),
  conversations: many(aiConversations),
  reports: many(reports),
  shareLinks: many(shareLinks)
}));

export const conversationsRelations = relations(aiConversations, ({ one, many }) => ({
  user: one(users, { fields: [aiConversations.userId], references: [users.id] }),
  project: one(projects, { fields: [aiConversations.projectId], references: [projects.id] }),
  messages: many(aiMessages),
  feedbacks: many(aiMessageFeedbacks)
}));

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type FileRecord = typeof files.$inferSelect;
export type AiProvider = typeof aiProviders.$inferSelect;
export type AiModel = typeof aiModels.$inferSelect;
export type AiScene = typeof aiScenes.$inferSelect;
export type Prompt = typeof prompts.$inferSelect;
export type PromptVersion = typeof promptVersions.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type KnowledgeDocumentVersion = typeof knowledgeDocumentVersions.$inferSelect;
export type KnowledgePage = typeof knowledgePages.$inferSelect;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type KnowledgeChunkTerm = typeof knowledgeChunkTerms.$inferSelect;
export type KnowledgeAlias = typeof knowledgeAliases.$inferSelect;
export type KnowledgeCitation = typeof knowledgeCitations.$inferSelect;
export type KnowledgeCategory = typeof knowledgeCategories.$inferSelect;
export type KnowledgeSearchLog = typeof knowledgeSearchLogs.$inferSelect;
export type ParsingJob = typeof parsingJobs.$inferSelect;
export type KnowledgeRankingRule = typeof knowledgeRankingRules.$inferSelect;
export type KnowledgeCrawlerSource = typeof knowledgeCrawlerSources.$inferSelect;
export type KnowledgeSearchEvaluation = typeof knowledgeSearchEvaluations.$inferSelect;
export type EnterpriseProfile = typeof enterpriseProfiles.$inferSelect;
export type EnterpriseCertificate = typeof enterpriseCertificates.$inferSelect;
export type ProductSeries = typeof productSeries.$inferSelect;
export type ProductSpec = typeof productSpecs.$inferSelect;
export type ProductParameter = typeof productParameters.$inferSelect;
export type ProductAttachment = typeof productAttachments.$inferSelect;
export type Material = typeof materials.$inferSelect;
export type MaterialParameterVersion = typeof materialParameterVersions.$inferSelect;
export type InsulationSystem = typeof insulationSystems.$inferSelect;
export type ConstructionScheme = typeof constructionSchemes.$inferSelect;
export type ConstructionLayer = typeof constructionLayers.$inferSelect;
export type SchemeProductOption = typeof schemeProductOptions.$inferSelect;
export type SchemeDocument = typeof schemeDocuments.$inferSelect;
