import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

const swaggerTags = [
  { name: "B端 / 平台 / 用户管理", description: "B 端平台用户管理接口" },
  { name: "B端 / 平台 / 菜单管理", description: "B 端平台菜单和动态路由接口" },
  { name: "B端 / 平台 / 部门管理", description: "B 端平台部门管理接口" },
  { name: "B端 / 平台 / 角色权限", description: "B 端平台角色、权限、菜单和部门接口" },
  { name: "B端 / 平台 / 岗位管理", description: "B 端平台岗位和组织管理接口" },
  { name: "B端 / 平台 / AI配置", description: "B 端平台 AI 服务商、模型和提示词配置接口" },
  { name: "B端 / 平台 / AI运营", description: "B 端平台 AI 会话运营、反馈和审计接口" },
  { name: "B端 / 平台 / AI调试", description: "B 端平台 AI 调试接口（流式验证，不落业务库）" },
  { name: "B端 / 平台 / 审计监控", description: "B 端平台审计日志、缓存和任务监控接口" },
  { name: "B端 / 平台 / 基础数据", description: "B 端平台字典等基础数据接口" },
  { name: "B端 / 平台 / 项目", description: "B 端平台项目管理接口" },
  { name: "B端 / 工作台 / 项目", description: "B 端渠道工作台项目接口" },
  { name: "B端 / 认证", description: "B 端管理后台认证接口" },
  { name: "C端 / 认证", description: "C 端应用认证接口" },
  { name: "PC AI端 / 认证", description: "PC AI 端认证接口" },
  { name: "共用 / 认证", description: "多个客户端共用的认证接口" },
  { name: "共用 / AI对话", description: "B 端、C 端和 PC AI 端共用的 AI 对话接口" },
  { name: "共用 / 项目", description: "登录用户共用的项目读取接口" },
  { name: "共用 / 文件", description: "受项目和用户权限保护的文件接口" },
  { name: "共用 / 报告", description: "报告生成、发布和受控下载接口" },
  { name: "共用 / 分享", description: "登录用户创建和管理分享链接接口" },
  { name: "公共 / 分享", description: "匿名访问公开分享内容接口" },
  { name: "公共 / 基础字典", description: "客户端和后台共用的基础字典接口" },
  { name: "公共 / 健康检查", description: "服务健康和依赖状态检查接口" }
];

export const swaggerPlugin = fp(async (app) => {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "蓝格 VICP 建筑节能 AI 智配系统接口",
        description: "面向管理端、PC AI 对话端和 C 端应用的统一后端接口。",
        version: "0.2.0"
      },
      tags: swaggerTags
    },
    transform: jsonSchemaTransform
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      tagsSorter: "alpha",
      operationsSorter: "alpha"
    }
  });
});
