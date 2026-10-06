import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";
import { PROJECT_VISIBILITY } from "../../shared/constants.js";

const p0Visibility = z.enum([PROJECT_VISIBILITY.PRIVATE, PROJECT_VISIBILITY.DEPARTMENT]);
const listVisibility = z.enum([PROJECT_VISIBILITY.PRIVATE, PROJECT_VISIBILITY.DEPARTMENT, PROJECT_VISIBILITY.PUBLIC]);

export const createProjectBodySchema = z.object({
  name: z.string().trim().min(1, "请输入项目名称").max(120, "项目名称不能超过 120 个字符"),
  description: z.string().max(2000, "项目描述不能超过 2000 个字符").optional(),
  region: z.string().trim().max(80, "地区不能超过 80 个字符").optional(),
  buildingType: z.string().trim().max(80, "建筑类型不能超过 80 个字符").optional(),
  visibility: p0Visibility.default(PROJECT_VISIBILITY.PRIVATE),
  visibleDepartmentId: z.uuid("部门 ID 格式不正确").nullable().optional(),
  includeChildDepartments: z.boolean().optional()
}).superRefine((value, context) => {
  if (value.visibility === PROJECT_VISIBILITY.DEPARTMENT && !value.visibleDepartmentId) {
    context.addIssue({ code: "custom", path: ["visibleDepartmentId"], message: "部门可见项目必须选择可见部门" });
  }
  if (value.visibility === PROJECT_VISIBILITY.PRIVATE && value.visibleDepartmentId) {
    context.addIssue({ code: "custom", path: ["visibleDepartmentId"], message: "私有项目不能设置可见部门" });
  }
});

export const clientProjectListQuerySchema = paginationQuerySchema.extend({
  visibility: listVisibility.optional(),
  keyword: z.string().trim().max(120, "搜索关键词不能超过 120 个字符").optional()
});

export const projectParamsSchema = z.object({
  id: z.uuid("项目 ID 格式不正确")
});

export const updateProjectBodySchema = z.object({
  name: z.string().trim().min(1, "请输入项目名称").max(120, "项目名称不能超过 120 个字符").optional(),
  description: z.string().max(2000, "项目描述不能超过 2000 个字符").optional(),
  region: z.string().trim().max(80, "地区不能超过 80 个字符").optional(),
  buildingType: z.string().trim().max(80, "建筑类型不能超过 80 个字符").optional()
}).refine((value) => Object.keys(value).length > 0, "至少需要修改一个字段");

export const updateVisibilityBodySchema = z.object({
  visibility: p0Visibility,
  visibleDepartmentId: z.uuid("部门 ID 格式不正确").nullable().optional(),
  includeChildDepartments: z.boolean().optional()
}).superRefine((value, context) => {
  if (value.visibility === PROJECT_VISIBILITY.DEPARTMENT && !value.visibleDepartmentId) {
    context.addIssue({ code: "custom", path: ["visibleDepartmentId"], message: "部门可见项目必须选择可见部门" });
  }
  if (value.visibility === PROJECT_VISIBILITY.PRIVATE && value.visibleDepartmentId) {
    context.addIssue({ code: "custom", path: ["visibleDepartmentId"], message: "私有项目不能设置可见部门" });
  }
});

export const platformProjectListQuerySchema = paginationQuerySchema.extend({
  visibility: listVisibility.optional(),
  keyword: z.string().trim().max(120).optional()
});
