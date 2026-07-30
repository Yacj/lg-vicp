import { z } from "zod";
import { PROJECT_VISIBILITY } from "../../shared/constants.js";

export const createProjectBodySchema = z.object({
  name: z.string().trim().min(1, "请输入项目名称").max(120, "项目名称不能超过 120 个字符"),
  description: z.string().max(2000, "项目描述不能超过 2000 个字符").optional(),
  visibility: z.enum([PROJECT_VISIBILITY.PRIVATE, PROJECT_VISIBILITY.PUBLIC]).default(PROJECT_VISIBILITY.PRIVATE)
});

export const projectParamsSchema = z.object({
  id: z.uuid("项目 ID 格式不正确")
});

export const updateProjectBodySchema = createProjectBodySchema.omit({ visibility: true }).partial()
  .refine((value) => Object.keys(value).length > 0, "至少需要修改一个字段");

export const updateVisibilityBodySchema = z.object({
  visibility: z.enum([PROJECT_VISIBILITY.PRIVATE, PROJECT_VISIBILITY.PUBLIC])
});
