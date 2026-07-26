import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
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
export const menuTypeEnum = pgEnum("menu_type", ["DIRECTORY", "MENU", "BUTTON"]);
export const dataScopeEnum = pgEnum("data_scope", ["ALL", "DEPT", "DEPT_AND_CHILDREN", "SELF", "CUSTOM", "PROJECT_OWNER"]);
export const aiMessageRoleEnum = pgEnum("ai_message_role", ["SYSTEM", "USER", "ASSISTANT", "TOOL"]);
export const aiMessageStatusEnum = pgEnum("ai_message_status", ["PENDING", "STREAMING", "COMPLETED", "STOPPED", "FAILED"]);
export const aiReasoningModeEnum = pgEnum("ai_reasoning_mode", ["OFF", "ON"]);
export const aiFeedbackReactionEnum = pgEnum("ai_feedback_reaction", ["LIKE", "DISLIKE"]);
export const reportStatusEnum = pgEnum("report_status", ["DRAFT", "QUEUED", "GENERATING", "READY", "FAILED"]);
export const reportArtifactTypeEnum = pgEnum("report_artifact_type", ["HTML", "IMAGE", "WORD", "PDF"]);
export const shareTargetTypeEnum = pgEnum("share_target_type", ["AI_MESSAGES", "REPORT", "REPORT_ARTIFACT", "PROJECT"]);

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
    status: fileStatusEnum("status").notNull().default("UPLOADING"),
    errorMessage: text("error_message"),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("files_bucket_key_unique").on(table.bucket, table.objectKey),
    index("files_project_status_idx").on(table.projectId, table.status),
    index("files_owner_idx").on(table.ownerUserId)
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

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    version: integer("version").notNull().default(1),
    pageCount: integer("page_count"),
    parser: varchar("parser", { length: 80 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("ready"),
    ...timestamps
  },
  (table) => [uniqueIndex("knowledge_documents_file_version_unique").on(table.fileId, table.version)]
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    sourcePage: integer("source_page"),
    sourceSection: varchar("source_section", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("knowledge_chunks_document_index_unique").on(table.documentId, table.chunkIndex),
    index("knowledge_chunks_project_idx").on(table.projectId)
  ]
);

export const aiProviders = pgTable("ai_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull().unique(),
  type: aiProviderTypeEnum("type").notNull().default("OPENAI_COMPATIBLE"),
  baseUrl: text("base_url").notNull(),
  apiKeyCiphertext: text("api_key_ciphertext"),
  apiKeyIv: varchar("api_key_iv", { length: 64 }),
  apiKeyTag: varchar("api_key_tag", { length: 64 }),
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
    displayName: varchar("display_name", { length: 120 }).notNull(),
    modelId: varchar("model_id", { length: 160 }).notNull(),
    capabilities: jsonb("capabilities").$type<Record<string, boolean>>().notNull().default(sql`'{}'::jsonb`),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    defaultTemperature: real("default_temperature"),
    timeoutMs: integer("timeout_ms").notNull().default(60000),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps
  },
  (table) => [uniqueIndex("ai_models_provider_model_unique").on(table.providerId, table.modelId)]
);

export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scene: varchar("scene", { length: 80 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    version: integer("version").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("prompt_templates_scene_version_unique").on(table.scene, table.version)]
);

export const aiSceneBindings = pgTable("ai_scene_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  scene: varchar("scene", { length: 80 }).notNull().unique(),
  primaryModelId: uuid("primary_model_id").notNull().references(() => aiModels.id),
  fallbackModelId: uuid("fallback_model_id").references(() => aiModels.id),
  promptTemplateId: uuid("prompt_template_id").references(() => promptTemplates.id),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps
});

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
    promptTemplateVersion: integer("prompt_template_version"),
    tokenInput: integer("token_input"),
    tokenOutput: integer("token_output"),
    reasoningTokens: integer("reasoning_tokens"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
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
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    content: text("content"),
    clientApp: varchar("client_app", { length: 40 }),
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
export type Report = typeof reports.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
