import type { FastifyInstance } from "fastify";
import { ok } from "../../shared/response.js";

export async function dictRoutes(app: FastifyInstance) {
  app.get(
    "/dicts",
    {
      schema: {
        tags: ["公共 / 基础字典"],
        summary: "获取系统基础字典"
      }
    },
    async (request) =>
      ok(request, {
        projectVisibility: [
          { value: "PRIVATE", label: "私有" },
          { value: "DEPARTMENT", label: "部门及子部门" },
          { value: "PUBLIC", label: "历史全员可见" }
        ],
        userRoles: [
          { value: "SUPER_ADMIN", label: "超级管理员" }
        ],
        adminUserTypes: [
          { value: "SUPER_ADMIN", label: "超级管理员" }
        ],
        channelTypes: [
          { value: "DEALER", label: "经销商" },
          { value: "SALESPERSON", label: "业务员" }
        ],
        reportStatuses: [
          { value: "DRAFT", label: "草稿" },
          { value: "QUEUED", label: "排队中" },
          { value: "GENERATING", label: "生成中" },
          { value: "READY", label: "已完成" },
          { value: "FAILED", label: "生成失败" },
          { value: "CANCELLED", label: "已取消" }
        ],
        fileStatuses: [
          { value: "UPLOADING", label: "上传中" },
          { value: "QUEUED", label: "等待处理" },
          { value: "PARSING", label: "解析中" },
          { value: "OCR_REQUIRED", label: "需要 OCR" },
          { value: "INDEXING", label: "建立索引中" },
          { value: "READY", label: "可用" },
          { value: "FAILED", label: "处理失败" },
          { value: "DELETED", label: "已删除" }
        ]
      })
  );
}
