/**
 * 主数据（企业/产品/材料参数）后台权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * 命名遵循现有 system:* 规范，按业务域划分：企业内容与证书、产品（系列/规格/参数/附件）、材料。
 * 查看、新增、修改、删除、审核、发布使用独立权限码；超级管理员全量放行。
 */
export const MD_PERMISSIONS = {
  ENTERPRISE_LIST: "system:md:enterprise:list",
  ENTERPRISE_CREATE: "system:md:enterprise:add",
  ENTERPRISE_UPDATE: "system:md:enterprise:edit",
  ENTERPRISE_DELETE: "system:md:enterprise:remove",
  ENTERPRISE_APPROVE: "system:md:enterprise:approve",
  ENTERPRISE_PUBLISH: "system:md:enterprise:publish",
  PRODUCT_LIST: "system:md:product:list",
  PRODUCT_CREATE: "system:md:product:add",
  PRODUCT_UPDATE: "system:md:product:edit",
  PRODUCT_DELETE: "system:md:product:remove",
  PRODUCT_APPROVE: "system:md:product:approve",
  PRODUCT_PUBLISH: "system:md:product:publish",
  MATERIAL_LIST: "system:md:material:list",
  MATERIAL_CREATE: "system:md:material:add",
  MATERIAL_UPDATE: "system:md:material:edit",
  MATERIAL_DELETE: "system:md:material:remove",
  MATERIAL_APPROVE: "system:md:material:approve",
  MATERIAL_PUBLISH: "system:md:material:publish"
} as const;

export type MdPermission = (typeof MD_PERMISSIONS)[keyof typeof MD_PERMISSIONS];

/** 权限码种子元数据（与 src/db/seed.ts permissionSeeds 合并写入，单一事实源） */
export const MD_PERMISSION_SEEDS: ReadonlyArray<{
  code: MdPermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: MD_PERMISSIONS.ENTERPRISE_LIST, name: "查看企业内容与证书", resource: "md_enterprise", action: "list" },
  { code: MD_PERMISSIONS.ENTERPRISE_CREATE, name: "新增企业内容与证书", resource: "md_enterprise", action: "add" },
  { code: MD_PERMISSIONS.ENTERPRISE_UPDATE, name: "修改企业内容与证书", resource: "md_enterprise", action: "edit" },
  { code: MD_PERMISSIONS.ENTERPRISE_DELETE, name: "删除企业内容与证书草稿", resource: "md_enterprise", action: "remove" },
  { code: MD_PERMISSIONS.ENTERPRISE_APPROVE, name: "审核企业内容与证书", resource: "md_enterprise", action: "approve" },
  { code: MD_PERMISSIONS.ENTERPRISE_PUBLISH, name: "发布或停用企业内容与证书", resource: "md_enterprise", action: "publish" },
  { code: MD_PERMISSIONS.PRODUCT_LIST, name: "查看产品系列、规格与参数", resource: "md_product", action: "list" },
  { code: MD_PERMISSIONS.PRODUCT_CREATE, name: "新增产品系列、规格与参数", resource: "md_product", action: "add" },
  { code: MD_PERMISSIONS.PRODUCT_UPDATE, name: "修改产品系列、规格与参数", resource: "md_product", action: "edit" },
  { code: MD_PERMISSIONS.PRODUCT_DELETE, name: "删除产品系列、规格与参数草稿", resource: "md_product", action: "remove" },
  { code: MD_PERMISSIONS.PRODUCT_APPROVE, name: "审核产品系列、规格与参数", resource: "md_product", action: "approve" },
  { code: MD_PERMISSIONS.PRODUCT_PUBLISH, name: "发布或停用产品系列、规格与参数", resource: "md_product", action: "publish" },
  { code: MD_PERMISSIONS.MATERIAL_LIST, name: "查看材料与材料参数", resource: "md_material", action: "list" },
  { code: MD_PERMISSIONS.MATERIAL_CREATE, name: "新增材料与材料参数", resource: "md_material", action: "add" },
  { code: MD_PERMISSIONS.MATERIAL_UPDATE, name: "修改材料与材料参数", resource: "md_material", action: "edit" },
  { code: MD_PERMISSIONS.MATERIAL_DELETE, name: "删除材料与材料参数草稿", resource: "md_material", action: "remove" },
  { code: MD_PERMISSIONS.MATERIAL_APPROVE, name: "审核材料与材料参数", resource: "md_material", action: "approve" },
  { code: MD_PERMISSIONS.MATERIAL_PUBLISH, name: "发布或停用材料与材料参数", resource: "md_material", action: "publish" }
];