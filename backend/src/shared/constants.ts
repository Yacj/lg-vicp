export const USER_ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  CHANNEL_USER: "CHANNEL_USER",
  NORMAL_USER: "NORMAL_USER"
} as const;

export const AUTH_CLIENTS = {
  B_ADMIN: "B_ADMIN",
  C_APP: "C_APP",
  PC_AI: "PC_AI"
} as const;

export const CHANNEL_TYPES = {
  DEALER: "DEALER",
  SALESPERSON: "SALESPERSON"
} as const;

export const PROJECT_VISIBILITY = {
  PRIVATE: "PRIVATE",
  PUBLIC: "PUBLIC"
} as const;

export const VISIBILITY_POLICY = {
  LOGGED_IN_USERS: "LOGGED_IN_USERS"
} as const;

export const AUDIT_ACTIONS = {
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_STATUS_CHANGED: "user.status_changed",
  USER_ROLE_CHANGED: "user.role_changed",
  USER_DELETED: "user.deleted",
  USER_RESTORED: "user.restored",
  USER_PASSWORD_RESET: "user.password_reset",
  USER_POST_CHANGED: "user.post_changed",
  USER_DEPARTMENT_CHANGED: "user.department_changed",
  RBAC_ROLE_CREATED: "rbac.role_created",
  RBAC_ROLE_UPDATED: "rbac.role_updated",
  RBAC_ROLE_DELETED: "rbac.role_deleted",
  RBAC_ROLE_STATUS_CHANGED: "rbac.role_status_changed",
  RBAC_ROLE_DATA_SCOPE_CHANGED: "rbac.role_data_scope_changed",
  RBAC_PERMISSION_CREATED: "rbac.permission_created",
  RBAC_ROLE_PERMISSIONS_CHANGED: "rbac.role_permissions_changed",
  DEPARTMENT_CREATED: "department.created",
  DEPARTMENT_UPDATED: "department.updated",
  DEPARTMENT_DELETED: "department.deleted",
  DEPARTMENT_STATUS_CHANGED: "department.status_changed",
  POST_CREATED: "post.created",
  POST_UPDATED: "post.updated",
  POST_DELETED: "post.deleted",
  POST_STATUS_CHANGED: "post.status_changed",
  DICTIONARY_CREATED: "dictionary.created",
  DICTIONARY_UPDATED: "dictionary.updated",
  DICTIONARY_DELETED: "dictionary.deleted",
  DICTIONARY_ITEM_CREATED: "dictionary.item_created",
  DICTIONARY_ITEM_UPDATED: "dictionary.item_updated",
  DICTIONARY_ITEM_DELETED: "dictionary.item_deleted",
  MENU_CREATED: "menu.created",
  MENU_UPDATED: "menu.updated",
  MENU_DELETED: "menu.deleted",
  AUTH_LOGIN: "auth.login",
  AUTH_REGISTER: "auth.register",
  AUTH_LOGOUT: "auth.logout",
  PROJECT_CREATED: "project.created",
  PROJECT_UPDATED: "project.updated",
  PROJECT_DELETED: "project.deleted",
  PROJECT_VISIBILITY_CHANGED: "project.visibility_changed",
  PUBLIC_PROJECT_VIEWED: "project.public_viewed",
  FILE_UPLOAD_CREATED: "file.upload_created",
  FILE_UPLOAD_COMPLETED: "file.upload_completed",
  FILE_DOWNLOADED: "file.downloaded",
  FILE_DELETED: "file.deleted",
  FILE_REUSED: "file.reused",
  FILE_RECYCLED: "file.recycled",
  FILE_RESTORED: "file.restored",
  FILE_PERMANENT_DELETED: "file.permanent_deleted",
  KNOWLEDGE_ASSET_REPLACED: "knowledge.asset_replaced",
  AI_PROVIDER_CREATED: "ai.provider_created",
  AI_PROVIDER_UPDATED: "ai.provider_updated",
  AI_MODEL_CREATED: "ai.model_created",
  AI_MODEL_UPDATED: "ai.model_updated",
  AI_SCENE_BOUND: "ai.scene_bound",
  AI_CONNECTION_TESTED: "ai.connection_tested",
  AI_CONVERSATION_CREATED: "ai.conversation_created",
  AI_CONVERSATION_REASONING_CHANGED: "ai.conversation_reasoning_changed",
  AI_CONVERSATION_RENAMED: "ai.conversation_renamed",
  AI_CONVERSATION_PINNED: "ai.conversation_pinned",
  AI_CONVERSATION_MOVED: "ai.conversation_moved",
  AI_CONVERSATION_DELETED: "ai.conversation_deleted",
  AI_CONVERSATION_RESTORED: "ai.conversation_restored",
  AI_MESSAGE_SENT: "ai.message_sent",
  AI_MESSAGE_STOPPED: "ai.message_stopped",
  AI_MESSAGE_BLOCKED: "ai.message_blocked",
  AI_CONVERSATION_TITLED: "ai.conversation_titled",
  AI_FILTER_CREATED: "ai.filter_created",
  AI_FILTER_UPDATED: "ai.filter_updated",
  AI_FILTER_DELETED: "ai.filter_deleted",
  AI_QUICK_PROMPT_CREATED: "ai.quick_prompt_created",
  AI_QUICK_PROMPT_UPDATED: "ai.quick_prompt_updated",
  AI_QUICK_PROMPT_ENABLED: "ai.quick_prompt_enabled",
  AI_QUICK_PROMPT_DISABLED: "ai.quick_prompt_disabled",
  AI_QUICK_PROMPT_DELETED: "ai.quick_prompt_deleted",
  AI_MESSAGE_FEEDBACK_UPSERTED: "ai.message_feedback_upserted",
  AI_MESSAGE_REGENERATED: "ai.message_regenerated",
  AI_FEEDBACK_HANDLED: "ai.feedback_handled",
  AI_DEBUG_USED: "ai.debug_used",
  REPORT_QUEUED: "report.queued",
  REPORT_GENERATED: "report.generated",
  REPORT_PUBLISHED: "report.published",
  REPORT_DOWNLOADED: "report.downloaded",
  REPORT_DELETED: "report.deleted",
  REPORT_SNAPSHOT_CREATED: "report.snapshot_created",
  REPORT_SUBMITTED: "report.submitted_for_review",
  REPORT_APPROVED: "report.approved",
  REPORT_REJECTED: "report.rejected",
  SHARE_LINK_CREATED: "share.link_created",
  SHARE_LINK_DISABLED: "share.link_disabled",
  SHARE_LINK_VIEWED: "share.link_viewed",
  KNOWLEDGE_CATEGORY_CREATED: "knowledge.category_created",
  KNOWLEDGE_CATEGORY_UPDATED: "knowledge.category_updated",
  KNOWLEDGE_CATEGORY_DELETED: "knowledge.category_deleted",
  KNOWLEDGE_DOC_CREATED: "knowledge.doc_created",
  KNOWLEDGE_DOC_UPDATED: "knowledge.doc_updated",
  KNOWLEDGE_DOC_DELETED: "knowledge.doc_deleted",
  KNOWLEDGE_ALIAS_CREATED: "knowledge.alias_created",
  KNOWLEDGE_ALIAS_UPDATED: "knowledge.alias_updated",
  KNOWLEDGE_ALIAS_DELETED: "knowledge.alias_deleted",
  KNOWLEDGE_VERSION_CREATED: "knowledge.version_created",
  KNOWLEDGE_VERSION_PARSED: "knowledge.version_parsed",
  KNOWLEDGE_VERSION_APPROVED: "knowledge.version_approved",
  KNOWLEDGE_VERSION_PUBLISHED: "knowledge.version_published",
  KNOWLEDGE_VERSION_DISABLED: "knowledge.version_disabled",
  KNOWLEDGE_VERSION_ROLLED_BACK: "knowledge.version_rolled_back",
  KNOWLEDGE_VERSION_DELETED: "knowledge.version_deleted",
  KNOWLEDGE_CHUNKS_REBUILT: "knowledge.chunks_rebuilt",
  KNOWLEDGE_CHUNK_EDITED: "knowledge.chunk_edited",
  KNOWLEDGE_CHUNK_SPLIT: "knowledge.chunk_split",
  KNOWLEDGE_CHUNK_MERGED: "knowledge.chunk_merged",
  KNOWLEDGE_SEARCHED: "knowledge.searched",
  KNOWLEDGE_BATCH_IMPORTED: "knowledge.batch_imported",
  KNOWLEDGE_CRAWLER_CREATED: "knowledge.crawler_created",
  KNOWLEDGE_CRAWLER_UPDATED: "knowledge.crawler_updated",
  KNOWLEDGE_CRAWLER_DELETED: "knowledge.crawler_deleted",
  KNOWLEDGE_CRAWLER_RUN: "knowledge.crawler_run",
  KNOWLEDGE_RANKING_UPDATED: "knowledge.ranking_updated",
  KNOWLEDGE_EVALUATION_CREATED: "knowledge.evaluation_created",
  KNOWLEDGE_EVALUATION_JUDGED: "knowledge.evaluation_judged",
  KNOWLEDGE_EVAL_CREATED: "knowledge.eval_created",
  KNOWLEDGE_EVAL_JUDGED: "knowledge.eval_judged",
  MD_ENTITY_CREATED: "md.entity_created",
  MD_ENTITY_UPDATED: "md.entity_updated",
  MD_ENTITY_DELETED: "md.entity_deleted",
  MD_ENTITY_SUBMITTED: "md.entity_submitted",
  MD_ENTITY_APPROVED: "md.entity_approved",
  MD_ENTITY_REJECTED: "md.entity_rejected",
  MD_ENTITY_PUBLISHED: "md.entity_published",
  MD_ENTITY_DISABLED: "md.entity_disabled",
  MD_ENTITY_VERSION_CREATED: "md.entity_version_created",
  STANDARD_SOURCE_CREATED: "standard.source_created",
  STANDARD_SOURCE_UPDATED: "standard.source_updated",
  STANDARD_SOURCE_DELETED: "standard.source_deleted",
  STANDARD_SOURCE_RUN: "standard.source_run",
  STANDARD_DOCUMENT_CREATED: "standard.document_created",
  STANDARD_DOCUMENT_UPDATED: "standard.document_updated",
  STANDARD_DOCUMENT_DELETED: "standard.document_deleted",
  STANDARD_DOCUMENT_SUBMITTED: "standard.document_submitted",
  STANDARD_DOCUMENT_APPROVED: "standard.document_approved",
  STANDARD_DOCUMENT_REJECTED: "standard.document_rejected",
  STANDARD_DOCUMENT_PUBLISHED: "standard.document_published",
  STANDARD_APPLICABILITY_CREATED: "standard.applicability_created",
  STANDARD_APPLICABILITY_UPDATED: "standard.applicability_updated",
  STANDARD_APPLICABILITY_DELETED: "standard.applicability_deleted",
  STANDARD_APPLICABILITY_SUBMITTED: "standard.applicability_submitted",
  STANDARD_APPLICABILITY_APPROVED: "standard.applicability_approved",
  STANDARD_APPLICABILITY_REJECTED: "standard.applicability_rejected",
  STANDARD_APPLICABILITY_PUBLISHED: "standard.applicability_published",
  STANDARD_INDICATOR_UPDATED: "standard.indicator_updated",
  STANDARD_INDICATOR_DELETED: "standard.indicator_deleted",
  STANDARD_INDICATOR_APPROVED: "standard.indicator_approved",
  STANDARD_INDICATOR_REJECTED: "standard.indicator_rejected",
  STANDARD_INDICATOR_PUBLISHED: "standard.indicator_published",
  STANDARD_LIMIT_PUBLISHED: "standard.limit_published",
  STANDARD_REPLACEMENT_CREATED: "standard.replacement_created",
  STANDARD_REPLACEMENT_UPDATED: "standard.replacement_updated",
  STANDARD_REPLACEMENT_DELETED: "standard.replacement_deleted",
  STANDARD_REPLACEMENT_CONFIRMED: "standard.replacement_confirmed",
  STANDARD_REPLACEMENT_REJECTED: "standard.replacement_rejected",
  NODE_CREATED: "node.created",
  NODE_UPDATED: "node.updated",
  NODE_DELETED: "node.deleted",
  NODE_SUBMITTED: "node.submitted",
  NODE_APPROVED: "node.approved",
  NODE_REJECTED: "node.rejected",
  NODE_PUBLISHED: "node.published",
  NODE_DISABLED: "node.disabled",
  NODE_VERSION_CREATED: "node.version_created",
  REPORT_TEMPLATE_CREATED: "report.template_created",
  REPORT_TEMPLATE_UPDATED: "report.template_updated",
  REPORT_TEMPLATE_DELETED: "report.template_deleted",
  REPORT_TEMPLATE_SUBMITTED: "report.template_submitted",
  REPORT_TEMPLATE_APPROVED: "report.template_approved",
  REPORT_TEMPLATE_REJECTED: "report.template_rejected",
  REPORT_TEMPLATE_PUBLISHED: "report.template_published",
  REPORT_TEMPLATE_DISABLED: "report.template_disabled",
  REPORT_TEMPLATE_VERSION_CREATED: "report.template_version_created",
  REVIEW_QUEUED: "review.queued",
  REVIEW_APPROVED: "review.approved",
  REVIEW_REJECTED: "review.rejected"
} as const;

export const AI_SCENES = {
  GENERAL_CHAT: "general_chat",
  PROJECT_DESIGN: "project_design",
  MATERIAL_COMPARE: "material_compare",
  STANDARD_QA: "standard_qa",
  REPORT_GENERATE: "report_generate",
  INFORMATION_EXTRACT: "information_extract",
  CONVERSATION_TITLE: "conversation_title",
  KNOWLEDGE_QA: "knowledge_qa"
} as const;

export const CLIENT_APPS = {
  PC_AI: "pc_ai",
  B_ADMIN: "b_admin",
  C_APP: "c_app"
} as const;

export const AI_SCENE_VISIBILITY = {
  USER: "USER",
  INTERNAL: "INTERNAL",
  ADMIN: "ADMIN"
} as const;

export const AI_QUICK_PROMPT_POSITIONS = {
  AI_HOME: "AI_HOME",
  PROJECT_AI: "PROJECT_AI"
} as const;

export const AI_QUICK_PROMPT_ACTION_TYPES = {
  AUTO: "AUTO",
  KNOWLEDGE: "KNOWLEDGE",
  PROJECT: "PROJECT",
  THERMAL: "THERMAL",
  REPORT: "REPORT"
} as const;

export const AI_QUICK_PROMPT_ICONS = ["book", "project", "material", "standard", "calc", "compare", "chat"] as const;

export const AI_FEEDBACK_REACTIONS = {
  LIKE: "LIKE",
  DISLIKE: "DISLIKE"
} as const;

export const SHARE_TARGET_TYPES = {
  AI_MESSAGES: "AI_MESSAGES",
  REPORT: "REPORT",
  REPORT_ARTIFACT: "REPORT_ARTIFACT",
  PROJECT: "PROJECT"
} as const;
