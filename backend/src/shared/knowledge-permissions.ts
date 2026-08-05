/**
 * 知识库相关后台权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * 命名遵循现有 system:* 规范，查看、新增、修改、删除、上传、解析、审核、发布使用独立权限码。
 * 仅新路由引用本常量；存量路由保持内联字符串，避免无谓重构。
 */
export const KNOWLEDGE_PERMISSIONS = {
  CATEGORY_LIST: "system:knowledge:category:list",
  CATEGORY_CREATE: "system:knowledge:category:add",
  CATEGORY_UPDATE: "system:knowledge:category:edit",
  CATEGORY_DELETE: "system:knowledge:category:remove",
  DOC_LIST: "system:knowledge:doc:list",
  DOC_CREATE: "system:knowledge:doc:add",
  DOC_UPDATE: "system:knowledge:doc:edit",
  DOC_DELETE: "system:knowledge:doc:remove",
  DOC_UPLOAD: "system:knowledge:doc:upload",
  DOC_PARSE: "system:knowledge:doc:parse",
  DOC_APPROVE: "system:knowledge:doc:approve",
  DOC_PUBLISH: "system:knowledge:doc:publish",
  ALIAS_LIST: "system:knowledge:alias:list",
  ALIAS_CREATE: "system:knowledge:alias:add",
  ALIAS_UPDATE: "system:knowledge:alias:edit",
  ALIAS_DELETE: "system:knowledge:alias:remove",
  SEARCH_LOG_LIST: "system:knowledge:search-log:list",
  CRAWLER_LIST: "system:knowledge:crawler:list",
  CRAWLER_CREATE: "system:knowledge:crawler:add",
  CRAWLER_UPDATE: "system:knowledge:crawler:edit",
  CRAWLER_DELETE: "system:knowledge:crawler:remove",
  CRAWLER_RUN: "system:knowledge:crawler:run",
  RANKING_LIST: "system:knowledge:ranking:list",
  RANKING_UPDATE: "system:knowledge:ranking:edit",
  EVAL_CREATE: "system:knowledge:eval:add",
  EVAL_LIST: "system:knowledge:eval:list",
  EVAL_JUDGE: "system:knowledge:eval:judge"
} as const;

export type KnowledgePermission = (typeof KNOWLEDGE_PERMISSIONS)[keyof typeof KNOWLEDGE_PERMISSIONS];

/** 权限码种子元数据（与 src/db/seed.ts permissionSeeds 合并写入，单一事实源） */
export const KNOWLEDGE_PERMISSION_SEEDS: ReadonlyArray<{
  code: KnowledgePermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: KNOWLEDGE_PERMISSIONS.CATEGORY_LIST, name: "查看知识分类", resource: "knowledge_category", action: "list" },
  { code: KNOWLEDGE_PERMISSIONS.CATEGORY_CREATE, name: "新增知识分类", resource: "knowledge_category", action: "add" },
  { code: KNOWLEDGE_PERMISSIONS.CATEGORY_UPDATE, name: "修改知识分类", resource: "knowledge_category", action: "edit" },
  { code: KNOWLEDGE_PERMISSIONS.CATEGORY_DELETE, name: "删除知识分类", resource: "knowledge_category", action: "remove" },
  { code: KNOWLEDGE_PERMISSIONS.DOC_LIST, name: "查看知识文档", resource: "knowledge_doc", action: "list" },
  { code: KNOWLEDGE_PERMISSIONS.DOC_CREATE, name: "新增知识文档", resource: "knowledge_doc", action: "add" },
  { code: KNOWLEDGE_PERMISSIONS.DOC_UPDATE, name: "修改知识文档", resource: "knowledge_doc", action: "edit" },
  { code: KNOWLEDGE_PERMISSIONS.DOC_DELETE, name: "删除知识文档", resource: "knowledge_doc", action: "remove" },
  { code: KNOWLEDGE_PERMISSIONS.DOC_UPLOAD, name: "上传知识文档文件", resource: "knowledge_doc", action: "upload" },
  { code: KNOWLEDGE_PERMISSIONS.DOC_PARSE, name: "解析知识文档", resource: "knowledge_doc", action: "parse" },
  { code: KNOWLEDGE_PERMISSIONS.DOC_APPROVE, name: "审核知识文档", resource: "knowledge_doc", action: "approve" },
  { code: KNOWLEDGE_PERMISSIONS.DOC_PUBLISH, name: "发布知识文档版本", resource: "knowledge_doc", action: "publish" },
  { code: KNOWLEDGE_PERMISSIONS.ALIAS_LIST, name: "查看别名词典", resource: "knowledge_alias", action: "list" },
  { code: KNOWLEDGE_PERMISSIONS.ALIAS_CREATE, name: "新增别名词典", resource: "knowledge_alias", action: "add" },
  { code: KNOWLEDGE_PERMISSIONS.ALIAS_UPDATE, name: "修改别名词典", resource: "knowledge_alias", action: "edit" },
  { code: KNOWLEDGE_PERMISSIONS.ALIAS_DELETE, name: "删除别名词典", resource: "knowledge_alias", action: "remove" },
  { code: KNOWLEDGE_PERMISSIONS.SEARCH_LOG_LIST, name: "查看知识检索日志", resource: "knowledge_search_log", action: "list" },
  { code: KNOWLEDGE_PERMISSIONS.CRAWLER_LIST, name: "查看抓取源", resource: "knowledge_crawler_source", action: "list" },
  { code: KNOWLEDGE_PERMISSIONS.CRAWLER_CREATE, name: "新增抓取源", resource: "knowledge_crawler_source", action: "add" },
  { code: KNOWLEDGE_PERMISSIONS.CRAWLER_UPDATE, name: "修改抓取源", resource: "knowledge_crawler_source", action: "edit" },
  { code: KNOWLEDGE_PERMISSIONS.CRAWLER_DELETE, name: "删除抓取源", resource: "knowledge_crawler_source", action: "remove" },
  { code: KNOWLEDGE_PERMISSIONS.CRAWLER_RUN, name: "手动触发抓取", resource: "knowledge_crawler_source", action: "run" },
  { code: KNOWLEDGE_PERMISSIONS.RANKING_LIST, name: "查看检索排序规则", resource: "knowledge_ranking_rule", action: "list" },
  { code: KNOWLEDGE_PERMISSIONS.RANKING_UPDATE, name: "修改检索排序规则", resource: "knowledge_ranking_rule", action: "edit" },
  { code: KNOWLEDGE_PERMISSIONS.EVAL_CREATE, name: "提交检索评测", resource: "knowledge_search_evaluation", action: "add" },
  { code: KNOWLEDGE_PERMISSIONS.EVAL_LIST, name: "查看检索评测", resource: "knowledge_search_evaluation", action: "list" },
  { code: KNOWLEDGE_PERMISSIONS.EVAL_JUDGE, name: "判定检索评测", resource: "knowledge_search_evaluation", action: "judge" }
];