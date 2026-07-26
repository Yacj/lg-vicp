import type { FastifyInstance } from "fastify";
import { ok } from "../../shared/response.js";

export async function dictRoutes(app: FastifyInstance) {
  app.get(
    "/dicts",
    {
      schema: {
        tags: ["字典"],
        summary: "获取系统基础字典"
      }
    },
    async (request) =>
      ok(request, {
        projectVisibility: [
          { value: "PRIVATE", label: "私有" },
          { value: "PUBLIC", label: "公开" }
        ],
        userRoles: [
          { value: "SUPER_ADMIN", label: "超级管理员" },
          { value: "CHANNEL_USER", label: "渠道用户" },
          { value: "NORMAL_USER", label: "普通用户" }
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
          { value: "FAILED", label: "生成失败" }
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
