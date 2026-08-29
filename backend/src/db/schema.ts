import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  foreignKey,
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
/** 数据范围：ALL 全量；CHANNEL/CHANNEL_AND_CHILDREN 渠道隔离预留；DEPT/DEPT_AND_CHILDREN 部门（历史值）；SELF 本人；PROJECT_OWNER 项目创建者；CUSTOM 自定义 */
export const dataScopeEnum = pgEnum("data_scope", ["ALL", "DEPT", "DEPT_AND_CHILDREN", "SELF", "CUSTOM", "PROJECT_OWNER", "CHANNEL", "CHANNEL_AND_CHILDREN"]);
export const aiMessageRoleEnum = pgEnum("ai_message_role", ["SYSTEM", "USER", "ASSISTANT", "TOOL"]);
export const aiMessageStatusEnum = pgEnum("ai_message_status", ["PENDING", "STREAMING", "COMPLETED", "STOPPED", "FAILED", "BLOCKED"]);
export const aiReasoningModeEnum = pgEnum("ai_reasoning_mode", ["OFF", "ON"]);
export const aiFeedbackReactionEnum = pgEnum("ai_feedback_reaction", ["LIKE", "DISLIKE"]);
export const reportStatusEnum = pgEnum("report_status", [
  "DRAFT",
  "QUEUED",
  "GENERATING",
  "READY",
  "FAILED",
  // 模板报告审核状态：READY -> PENDING_REVIEW -> APPROVED（可发布）/ REJECTED（可重新提交）
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED"
]);
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
/** 文档可见性：PUBLIC 进入 C 端公开文库；PRIVATE 仅项目/平台内部使用 */
export const knowledgeDocVisibilityEnum = pgEnum("knowledge_doc_visibility", ["PUBLIC", "PRIVATE"]);
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
  "INTERNAL_API",
  "THERMAL_IMPORT"
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
// 分块人工干预类型：人工编辑元数据 / 标记错误切片 / 按位置拆分 / 合并到目标块（审计用）
export const knowledgeChunkEditTypeEnum = pgEnum("knowledge_chunk_edit_type", [
  "META_EDIT",
  "FLAG_INVALID",
  "SPLIT",
  "MERGE"
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
// 图集热工参考表导入作业状态：创建 / 已投递 / 解析中 / 解析完成 / 已应用到参考集 / 失败
export const thermalImportJobStatusEnum = pgEnum("thermal_import_job_status", [
  "CREATED",
  "QUEUED",
  "PARSING",
  "PARSED",
  "APPLIED",
  "FAILED"
]);
// 热工计算模式：查图集参考行 / 整体当量法 / 分层法
export const thermalCalcModeEnum = pgEnum("thermal_calc_mode", [
  "REFERENCE_TABLE",
  "EQUIVALENT",
  "LAYERED"
]);
// 最终结果取整方式：四舍五入 / 银行家舍入 / 截断 / 不取整
export const thermalRoundingModeEnum = pgEnum("thermal_rounding_mode", [
  "HALF_UP",
  "HALF_EVEN",
  "TRUNCATE",
  "NONE"
]);
// 合格判定比较字段：K 值 / 总热阻
export const thermalCompareFieldEnum = pgEnum("thermal_compare_field", [
  "K_VALUE",
  "TOTAL_RESISTANCE"
]);
// 合格判定比较方向：不大于（K 值限值）/ 不小于（热阻限值）
export const thermalCompareOperatorEnum = pgEnum("thermal_compare_operator", [
  "LTE",
  "GTE"
]);
// 标准数据来源通道：定时抓取 / 人工录入维护
export const standardIngestTypeEnum = pgEnum("standard_ingest_type", ["CRAWL", "MANUAL"]);
// 标准文档状态：征求意见 / 正式 / 被替代 / 废止
export const standardDocumentStatusEnum = pgEnum("standard_document_status", [
  "DRAFT_CONSULTATION",
  "OFFICIAL",
  "SUPERSEDED",
  "REPEALED"
]);
// 标准指标类型：K 值限值 / 热阻限值 / 其他
export const standardIndicatorTypeEnum = pgEnum("standard_indicator_type", [
  "K_VALUE",
  "HEAT_RESISTANCE",
  "OTHER"
]);
// 标准替代类型：替代（新版接替旧版）/ 废止（旧版废止无接替）
export const standardReplacementTypeEnum = pgEnum("standard_replacement_type", ["SUPERSEDE", "REPEAL"]);
// 替代关系确认状态
export const standardReplacementStatusEnum = pgEnum("standard_replacement_status", [
  "PENDING",
  "CONFIRMED",
  "REJECTED"
]);
// 标准抓取作业状态
export const standardCrawlStatusEnum = pgEnum("standard_crawl_status", [
  "QUEUED",
  "RUNNING",
  "SUCCESS",
  "FAILED"
]);
// 标准抓取触发方式
export const standardCrawlTriggerEnum = pgEnum("standard_crawl_trigger", ["SCHEDULE", "MANUAL"]);
// 标准文档解析状态：待解析 / 已解析 / 解析失败
export const standardParseStatusEnum = pgEnum("standard_parse_status", ["PENDING", "PARSED", "FAILED"]);
// ---------------------------------------------------------------- 材料对比规则引擎
// 材料类别：VICP 及五类对比对象（EPS/XPS/岩棉/聚氨酯/传统一体板）
export const comparisonMaterialCategoryEnum = pgEnum("comparison_material_category", [
  "VICP",
  "EPS",
  "XPS",
  "ROCK_WOOL",
  "PU",
  "TRADITIONAL_BOARD"
]);
// 统一比较基准：同厚度 / 同导热系数 / 同热阻 / 单方性能表现 / 其他
export const comparisonBenchmarkTypeEnum = pgEnum("comparison_benchmark_type", [
  "SAME_THICKNESS",
  "SAME_LAMBDA",
  "SAME_R_VALUE",
  "PERFORMANCE",
  "OTHER"
]);
// 证据归属侧：VICP 侧数据 / 竞品侧数据
export const comparisonEvidenceSideEnum = pgEnum("comparison_evidence_side", ["VICP", "COMPETITOR"]);

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
    // 渠道数据隔离预留（第一期不启用业务过滤）：channelId 指向所属渠道账号（经销商），parentChannelId 指向上一级渠道
    channelId: uuid("channel_id").references((): PgColumn => users.id, { onDelete: "set null" }),
    parentChannelId: uuid("parent_channel_id").references((): PgColumn => users.id, { onDelete: "set null" }),
    status: userStatusEnum("status").notNull().default("ACTIVE"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("users_phone_unique").on(table.phone).where(sql`${table.deletedAt} is null`),
    uniqueIndex("users_email_unique").on(table.email).where(sql`${table.deletedAt} is null`),
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
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("user_identities_type_identifier_unique").on(table.type, table.identifier).where(sql`${table.deletedAt} is null`),
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
    // Wiki 体系标注：该文档适用的保温体系（空 = 不限定体系）；AI 会话按会话体系加权检索
    insulationSystemId: uuid("insulation_system_id").references((): PgColumn => insulationSystems.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    pageCount: integer("page_count"),
    parser: varchar("parser", { length: 80 }).notNull().default("none"),
    status: knowledgeDocStatusEnum("status").notNull().default("ACTIVE"),
    visibility: knowledgeDocVisibilityEnum("visibility").notNull().default("PRIVATE"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("knowledge_documents_file_version_unique").on(table.fileId, table.version),
    index("knowledge_documents_status_category_idx").on(table.status, table.categoryId),
    index("knowledge_documents_doc_type_status_idx").on(table.docType, table.status),
    index("knowledge_documents_visibility_status_idx").on(table.visibility, table.status),
    index("knowledge_documents_insulation_system_idx").on(table.insulationSystemId),
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

/** Wiki 章节树：同一文档版本内 sectionKey 是稳定的层级路径键，历史版本独立保留。 */
export const knowledgeSections = pgTable(
  "knowledge_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull().references(() => knowledgeDocumentVersions.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): PgColumn => knowledgeSections.id, { onDelete: "cascade" }),
    sectionKey: varchar("section_key", { length: 500 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    level: integer("level").notNull().default(1),
    headingPath: jsonb("heading_path").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    sortOrder: integer("sort_order").notNull().default(0),
    startPage: integer("start_page"),
    endPage: integer("end_page"),
    /** 章节检索文本：标题 + 标题路径（层级检索第一层；正文命中由页面块/Chunk 承担） */
    searchText: text("search_text"),
    sourceAnchor: varchar("source_anchor", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("knowledge_sections_version_key_unique").on(table.versionId, table.sectionKey),
    index("knowledge_sections_document_version_idx").on(table.documentId, table.versionId),
    index("knowledge_sections_parent_sort_idx").on(table.parentId, table.sortOrder),
    index("knowledge_sections_title_idx").on(table.title),
    index("knowledge_sections_search_text_trgm_idx").using("gin", sql`${table.searchText} gin_trgm_ops`)
  ]
);

export const knowledgePages = pgTable(
  "knowledge_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull().references(() => knowledgeDocumentVersions.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => knowledgeSections.id, { onDelete: "set null" }),
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
    index("knowledge_pages_version_section_idx").on(table.versionId, table.sectionPath),
    index("knowledge_pages_version_section_id_idx").on(table.versionId, table.sectionId)
  ]
);

/** 页面内部可读内容块：这是 Wiki 默认阅读和引用的最小内容单元，Chunk 仅作辅助检索索引。 */
export const knowledgePageBlocks = pgTable(
  "knowledge_page_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull().references(() => knowledgeDocumentVersions.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").notNull().references(() => knowledgePages.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => knowledgeSections.id, { onDelete: "set null" }),
    blockIndex: integer("block_index").notNull(),
    content: text("content").notNull(),
    contentType: knowledgeChunkContentTypeEnum("content_type").notNull().default("PARAGRAPH"),
    searchText: text("search_text"),
    sourceAnchor: varchar("source_anchor", { length: 255 }),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("knowledge_page_blocks_page_index_unique").on(table.pageId, table.blockIndex),
    index("knowledge_page_blocks_version_section_idx").on(table.versionId, table.sectionId),
    index("knowledge_page_blocks_document_page_idx").on(table.documentId, table.pageId),
    index("knowledge_page_blocks_search_text_trgm_idx").using("gin", sql`${table.searchText} gin_trgm_ops`)
  ]
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull().references(() => knowledgeDocumentVersions.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => knowledgeSections.id, { onDelete: "set null" }),
    pageBlockId: uuid("page_block_id").references(() => knowledgePageBlocks.id, { onDelete: "set null" }),
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
    // 人工干预（B 端可编辑）：标注说明 / 标记错误切片与原因 / 编辑人 / 编辑时间
    annotation: text("annotation"),
    invalid: boolean("invalid").notNull().default(false),
    invalidReason: text("invalid_reason"),
    editedById: uuid("edited_by_id").references(() => users.id, { onDelete: "set null" }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("knowledge_chunks_version_index_unique").on(table.versionId, table.chunkIndex),
    index("knowledge_chunks_document_version_idx").on(table.documentId, table.versionId),
    index("knowledge_chunks_project_idx").on(table.projectId),
    index("knowledge_chunks_version_section_idx").on(table.versionId, table.sourceSection),
    index("knowledge_chunks_version_section_id_idx").on(table.versionId, table.sectionId),
    index("knowledge_chunks_version_page_block_idx").on(table.versionId, table.pageBlockId),
    index("knowledge_chunks_version_content_type_idx").on(table.versionId, table.contentType),
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

export const knowledgeChunkEdits = pgTable(
  "knowledge_chunk_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chunkId: uuid("chunk_id").notNull().references(() => knowledgeChunks.id, { onDelete: "cascade" }),
    editType: knowledgeChunkEditTypeEnum("edit_type").notNull(),
    note: text("note"),
    beforeJson: jsonb("before_json").$type<Record<string, unknown>>(),
    afterJson: jsonb("after_json").$type<Record<string, unknown>>(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("knowledge_chunk_edits_chunk_idx").on(table.chunkId),
    index("knowledge_chunk_edits_created_idx").on(table.createdAt)
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
    // 运营回写：最近抓取时间/结果与失败原因（由抓取收尾处更新），人工备注由 B 端维护
    lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
    lastCrawlStatus: varchar("last_crawl_status", { length: 20 }),
    lastErrorMessage: text("last_error_message"),
    operatorRemark: text("operator_remark"),
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
    // 会话级保温体系上下文：专业场景必选、可切换；历史会话允许为空（发送专业消息前提示补选）
    insulationSystemId: uuid("insulation_system_id").references((): PgColumn => insulationSystems.id, { onDelete: "set null" }),
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

/**
 * AI 对话敏感词围栏：发送消息前做确定性校验，命中即拦截（不发模型请求）。
 * sceneCodes 为空表示全局生效，否则仅对列出的场景生效；keyword 按 matchType 匹配。
 */
export const aiContentFilters = pgTable(
  "ai_content_filters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyword: varchar("keyword", { length: 100 }).notNull(),
    matchType: varchar("match_type", { length: 20 }).notNull().default("CONTAINS"),
    sceneCodes: jsonb("scene_codes").$type<string[]>(),
    hitMessage: varchar("hit_message", { length: 200 }),
    enabled: boolean("enabled").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    index("ai_content_filters_enabled_idx").on(table.enabled),
    index("ai_content_filters_keyword_idx").on(table.keyword)
  ]
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
    /** 模板报告审核列：READY 提交审核后 PENDING_REVIEW -> APPROVED（可发布）/ REJECTED（可重新提交） */
    submittedById: uuid("submitted_by_id").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    rejectedById: uuid("rejected_by_id").references(() => users.id, { onDelete: "set null" }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
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

// ---------------------------------------------------------------- 消息通知（B 端提醒闭环，轮询读取）

/** 通知类型：AI 反馈提醒 / 标准待审核 / 知识解析失败 / 报告生成失败 */
export const notificationTypeEnum = pgEnum("notification_type", [
  "AI_FEEDBACK",
  "STANDARD_PENDING_REVIEW",
  "KNOWLEDGE_PARSE_FAILED",
  "REPORT_GENERATION_FAILED"
]);

/** 广播通知（B 端管理端轮询查看）；targetType/targetId 指向触发事件业务对象 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: notificationTypeEnum("type").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    content: text("content"),
    targetType: varchar("target_type", { length: 80 }),
    targetId: uuid("target_id"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    index("notifications_type_created_idx").on(table.type, table.createdAt),
    index("notifications_project_idx").on(table.projectId)
  ]
);

/** 通知每用户已读记录（广播通知不 fan-out 行，只记已读差集） */
export const notificationReads = pgTable(
  "notification_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("notification_reads_notification_user_unique").on(table.notificationId, table.userId),
    index("notification_reads_user_read_idx").on(table.userId, table.readAt)
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

// ---------------------------------------------------------------- 节点图库（构造节点大样图）
// 节点检索按 系统 + 部位 精确返回；节点关联构造方案（多对多，子表随版本复制）、图集页码、高清图/CAD 与说明。
// 节点为版本化审核实体，数值/页码/证据随版本冻结；已发布读取只返回 PUBLISHED 且生效中的节点。

/** 节点图：版本化审核实体，部位为自由文本（标准词汇表待甲方确认，后续可迁字典） */
export const nodeDrawings = pgTable(
  "node_drawings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 80 }).notNull(),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 160 }).notNull(),
    /** 部位（自由文本，精确匹配检索） */
    position: varchar("position", { length: 80 }).notNull(),
    systemId: uuid("system_id").references(() => insulationSystems.id, { onDelete: "set null" }),
    atlasPage: varchar("atlas_page", { length: 40 }),
    imageFileId: uuid("image_file_id").references(() => files.id, { onDelete: "set null" }),
    cadFileId: uuid("cad_file_id").references(() => files.id, { onDelete: "set null" }),
    description: text("description"),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("node_drawings_code_version_unique").on(table.code, table.version),
    index("node_drawings_system_position_idx").on(table.systemId, table.position),
    index("node_drawings_position_idx").on(table.position),
    index("node_drawings_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

/** 节点-方案关联：子表随节点 new-version 复制；同一节点在不同方案下的图集页码可不同 */
export const nodeSchemeLinks = pgTable(
  "node_scheme_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeDrawingId: uuid("node_drawing_id").notNull().references(() => nodeDrawings.id, { onDelete: "cascade" }),
    schemeId: uuid("scheme_id").notNull().references(() => constructionSchemes.id, { onDelete: "restrict" }),
    atlasPage: varchar("atlas_page", { length: 40 }),
    remark: text("remark"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...mdEvidenceColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("node_scheme_links_drawing_scheme_unique").on(table.nodeDrawingId, table.schemeId),
    index("node_scheme_links_scheme_idx").on(table.schemeId)
  ]
);

// ---------------------------------------------------------------- 图集热工参考选用表
// 一期方案筛选的第一优先数据源：知识库负责条文检索/解释/页码，本模块保存图集节能计算参考选用表的
// 精确可查询数据。核心关系：保温系统 -> 构造方案 -> 构造层 -> 产品规格 -> 图集热工结果 -> 地区限值。
// 参考集为版本化实体（导入产生 DRAFT，经 submit/approve/publish 发布）；参考行随集版本化，无独立审核列。
// 关键约束：行必须同时保存 Excel 原始值（raw*）与标准化数值，禁止 AI/OCR 直接发布。

/** 图集热工参考集：同 code 多版本行并存（一本图集一个集，按来源文档/页码分组行） */
export const thermalReferenceSets = pgTable(
  "thermal_reference_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 80 }).notNull(),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    /** 适用建筑类型（候选查询 buildingType 条件做包含匹配，空数组 = 未配置/不限制） */
    buildingTypes: jsonb("building_types").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** 甲方配置优先级（数字小优先，候选查询排序维度之一） */
    priority: integer("priority").notNull().default(0),
    atlasDocumentId: uuid("atlas_document_id").references(() => knowledgeDocuments.id, { onDelete: "set null" }),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("thermal_reference_sets_code_version_unique").on(table.code, table.version),
    index("thermal_reference_sets_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

/** 图集热工参考行：同一集内 (schemeId, productSpecId, thicknessMm) 唯一；跨集版本（code+version）可并存 */
export const thermalReferenceRows = pgTable(
  "thermal_reference_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id").notNull().references(() => thermalReferenceSets.id, { onDelete: "cascade" }),
    schemeId: uuid("scheme_id").notNull().references(() => constructionSchemes.id, { onDelete: "restrict" }),
    productSpecId: uuid("product_spec_id").notNull().references(() => productSpecs.id, { onDelete: "restrict" }),
    thicknessMm: numeric("thickness_mm", { precision: 8, scale: 2, mode: "number" }).notNull(),
    productThermalResistance: numeric("product_thermal_resistance", { precision: 10, scale: 4, mode: "number" }).notNull(),
    totalThermalResistance: numeric("total_thermal_resistance", { precision: 10, scale: 4, mode: "number" }).notNull(),
    kValue: numeric("k_value", { precision: 10, scale: 4, mode: "number" }).notNull(),
    rawThickness: text("raw_thickness").notNull(),
    rawProductResistance: text("raw_product_resistance").notNull(),
    rawTotalResistance: text("raw_total_resistance").notNull(),
    rawKValue: text("raw_k_value").notNull(),
    evidenceSource: text("evidence_source").notNull(),
    evidenceRef: varchar("evidence_ref", { length: 120 }).notNull(),
    evidenceLevel: knowledgeEvidenceLevelEnum("evidence_level").notNull().default("A"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("thermal_reference_rows_set_scheme_spec_thickness_unique").on(
      table.setId,
      table.schemeId,
      table.productSpecId,
      table.thicknessMm
    ),
    index("thermal_reference_rows_scheme_idx").on(table.schemeId),
    index("thermal_reference_rows_spec_idx").on(table.productSpecId)
  ]
);

/** 图集热工参考表导入作业：记录 Excel 解析结果（result 有效行快照 + 错误清单），apply 后回填 setId */
export const thermalImportJobs = pgTable(
  "thermal_import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setCode: varchar("set_code", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }),
    setId: uuid("set_id").references(() => thermalReferenceSets.id, { onDelete: "set null" }),
    fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "restrict" }),
    templateVersion: integer("template_version").notNull().default(1),
    status: thermalImportJobStatusEnum("status").notNull().default("CREATED"),
    rowCount: integer("row_count").notNull().default(0),
    validCount: integer("valid_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    result: jsonb("result").$type<unknown>(),
    errorSummary: text("error_summary"),
    errorMessage: text("error_message"),
    appliedById: uuid("applied_by_id").references(() => users.id, { onDelete: "set null" }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    index("thermal_import_jobs_set_code_idx").on(table.setCode),
    index("thermal_import_jobs_file_idx").on(table.fileId),
    index("thermal_import_jobs_status_idx").on(table.status)
  ]
);

/** 图集热工参考表导入错误：Excel 行级错误清单，错误行不允许静默入库 */
export const thermalImportErrors = pgTable(
  "thermal_import_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => thermalImportJobs.id, { onDelete: "cascade" }),
    sheetName: varchar("sheet_name", { length: 120 }),
    rowNumber: integer("row_number").notNull(),
    rawRow: jsonb("raw_row").$type<Record<string, unknown>>(),
    errorType: varchar("error_type", { length: 60 }).notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("thermal_import_errors_job_idx").on(table.jobId)
  ]
);

// ---------------------------------------------------------------- 确定性热工计算引擎
// 三模式：REFERENCE_TABLE 直接查已发布图集参考行；EQUIVALENT 按产品总厚度/当量导热系数/修正系数；
// LAYERED 按构造层逐层求热阻汇总。规则与标准限值为版本化审核实体（禁止绕过审核读取草稿值）；
// 计算记录保存输入/构造层/参数/规则/标准/公式版本与中间过程快照，历史结果不随后台参数漂移。

/** 热工计算规则：同 code 多版本行并存；内外表面换热阻/精度/取整/合格判定全部由此配置 */
export const thermalCalcRules = pgTable(
  "thermal_calc_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 80 }).notNull(),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 160 }).notNull(),
    /** 公式实现标识（如 VICP-CALC-1），决定 calculator 使用的公式族；升级公式时派生新版本规则 */
    formulaVersion: varchar("formula_version", { length: 40 }).notNull(),
    /** 内表面换热阻（m²·K/W） */
    interiorSurfaceResistance: numeric("interior_surface_resistance", { precision: 12, scale: 6, mode: "number" }).notNull(),
    /** 外表面换热阻（m²·K/W） */
    exteriorSurfaceResistance: numeric("exterior_surface_resistance", { precision: 12, scale: 6, mode: "number" }).notNull(),
    /** 最终结果小数位（0-8） */
    precision: integer("precision").notNull().default(4),
    roundingMode: thermalRoundingModeEnum("rounding_mode").notNull().default("HALF_UP"),
    compareField: thermalCompareFieldEnum("compare_field").notNull().default("K_VALUE"),
    compareOperator: thermalCompareOperatorEnum("compare_operator").notNull().default("LTE"),
    /** 整体当量法是否并入其余构造层（基层/固定层等）分层热阻；false 时仅产品层+表面换热阻 */
    includeNonProductLayers: boolean("include_non_product_layers").notNull().default(true),
    /** 总热阻是否加内外表面换热阻 */
    includeSurfaceResistances: boolean("include_surface_resistances").notNull().default(true),
    /** 当量法参数码映射：{ equivalentConductivity, correctionFactor } 对应 product_parameters.parameter_code */
    parameterCodes: jsonb("parameter_codes").$type<{ equivalentConductivity: string; correctionFactor: string }>().notNull(),
    /** product_parameters 多来源取值优先级（param_source 顺序）；空数组 = 无优先级限制，取最新版本 */
    paramSourcePriority: jsonb("param_source_priority").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** 产品参数用途过滤值（product_parameters.allowed_usage），空 = 不按用途过滤 */
    usage: varchar("usage", { length: 40 }),
    applicableScope: text("applicable_scope"),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("thermal_calc_rules_code_version_unique").on(table.code, table.version),
    index("thermal_calc_rules_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

/** 地区标准限值：同 (regionCode, basisCode) 多版本行并存；合格判定只取已发布且生效中的限值 */
export const thermalStandardLimits = pgTable(
  "thermal_standard_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    regionCode: varchar("region_code", { length: 40 }).notNull(),
    version: integer("version").notNull().default(1),
    regionName: varchar("region_name", { length: 120 }).notNull(),
    /** 标准依据逻辑键（如 GB50176-2016），与版本行配套 */
    basisCode: varchar("basis_code", { length: 80 }).notNull(),
    basisName: varchar("basis_name", { length: 160 }).notNull(),
    /** 来源标准文档（抓取/人工通道审核发布后同步，溯源用；手动录入通道为空） */
    standardDocumentId: uuid("standard_document_id").references(() => standardDocuments.id, { onDelete: "set null" }),
    clauseRef: varchar("clause_ref", { length: 120 }).notNull(),
    /** K 值限值（W/(m²·K)） */
    limitKValue: numeric("limit_k_value", { precision: 10, scale: 4, mode: "number" }).notNull(),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("thermal_standard_limits_region_basis_version_unique").on(table.regionCode, table.basisCode, table.version),
    index("thermal_standard_limits_region_status_idx").on(table.regionCode, table.status),
    index("thermal_standard_limits_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

// ---------------------------------------------------------------- 地方标准采集（抓取/人工双通道）
// 数据流：standard_sources/crawl_jobs（抓取）→ standard_documents（双通道汇入）→ 审核 → 指标 publish
// 同事务转换落库 thermal_standard_limits（消费模型），候选查询/计算引擎零改造。

/** 栏目 URL 配置：paginationMode=url 时按 pageParam 循环翻页；scroll 用浏览器渲染滚动加载；none 仅当前页 */
export type StandardCatalogUrl = {
  label: string;
  url: string;
  listSelector?: string;
  itemLinkSelector?: string;
  paginationMode: "url" | "scroll" | "none";
  pageParam?: string;
  pageLimit?: number;
};

/** 栏目级抓取结果审计 */
export type StandardCatalogResult = {
  url: string;
  fetched: number;
  discovered: number;
  new: number;
  changed: number;
  failed: number;
  error?: string;
};

/** 省份标准来源配置：B 端按省份/站点配置栏目、分页、提取规则；enabled 与 cron_jobs 双保险 */
export const standardSources = pgTable(
  "standard_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** GB/T 2260 省级行政区划码（如 440000） */
    provinceCode: varchar("province_code", { length: 40 }).notNull(),
    provinceName: varchar("province_name", { length: 120 }).notNull(),
    officialDomain: varchar("official_domain", { length: 255 }).notNull(),
    /** 栏目配置（见 StandardCatalogUrl） */
    catalogUrls: jsonb("catalog_urls").$type<StandardCatalogUrl[]>().notNull().default(sql`'[]'::jsonb`),
    parserType: varchar("parser_type", { length: 40 }).notNull().default("generic-list"),
    /** 提取规则 {field,pattern,flags}（documentNo/title/日期/标准状态/K 值等）；空=用内置默认规则 */
    extractRules: jsonb("extract_rules").$type<{ field: string; pattern: string; flags?: string }[]>().notNull().default(sql`'[]'::jsonb`),
    /** 列表项关键字过滤 {titleKeywords[], excludeKeywords[]} */
    keywords: jsonb("keywords").$type<{ titleKeywords: string[]; excludeKeywords: string[] }>().notNull().default(sql`'{}'::jsonb`),
    /** 抓取范围：today=仅当天发布项；all=全量分页 */
    crawlScope: varchar("crawl_scope", { length: 20 }).notNull().default("today"),
    enabled: boolean("enabled").notNull().default(true),
    lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
    // 运营回写：最近一次抓取结果与失败原因（由抓取收尾处更新），人工备注由 B 端维护
    lastCrawlStatus: varchar("last_crawl_status", { length: 20 }),
    lastCrawlSummary: jsonb("last_crawl_summary").$type<Record<string, unknown>>(),
    lastErrorMessage: text("last_error_message"),
    operatorRemark: text("operator_remark"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("standard_sources_province_domain_unique").on(table.provinceCode, table.officialDomain),
    index("standard_sources_enabled_idx").on(table.enabled)
  ]
);

/** 抓取作业：状态机 QUEUED→RUNNING→SUCCESS/FAILED；单栏目失败不中断整体（记录后继续） */
export const crawlJobs = pgTable(
  "crawl_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => standardSources.id, { onDelete: "cascade" }).notNull(),
    status: standardCrawlStatusEnum("status").notNull().default("QUEUED"),
    triggeredBy: standardCrawlTriggerEnum("triggered_by").notNull(),
    /** 本次实际抓取范围（手动触发可覆盖来源配置） */
    scope: varchar("scope", { length: 20 }).notNull().default("today"),
    /** 栏目级结果审计（见 StandardCatalogResult） */
    catalogResults: jsonb("catalog_results").$type<StandardCatalogResult[]>().notNull().default(sql`'[]'::jsonb`),
    statsJson: jsonb("stats_json").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index("crawl_jobs_source_status_idx").on(table.sourceId, table.status),
    index("crawl_jobs_status_created_idx").on(table.status, table.createdAt)
  ]
);

/** 标准文档（双通道汇入核心表）：CRAWL 带原文哈希/截图证据链，MANUAL 人工录入；均需人工审核后发布 */
export const standardDocuments = pgTable(
  "standard_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 双通道：CRAWL=爬虫采集；MANUAL=人工录入 */
    ingestType: standardIngestTypeEnum("ingest_type").notNull(),
    /** 省份主维度（GB/T 2260 省级码）：爬虫自 source 带入、人工手选 */
    provinceCode: varchar("province_code", { length: 40 }).notNull(),
    provinceName: varchar("province_name", { length: 120 }).notNull(),
    sourceId: uuid("source_id").references(() => standardSources.id, { onDelete: "set null" }),
    crawlJobId: uuid("crawl_job_id").references(() => crawlJobs.id, { onDelete: "set null" }),
    /** 标准编号（如 DBJ50/T-xxx-2023） */
    documentNo: varchar("document_no", { length: 120 }).notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    category: varchar("category", { length: 80 }),
    standardStatus: standardDocumentStatusEnum("standard_status").notNull().default("OFFICIAL"),
    publishDate: date("publish_date", { mode: "date" }),
    implementDate: date("implement_date", { mode: "date" }),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    originUrl: text("origin_url"),
    /** 详情页原始 HTML（OSS key，CRAWL 必填）；SHA-256 变更检测 */
    pageHtmlObjectKey: varchar("page_html_object_key", { length: 500 }),
    pageHtmlSha256: varchar("page_html_sha256", { length: 64 }),
    /** 标准原文 PDF 附件（sha256 幂等，重复抓取跳过） */
    fileObjectKey: varchar("file_object_key", { length: 500 }),
    fileSha256: varchar("file_sha256", { length: 64 }),
    fileSize: bigint("file_size", { mode: "number" }),
    screenshotObjectKey: varchar("screenshot_object_key", { length: 500 }),
    /** 提取结果：原文片段与匹配位置（规则变更后可重跑不重抓） */
    parsedMetaJson: jsonb("parsed_meta_json").$type<Record<string, unknown>>(),
    parseStatus: standardParseStatusEnum("parse_status").notNull().default("PENDING"),
    /** 被哪份新标准替代（标准状态=SUPERSEDED 时指向新文档；自引用 FK 见表级定义） */
    supersededById: uuid("superseded_by_id"),
    version: integer("version").notNull().default(1),
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    foreignKey({ columns: [table.supersededById], foreignColumns: [table.id] }).onDelete("set null"),
    uniqueIndex("standard_documents_province_no_version_unique").on(table.provinceCode, table.documentNo, table.version),
    index("standard_documents_document_no_idx").on(table.documentNo),
    index("standard_documents_status_idx").on(table.standardStatus),
    index("standard_documents_review_status_idx").on(table.status),
    index("standard_documents_publish_date_idx").on(table.publishDate),
    index("standard_documents_ingest_type_idx").on(table.ingestType)
  ]
);

/** 标准适用范围：同文档可覆盖多地区；指标按 (document, region) 粒度审核发布 */
export const standardApplicability = pgTable(
  "standard_applicability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").references(() => standardDocuments.id, { onDelete: "cascade" }).notNull(),
    regionCode: varchar("region_code", { length: 40 }).notNull(),
    regionName: varchar("region_name", { length: 120 }).notNull(),
    buildingTypes: jsonb("building_types").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    structureTypes: jsonb("structure_types").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    scopeText: text("scope_text"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    evidenceRef: varchar("evidence_ref", { length: 120 }),
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("standard_applicability_document_region_unique").on(table.documentId, table.regionCode),
    index("standard_applicability_region_status_idx").on(table.regionCode, table.status)
  ]
);

/** 标准指标（K 值等）：提取/录入即 PENDING_REVIEW；publish 时同事务转换落库 thermal_standard_limits */
export const standardIndicators = pgTable(
  "standard_indicators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").references(() => standardDocuments.id, { onDelete: "cascade" }).notNull(),
    applicabilityId: uuid("applicability_id").references(() => standardApplicability.id, { onDelete: "set null" }),
    indicatorType: standardIndicatorTypeEnum("indicator_type").notNull().default("K_VALUE"),
    indicatorName: varchar("indicator_name", { length: 120 }).notNull(),
    /** 指标值（K 值 W/(m²·K)，precision 10 scale 4） */
    value: numeric("value", { precision: 12, scale: 4, mode: "number" }).notNull(),
    unit: varchar("unit", { length: 40 }),
    /** 原文该指标所在段落（审计证据） */
    rawText: text("raw_text"),
    evidenceRef: varchar("evidence_ref", { length: 120 }),
    evidenceLevel: knowledgeEvidenceLevelEnum("evidence_level"),
    screenshotObjectKey: varchar("screenshot_object_key", { length: 500 }),
    /** 审核状态默认 PENDING_REVIEW（爬虫提取/人工录入即入待审队列） */
    status: mdReviewStatusEnum("status").notNull().default("PENDING_REVIEW"),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...timestamps
  },
  (table) => [
    uniqueIndex("standard_indicators_doc_app_type_version_unique").on(table.documentId, table.applicabilityId, table.indicatorType, table.version),
    index("standard_indicators_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

/** 新旧标准替代关系：CONFIRMED 后旧标准过渡期 expiresAt 生效，过渡期结束自动失效 */
export const standardReplacements = pgTable(
  "standard_replacements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    oldDocumentId: uuid("old_document_id").references(() => standardDocuments.id, { onDelete: "cascade" }).notNull(),
    newDocumentId: uuid("new_document_id").references(() => standardDocuments.id, { onDelete: "cascade" }).notNull(),
    replacementType: standardReplacementTypeEnum("replacement_type").notNull().default("SUPERSEDE"),
    transitionStartAt: timestamp("transition_start_at", { withTimezone: true }),
    transitionEndAt: timestamp("transition_end_at", { withTimezone: true }),
    status: standardReplacementStatusEnum("status").notNull().default("PENDING"),
    note: text("note"),
    confirmedById: uuid("confirmed_by_id").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("standard_replacements_old_new_unique").on(table.oldDocumentId, table.newDocumentId),
    index("standard_replacements_status_idx").on(table.status)
  ]
);

/** 热工计算记录：输入/构造层/参数/规则/标准/公式版本与中间过程快照，历史结果不随后台参数漂移 */
export const thermalCalcRecords = pgTable(
  "thermal_calc_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: varchar("request_id", { length: 120 }),
    mode: thermalCalcModeEnum("mode").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    ruleId: uuid("rule_id").references(() => thermalCalcRules.id, { onDelete: "set null" }),
    ruleVersion: integer("rule_version"),
    standardLimitId: uuid("standard_limit_id").references(() => thermalStandardLimits.id, { onDelete: "set null" }),
    limitVersion: integer("limit_version"),
    /** 计算入参原样（mode/schemeId/productSpecId/thicknessMm/regionCode/ruleCode/projectId） */
    inputJson: jsonb("input_json").$type<Record<string, unknown>>().notNull(),
    /** 构造层快照：layerOrder/layerType/layerName/materialId/thicknessM/lambda/correctionFactor/resistance/evidenceRef */
    layersJson: jsonb("layers_json").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    /** 参数快照：id/version/code/value/unit/source/evidenceRef */
    parametersJson: jsonb("parameters_json").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    /** 规则版本快照（REFERENCE_TABLE 无规则时 null） */
    ruleJson: jsonb("rule_json").$type<Record<string, unknown> | null>(),
    /** 标准限值版本快照（无地区或未发布限值时 null） */
    standardJson: jsonb("standard_json").$type<Record<string, unknown> | null>(),
    /** 公式版本与各步公式表达式 */
    formulaJson: jsonb("formula_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** 中间过程：每层热阻/表面换热阻/汇总/未取整 K 值 */
    stepsJson: jsonb("steps_json").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    /** 结果：productResistance/totalResistance/kValue（取整与原始值）/compliant/limitKValue */
    resultJson: jsonb("result_json").$type<Record<string, unknown>>().notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("thermal_calc_records_mode_created_idx").on(table.mode, table.createdAt),
    index("thermal_calc_records_project_created_idx").on(table.projectId, table.createdAt),
    index("thermal_calc_records_rule_idx").on(table.ruleId),
    index("thermal_calc_records_limit_idx").on(table.standardLimitId)
  ]
);

/** 候选方案确认记录：查询条件 + 用户确认的最终候选全快照（行/集/方案/规格版本与结果），历史确认不随后台参数漂移 */
export const thermalCandidateSelections = pgTable(
  "thermal_candidate_selections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: varchar("request_id", { length: 120 }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** 查询条件快照（CandidateQuery 原样 + 缺失条件清单） */
    queryJson: jsonb("query_json").$type<Record<string, unknown>>().notNull(),
    /** 确认候选快照：行/集/方案/规格版本、thicknessMm/kValue/热阻、证据、matchType */
    candidateJson: jsonb("candidate_json").$type<Record<string, unknown>>().notNull(),
    /** 用户选择理由（可为空，报审是否必填待甲方确认） */
    selectionReason: text("selection_reason"),
    selectedById: uuid("selected_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("thermal_candidate_selections_project_created_idx").on(table.projectId, table.createdAt),
    index("thermal_candidate_selections_user_created_idx").on(table.selectedById, table.createdAt)
  ]
);

// ---------------------------------------------------------------- 报告模板 / 报告快照 / 统一审核记录
// 模板报告：B 端选择已确认候选（thermal_candidate_selections）+ 已发布报告模板生成，快照冻结全部章节数据，
// 历史报告可完整还原；Worker 只做确定性渲染，不向 AI 索要数值。统一审核记录由各域 transition 同事务 upsert。

/** 报告模板章节配置：key 固定枚举；DATA 章节由报告快照数据确定性渲染，TEXT 章节（如免责声明）使用配置文案 */
export type ReportTemplateSection = {
  key:
    | "enterprise" // 企业介绍
    | "project" // 项目条件
    | "standards" // 引用标准与地区限值
    | "candidates" // 候选方案
    | "selection" // 用户选择与理由
    | "thermal" // 热工计算
    | "nodes" // 节点图库
    | "construction" // 构造方案
    | "comparison" // 材料对比
    | "acceptance" // 施工验收
    | "sources" // 来源
    | "disclaimer"; // 免责声明
  title: string;
  enabled: boolean;
  order: number;
  sourceType: "DATA" | "TEXT";
  content?: string;
};

/** 报告模板：版本化审核实体（发布后供报告生成引用），章节顺序/启用集在 B 端配置 */
export const reportTemplates = pgTable(
  "report_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 80 }).notNull(),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    sectionsJson: jsonb("sections_json").$type<ReportTemplateSection[]>().notNull().default(sql`'[]'::jsonb`),
    changeNote: text("change_note"),
    ...mdEvidenceColumns,
    ...mdReviewColumns,
    ...timestamps
  },
  (table) => [
    uniqueIndex("report_templates_code_version_unique").on(table.code, table.version),
    index("report_templates_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

/** 报告数据快照：模板报告生成时冻结全部章节数据（候选/计算/企业/标准/节点/来源/免责声明），历史报告可完整还原 */
export const reportSnapshots = pgTable(
  "report_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => reportTemplates.id, { onDelete: "set null" }),
    templateVersion: integer("template_version"),
    /** 数据生效时点：按 asOfDate 判定已发布数据生效窗，历史不随后台参数漂移 */
    asOfDate: timestamp("as_of_date", { withTimezone: true }),
    /** 整份章节数据快照：projectJson/enterpriseJson/standardsJson/selectionJson/calcJson/nodesJson/acceptanceJson/sourcesJson/disclaimerText */
    dataJson: jsonb("data_json").$type<Record<string, unknown>>().notNull(),
    generatedById: uuid("generated_by_id").references(() => users.id, { onDelete: "set null" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps
  },
  (table) => [uniqueIndex("report_snapshots_report_unique").on(table.reportId)]
);

/** 统一审核状态：跨域（产品/构造/热工/标准/比较/报告）审核记录状态 */
export const professionalReviewStatusEnum = pgEnum("professional_review_status", [
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED"
]);

/** 统一审核记录：每 (entityType, entityId) 一行，由各域 transition 同事务 upsert，供审核中心队列读取 */
export const professionalReviews = pgTable(
  "professional_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 实体类型：复用审计 targetType（md_product_spec/construction_scheme/thermal_reference_set/standard.document/report 等） */
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    entityVersion: integer("entity_version"),
    status: professionalReviewStatusEnum("status").notNull(),
    /** 审核意见（approve）或驳回原因（reject） */
    comment: text("comment"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    submittedById: uuid("submitted_by_id").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    requestId: varchar("request_id", { length: 120 }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("professional_reviews_entity_unique").on(table.entityType, table.entityId),
    index("professional_reviews_status_idx").on(table.status)
  ]
);

// ---------------------------------------------------------------- 材料对比规则引擎
// VICP 与 EPS/XPS/岩棉/聚氨酯/传统一体板的对比以"版本批次"为审核/发布单元：comparison_versions 为
// 版本化实体（复用 masterdata 工作流工厂），材料/规则/证据为子表随版本同事务复制，历史版本不漂移；
// AI 只消费 PUBLISHED 且生效（effectiveAt/expiresAt 窗口）的规则。五维（保温/防火/耐久/施工/报审）
// 固定由种子写入 comparison_dimensions，子指标由 B 端扩展。规则必须同时保存双方材料、统一比较基准、
// 双方数值与单位、VICP 优势文案、适用条件、必要披露与禁止措辞，定量不足时仅保留 VICP 侧数值。

/** 材料对比版本：同 code 多版本行并存（一个版本 = 一套已审核对比规则批次） */
export const comparisonVersions = pgTable(
  "comparison_versions",
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
    uniqueIndex("comparison_versions_code_version_unique").on(table.code, table.version),
    index("comparison_versions_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

/** 材料对比材料目录：随版本复制；型号/密度/测试条件承载"同一比较口径"，防止不同型号混比 */
export const comparisonMaterials = pgTable(
  "comparison_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull().references(() => comparisonVersions.id, { onDelete: "cascade" }),
    category: comparisonMaterialCategoryEnum("category").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    density: numeric("density", { precision: 10, scale: 2, mode: "number" }),
    densityUnit: varchar("density_unit", { length: 40 }),
    testConditions: text("test_conditions"),
    description: text("description"),
    ...mdEvidenceColumns,
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("comparison_materials_version_category_name_model_unique").on(
      table.versionId,
      table.category,
      table.name,
      table.model
    ),
    index("comparison_materials_version_idx").on(table.versionId),
    index("comparison_materials_category_idx").on(table.category)
  ]
);

/** 材料对比维度：五维固定（种子写入，服务层禁止删除/禁用五维行），子指标 B 端扩展；结构配置不挂审核状态机 */
export const comparisonDimensions = pgTable(
  "comparison_dimensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 80 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    parentId: uuid("parent_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    remark: varchar("remark", { length: 255 }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("comparison_dimensions_code_unique").on(table.code),
    index("comparison_dimensions_parent_idx").on(table.parentId)
  ]
);

/** 材料对比规则：随版本复制；同一版本内引用双方材料，VICP 侧数值必填、竞品侧定量不足时可为空 */
export const comparisonRules = pgTable(
  "comparison_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull().references(() => comparisonVersions.id, { onDelete: "cascade" }),
    dimensionId: uuid("dimension_id").notNull().references(() => comparisonDimensions.id, { onDelete: "restrict" }),
    /** 维度名/子指标名快照：历史版本展示不随后台配置漂移 */
    dimensionName: varchar("dimension_name", { length: 80 }).notNull(),
    subIndicatorName: varchar("sub_indicator_name", { length: 120 }),
    vicpMaterialId: uuid("vicp_material_id").notNull().references(() => comparisonMaterials.id, { onDelete: "restrict" }),
    competitorMaterialId: uuid("competitor_material_id")
      .notNull()
      .references(() => comparisonMaterials.id, { onDelete: "restrict" }),
    benchmarkType: comparisonBenchmarkTypeEnum("benchmark_type").notNull(),
    benchmarkDesc: varchar("benchmark_desc", { length: 255 }).notNull(),
    vicpValue: numeric("vicp_value", { precision: 12, scale: 4, mode: "number" }).notNull(),
    vicpUnit: varchar("vicp_unit", { length: 40 }).notNull(),
    competitorValue: numeric("competitor_value", { precision: 12, scale: 4, mode: "number" }),
    competitorUnit: varchar("competitor_unit", { length: 40 }),
    /** VICP 优势文案（营销/展示口径，须有证据支撑） */
    advantageText: text("advantage_text").notNull(),
    /** 适用条件：技术/合规场景强制输出 */
    applicability: text("applicability").notNull(),
    /** 必要披露：影响安全、适用性、计算或报审的条件与风险提示，发布前强制完整 */
    mandatoryDisclosure: text("mandatory_disclosure").notNull(),
    /** 禁止措辞：该规则对应的不得使用的表述（如绝对化用语），仅记录不参与输出 */
    forbiddenWording: text("forbidden_wording"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("comparison_rules_version_dimension_materials_benchmark_unique").on(
      table.versionId,
      table.dimensionId,
      table.vicpMaterialId,
      table.competitorMaterialId,
      table.benchmarkType
    ),
    index("comparison_rules_version_idx").on(table.versionId),
    index("comparison_rules_dimension_idx").on(table.dimensionId),
    index("comparison_rules_vicp_material_idx").on(table.vicpMaterialId),
    index("comparison_rules_competitor_material_idx").on(table.competitorMaterialId)
  ]
);

/** 材料对比证据：可挂规则或材料（应用层保证至少其一）；竞品侧数值存在时其证据必填 */
export const comparisonEvidence = pgTable(
  "comparison_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull().references(() => comparisonVersions.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => comparisonRules.id, { onDelete: "cascade" }),
    materialId: uuid("material_id").references(() => comparisonMaterials.id, { onDelete: "cascade" }),
    side: comparisonEvidenceSideEnum("side").notNull(),
    source: varchar("source", { length: 255 }).notNull(),
    pageRef: varchar("page_ref", { length: 120 }),
    clauseRef: varchar("clause_ref", { length: 120 }),
    evidenceLevel: knowledgeEvidenceLevelEnum("evidence_level").notNull(),
    quote: text("quote"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps
  },
  (table) => [
    index("comparison_evidence_version_idx").on(table.versionId),
    index("comparison_evidence_rule_idx").on(table.ruleId),
    index("comparison_evidence_material_idx").on(table.materialId)
  ]
);

/** AI 材料对比规则使用日志：AI 回答引用已审核规则时落库（含规则快照），审计可追溯且历史不漂移 */
export const aiRuleUsageLogs = pgTable(
  "ai_rule_usage_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => aiMessages.id, { onDelete: "set null" }),
    ruleId: uuid("rule_id").notNull().references(() => comparisonRules.id, { onDelete: "restrict" }),
    ruleCode: varchar("rule_code", { length: 80 }).notNull(),
    versionId: uuid("version_id").references(() => comparisonVersions.id, { onDelete: "set null" }),
    ruleVersion: integer("rule_version").notNull(),
    ruleSnapshot: jsonb("rule_snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("ai_rule_usage_logs_message_idx").on(table.messageId),
    index("ai_rule_usage_logs_rule_created_idx").on(table.ruleId, table.createdAt)
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
export type ThermalReferenceSet = typeof thermalReferenceSets.$inferSelect;
export type ThermalReferenceRow = typeof thermalReferenceRows.$inferSelect;
export type ThermalImportJob = typeof thermalImportJobs.$inferSelect;
export type ThermalImportError = typeof thermalImportErrors.$inferSelect;
export type ThermalCalcRule = typeof thermalCalcRules.$inferSelect;
export type ThermalStandardLimit = typeof thermalStandardLimits.$inferSelect;
export type ThermalCalcRecord = typeof thermalCalcRecords.$inferSelect;
export type StandardSource = typeof standardSources.$inferSelect;
export type CrawlJob = typeof crawlJobs.$inferSelect;
export type StandardDocument = typeof standardDocuments.$inferSelect;
export type StandardApplicability = typeof standardApplicability.$inferSelect;
export type StandardIndicator = typeof standardIndicators.$inferSelect;
export type StandardReplacement = typeof standardReplacements.$inferSelect;
export type ComparisonVersion = typeof comparisonVersions.$inferSelect;
export type ComparisonMaterial = typeof comparisonMaterials.$inferSelect;
export type ComparisonDimension = typeof comparisonDimensions.$inferSelect;
export type ComparisonRule = typeof comparisonRules.$inferSelect;
export type ComparisonEvidence = typeof comparisonEvidence.$inferSelect;
export type AiRuleUsageLog = typeof aiRuleUsageLogs.$inferSelect;
