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
  { name: "B端 / 平台 / 知识库", description: "B 端平台知识文档、版本、页面、分块与检索接口" },
  { name: "B端 / 平台 / AI运营", description: "B 端平台 AI 会话运营、反馈和审计接口" },
  { name: "B端 / 平台 / AI调试", description: "B 端平台 AI 调试接口（流式验证，不落业务库）" },
  { name: "B端 / 平台 / 审计监控", description: "B 端平台审计日志、缓存和任务监控接口" },
  { name: "B端 / 平台 / 基础数据", description: "B 端平台字典等基础数据接口" },
  { name: "B端 / 平台 / 主数据", description: "B 端平台企业内容、产品系列/规格/参数、材料参数主数据接口" },
  { name: "B端 / 平台 / 构造方案", description: "B 端平台保温系统、构造方案、构造层与产品选项接口" },
  { name: "B端 / 平台 / 图集热工", description: "B 端平台图集热工参考选用表导入、审核与查表接口" },
  { name: "B端 / 平台 / 标准采集", description: "B 端平台地方标准站点抓取、人工录入、审核发布与版本替代接口" },
  { name: "B端 / 平台 / 材料对比", description: "B 端平台材料对比版本、材料、规则、证据与五维管理接口" },
  { name: "B端 / 平台 / 节点图库", description: "B 端平台节点大样图、节点-方案关联与已发布读取接口" },
  { name: "B端 / 平台 / 报告模板", description: "高级技术管理员维护内部报告渲染模板（普通菜单隐藏）" },
  { name: "B端 / 平台 / 报告中心", description: "B 端平台报告类型、报告设置、报告生成、快照与审核接口" },
  { name: "B端 / 平台 / 审核中心", description: "B 端平台统一审核队列（产品/构造/热工/标准/比较/报告）接口" },
  { name: "PC AI端 / 材料对比", description: "PC AI 端已审核材料对比规则查询接口（项目可见性守卫）" },
  { name: "PC AI端 / 热工计算", description: "PC AI 端确定性热工计算接口（三模式，快照可追溯）" },
  { name: "B端 / 平台 / 项目", description: "B 端平台项目管理接口" },
  { name: "B端 / 工作台 / 项目", description: "B 端渠道工作台项目接口" },
  { name: "B端 / 认证", description: "B 端管理后台认证接口" },
  { name: "C端 / 认证", description: "C 端应用认证接口" },
  { name: "PC AI端 / 认证", description: "PC AI 端认证接口" },
  { name: "共用 / 认证", description: "多个客户端共用的认证接口" },
  { name: "共用 / AI对话", description: "B 端、C 端和 PC AI 端共用的 AI 对话接口" },
  { name: "共用 / 知识溯源", description: "AI 回答来源的 Wiki 原文阅读与高亮定位接口" },
  { name: "C端 / 公开文库", description: "C 端公开文库只读接口（visibility=PUBLIC 的已发布知识文档）" },
  { name: "C端 / 企业内容", description: "C 端已发布企业介绍只读接口（关于蓝格智配）" },
  { name: "B端 / 平台 / 消息通知", description: "B 端平台消息通知中心（反馈提醒/待审核/失败告警）接口" },
  { name: "共用 / 项目", description: "登录用户共用的项目读取接口" },
  { name: "共用 / 文件", description: "受项目和用户权限保护的文件接口" },
  { name: "共用 / 报告", description: "报告生成、发布和受控下载接口" },
  { name: "共用 / 分享", description: "登录用户创建和管理分享链接接口" },
  { name: "公共 / 分享", description: "匿名访问公开分享内容接口" },
  { name: "公共 / 基础字典", description: "客户端和后台共用的基础字典接口" },
  { name: "公共 / 健康检查", description: "服务健康和依赖状态检查接口" },
  { name: "公共 / 内部接口", description: "服务间受控调用接口（静态密钥鉴权，不对外开放）" }
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
