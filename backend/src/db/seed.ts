import "dotenv/config";
import * as argon2 from "argon2";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "../config/env.js";
import { createDatabase } from "./client.js";
import {
  aiModels,
  aiProviders,
  aiScenes,
  menus,
  permissions,
  prompts,
  promptVersions,
  rolePermissions,
  roles,
  userIdentities,
  userRoles,
  users
} from "./schema.js";

const { db, client } = createDatabase(env);

const permissionSeeds = [
  { code: "platform.manage", name: "平台管理", resource: "platform", action: "manage" },
  { code: "project.create", name: "创建项目", resource: "project", action: "create" },
  { code: "project.read_public", name: "查看公开项目", resource: "project", action: "read" },
  { code: "system:project:list", name: "查看全部项目", resource: "project", action: "list" },
  { code: "ai.chat", name: "使用 AI 对话", resource: "ai", action: "chat" },
  { code: "system:user:list", name: "查看用户", resource: "user", action: "list" },
  { code: "system:user:export", name: "导出用户", resource: "user", action: "export" },
  { code: "system:user:import", name: "导入用户", resource: "user", action: "import" },
  { code: "system:user:add", name: "新增用户", resource: "user", action: "add" },
  { code: "system:user:edit", name: "修改用户", resource: "user", action: "edit" },
  { code: "system:user:remove", name: "删除用户", resource: "user", action: "remove" },
  { code: "system:user:reset-password", name: "重置用户密码", resource: "user", action: "reset-password" },
  { code: "system:user:post", name: "分配用户岗位", resource: "user", action: "post" },
  { code: "system:user:dept", name: "分配用户部门", resource: "user", action: "department" },
  { code: "system:user:role", name: "分配用户角色", resource: "user", action: "role" },
  { code: "system:role:list", name: "查看角色", resource: "role", action: "list" },
  { code: "system:role:add", name: "新增角色", resource: "role", action: "add" },
  { code: "system:role:edit", name: "修改角色", resource: "role", action: "edit" },
  { code: "system:role:remove", name: "删除角色", resource: "role", action: "remove" },
  { code: "system:role:export", name: "导出角色", resource: "role", action: "export" },
  { code: "system:role:permission", name: "分配角色权限", resource: "role", action: "permission" },
  { code: "system:role:data-scope", name: "配置角色数据范围", resource: "role", action: "data-scope" },
  { code: "system:menu:list", name: "查看菜单", resource: "menu", action: "list" },
  { code: "system:menu:add", name: "新增菜单", resource: "menu", action: "add" },
  { code: "system:menu:edit", name: "修改菜单", resource: "menu", action: "edit" },
  { code: "system:menu:remove", name: "删除菜单", resource: "menu", action: "remove" },
  { code: "system:permission:list", name: "查看权限", resource: "permission", action: "list" },
  { code: "system:permission:add", name: "新增权限", resource: "permission", action: "add" },
  { code: "system:dept:list", name: "查看部门", resource: "department", action: "list" },
  { code: "system:dept:add", name: "新增部门", resource: "department", action: "add" },
  { code: "system:dept:edit", name: "修改部门", resource: "department", action: "edit" },
  { code: "system:dept:remove", name: "删除部门", resource: "department", action: "remove" },
  { code: "system:post:list", name: "查看岗位", resource: "post", action: "list" },
  { code: "system:post:add", name: "新增岗位", resource: "post", action: "add" },
  { code: "system:post:edit", name: "修改岗位", resource: "post", action: "edit" },
  { code: "system:post:remove", name: "删除岗位", resource: "post", action: "remove" },
  { code: "system:dict:list", name: "查看字典", resource: "dictionary", action: "list" },
  { code: "system:dict:add", name: "新增字典", resource: "dictionary", action: "add" },
  { code: "system:dict:edit", name: "修改字典", resource: "dictionary", action: "edit" },
  { code: "system:dict:remove", name: "删除字典", resource: "dictionary", action: "remove" },
  { code: "system:dict:item:add", name: "新增字典项", resource: "dictionary_item", action: "add" },
  { code: "monitor:audit:list", name: "查看审计日志", resource: "audit", action: "list" },
  { code: "monitor:audit:export", name: "导出审计日志", resource: "audit", action: "export" },
  { code: "monitor:login-log:list", name: "查看登录日志", resource: "login_log", action: "list" },
  { code: "monitor:online:list", name: "查看在线用户", resource: "online_user", action: "list" },
  { code: "monitor:online:kick", name: "强制用户下线", resource: "online_user", action: "kick" },
  { code: "monitor:cache:list", name: "查看缓存", resource: "cache", action: "list" },
  { code: "monitor:cache:remove", name: "删除缓存", resource: "cache", action: "remove" },
  { code: "monitor:job:list", name: "查看定时任务", resource: "job", action: "list" },
  { code: "monitor:job:add", name: "新增定时任务", resource: "job", action: "add" },
  { code: "monitor:job:edit", name: "修改定时任务", resource: "job", action: "edit" },
  { code: "monitor:job:run", name: "执行定时任务", resource: "job", action: "run" },
  { code: "system:ai:provider:list", name: "查看 AI 服务商", resource: "ai_provider", action: "list" },
  { code: "system:ai:provider:add", name: "新增 AI 服务商", resource: "ai_provider", action: "add" },
  { code: "system:ai:provider:edit", name: "修改 AI 服务商", resource: "ai_provider", action: "edit" },
  { code: "system:ai:provider:remove", name: "删除 AI 服务商", resource: "ai_provider", action: "remove" },
  { code: "system:ai:provider:test", name: "测试 AI 服务商连接", resource: "ai_provider", action: "test" },
  { code: "system:ai:model:list", name: "查看 AI 模型", resource: "ai_model", action: "list" },
  { code: "system:ai:model:add", name: "新增 AI 模型", resource: "ai_model", action: "add" },
  { code: "system:ai:model:edit", name: "修改 AI 模型", resource: "ai_model", action: "edit" },
  { code: "system:ai:model:remove", name: "删除 AI 模型", resource: "ai_model", action: "remove" },
  { code: "system:ai:model:test", name: "测试 AI 模型", resource: "ai_model", action: "test" },
  { code: "system:ai:scene:list", name: "查看 AI 场景", resource: "ai_scene", action: "list" },
  { code: "system:ai:scene:edit", name: "配置 AI 场景", resource: "ai_scene", action: "edit" },
  { code: "system:ai:prompt:list", name: "查看 AI 提示词", resource: "ai_prompt", action: "list" },
  { code: "system:ai:prompt:add", name: "新增 AI 提示词", resource: "ai_prompt", action: "add" },
  { code: "system:ai:prompt:edit", name: "编辑 AI 提示词草稿", resource: "ai_prompt", action: "edit" },
  { code: "system:ai:prompt:publish", name: "发布 AI 提示词", resource: "ai_prompt", action: "publish" },
  { code: "system:ai:prompt:remove", name: "删除 AI 提示词", resource: "ai_prompt", action: "remove" },
  { code: "system:ai:conversation:list", name: "查看 AI 会话列表", resource: "ai_conversation", action: "list" },
  { code: "system:ai:conversation:detail", name: "查看 AI 会话详情", resource: "ai_conversation", action: "detail" },
  { code: "system:ai:debug:use", name: "使用 AI 调试", resource: "ai_debug", action: "use" },
  { code: "system:ai:feedback:list", name: "查看 AI 反馈", resource: "ai_feedback", action: "list" },
  { code: "system:ai:feedback:handle", name: "处理 AI 反馈", resource: "ai_feedback", action: "handle" }
] as const;

try {
  const passwordHash = await argon2.hash(env.BOOTSTRAP_ADMIN_PASSWORD, { type: argon2.argon2id });

  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(userIdentities)
      .innerJoin(users, eq(users.id, userIdentities.userId))
      .where(eq(userIdentities.identifier, env.BOOTSTRAP_ADMIN_USERNAME)).limit(1);

    let adminUserId = existing?.id;
    if (!existing) {
      const [admin] = await tx.insert(users).values({
        displayName: "超级管理员",
        role: "SUPER_ADMIN",
        status: "ACTIVE"
      }).returning({ id: users.id });
      await tx.insert(userIdentities).values({
        userId: admin!.id,
        type: "USERNAME",
        identifier: env.BOOTSTRAP_ADMIN_USERNAME,
        passwordHash,
        verifiedAt: new Date()
      });
      adminUserId = admin!.id;
    }

    await tx.insert(roles).values([
      { code: "platform_admin", name: "平台管理员", description: "管理平台级配置和数据" },
      { code: "channel_operator", name: "渠道业务人员", description: "管理本人创建的项目" },
      { code: "normal_user", name: "普通用户", description: "查看公开项目并使用普通 AI 对话" }
    ]).onConflictDoNothing();

    await tx.insert(permissions).values([...permissionSeeds]).onConflictDoNothing();

    const seededRoles = await tx.select({ id: roles.id, code: roles.code }).from(roles);
    await tx.update(roles).set({ dataScope: "ALL" }).where(eq(roles.code, "platform_admin"));
    await tx.update(roles).set({ dataScope: "PROJECT_OWNER" }).where(eq(roles.code, "channel_operator"));
    await tx.update(roles).set({ dataScope: "SELF" }).where(eq(roles.code, "normal_user"));
    const seededPermissions = await tx.select({ id: permissions.id, code: permissions.code }).from(permissions);
    const platformAdminRole = seededRoles.find((item) => item.code === "platform_admin");
    const channelRole = seededRoles.find((item) => item.code === "channel_operator");
    const normalRole = seededRoles.find((item) => item.code === "normal_user");
    if (adminUserId && platformAdminRole) {
      await tx.insert(userRoles).values({ userId: adminUserId, roleId: platformAdminRole.id }).onConflictDoNothing();
      await tx.insert(rolePermissions).values(seededPermissions.map((permission) => ({
        roleId: platformAdminRole.id,
        permissionId: permission.id
      }))).onConflictDoNothing();
    }
    const projectCreate = seededPermissions.find((permission) => permission.code === "project.create");
    const publicProjectRead = seededPermissions.find((permission) => permission.code === "project.read_public");
    const aiChat = seededPermissions.find((permission) => permission.code === "ai.chat");
    if (channelRole && projectCreate && aiChat) {
      await tx.insert(rolePermissions).values([
        { roleId: channelRole.id, permissionId: projectCreate.id },
        { roleId: channelRole.id, permissionId: aiChat.id }
      ]).onConflictDoNothing();
    }
    if (normalRole && publicProjectRead && aiChat) {
      await tx.insert(rolePermissions).values([
        { roleId: normalRole.id, permissionId: publicProjectRead.id },
        { roleId: normalRole.id, permissionId: aiChat.id }
      ]).onConflictDoNothing();
    }
    const ensureMenu = async (values: typeof menus.$inferInsert) => {
      const [menu] = await tx.insert(menus).values(values).onConflictDoUpdate({
        target: menus.routePath,
        set: { ...values, updatedAt: new Date() }
      }).returning({ id: menus.id });
      return menu!.id;
    };
    const systemMenuId = await ensureMenu({
      menuType: "DIRECTORY", name: "系统管理", routePath: "/system", icon: "settings", sortOrder: 10, permissionCode: "platform.manage"
    });
    await ensureMenu({ parentId: systemMenuId, menuType: "MENU", name: "用户管理", routePath: "/system/user", component: "system/user/index", sortOrder: 10, permissionCode: "system:user:list" });
    await ensureMenu({ parentId: systemMenuId, menuType: "MENU", name: "角色管理", routePath: "/system/role", component: "system/role/index", sortOrder: 20, permissionCode: "system:role:list" });
    await ensureMenu({ parentId: systemMenuId, menuType: "MENU", name: "菜单管理", routePath: "/system/menu", component: "system/menu/index", sortOrder: 30, permissionCode: "system:menu:list" });
    await ensureMenu({ parentId: systemMenuId, menuType: "MENU", name: "部门管理", routePath: "/system/dept", component: "system/dept/index", sortOrder: 40, permissionCode: "system:dept:list" });
    await ensureMenu({ parentId: systemMenuId, menuType: "MENU", name: "岗位管理", routePath: "/system/post", component: "system/post/index", sortOrder: 50, permissionCode: "system:post:list" });
    await ensureMenu({ parentId: systemMenuId, menuType: "MENU", name: "字典管理", routePath: "/system/dict", component: "system/dict/index", sortOrder: 60, permissionCode: "system:dict:list" });
    const aiConfigMenuId = await ensureMenu({
      menuType: "MENU", name: "AI 配置", routePath: "/system/ai", component: "system/ai/index", sortOrder: 70, permissionCode: "system:ai:provider:list"
    });
    await ensureMenu({ parentId: aiConfigMenuId, menuType: "BUTTON", name: "测试服务商连接", routePath: "/system/ai/test-connection", sortOrder: 10, permissionCode: "system:ai:provider:test" });
    await ensureMenu({ parentId: aiConfigMenuId, menuType: "BUTTON", name: "提示词发布", routePath: "/system/ai/prompt-publish", sortOrder: 20, permissionCode: "system:ai:prompt:publish" });
    await ensureMenu({ parentId: aiConfigMenuId, menuType: "BUTTON", name: "AI 调试", routePath: "/system/ai/debug", sortOrder: 30, permissionCode: "system:ai:debug:use" });
    const monitorMenuId = await ensureMenu({
      menuType: "DIRECTORY", name: "系统监控", routePath: "/monitor", icon: "monitor", sortOrder: 20, permissionCode: "monitor:audit:list"
    });
    await ensureMenu({ parentId: monitorMenuId, menuType: "MENU", name: "审计日志", routePath: "/monitor/audit", component: "monitor/audit/index", sortOrder: 10, permissionCode: "monitor:audit:list" });
    await ensureMenu({ parentId: monitorMenuId, menuType: "MENU", name: "在线用户", routePath: "/monitor/online", component: "monitor/online/index", sortOrder: 20, permissionCode: "monitor:online:list" });
    await ensureMenu({ parentId: monitorMenuId, menuType: "MENU", name: "定时任务", routePath: "/monitor/job", component: "monitor/job/index", sortOrder: 30, permissionCode: "monitor:job:list" });
    await ensureMenu({ parentId: monitorMenuId, menuType: "MENU", name: "缓存监控", routePath: "/monitor/cache", component: "monitor/cache/index", sortOrder: 40, permissionCode: "monitor:cache:list" });
    const aiOpsMenuId = await ensureMenu({ parentId: monitorMenuId, menuType: "MENU", name: "AI 运营", routePath: "/monitor/ai", component: "monitor/ai/index", sortOrder: 50, permissionCode: "system:ai:conversation:list" });
    await ensureMenu({ parentId: aiOpsMenuId, menuType: "BUTTON", name: "反馈处理", routePath: "/monitor/ai/feedback-handle", sortOrder: 10, permissionCode: "system:ai:feedback:handle" });
    await ensureMenu({
      menuType: "MENU", name: "项目管理", routePath: "/project", component: "project/index", sortOrder: 30, permissionCode: "project.create"
    });
    await ensureMenu({ menuType: "MENU", name: "AI 对话", routePath: "/ai", component: "ai/index", sortOrder: 40, permissionCode: "ai.chat" });

    await tx.insert(aiProviders).values({
      code: "deepseek",
      name: "DeepSeek",
      description: "DeepSeek 官方 OpenAI 兼容接口",
      type: "OPENAI_COMPATIBLE",
      baseUrl: "https://api.deepseek.com/v1",
      enabled: true
    }).onConflictDoNothing();

    const [deepSeekProvider] = await tx.select({ id: aiProviders.id }).from(aiProviders)
      .where(eq(aiProviders.name, "DeepSeek")).limit(1);
    if (deepSeekProvider) {
      await tx.insert(aiModels).values({
        providerId: deepSeekProvider.id,
        code: "deepseek-chat",
        displayName: "DeepSeek Chat",
        modelId: "deepseek-chat",
        description: "DeepSeek 通用对话模型",
        capabilities: {
          text: true,
          streaming: true,
          structuredOutput: true,
          reasoning: true,
          reasoningEffort: true
        },
        contextWindow: 64_000,
        maxOutputTokens: 4_000,
        defaultTemperature: 0.2,
        priority: 10,
        enabled: true
      }).onConflictDoUpdate({
        target: [aiModels.providerId, aiModels.modelId],
        set: {
          capabilities: {
            text: true,
            streaming: true,
            structuredOutput: true,
            reasoning: true,
            reasoningEffort: true
          },
          updatedAt: new Date()
        }
      });
    }

    const sceneSeeds = [
      { code: "general_chat", name: "通用对话", description: "通用对话，不依赖项目、知识库与计算工具", allowReasoning: true, requireProject: false, allowFileUpload: false, allowKnowledgeSearch: false, allowTools: false, enabled: true, sort: 1 },
      { code: "project_design", name: "项目设计", description: "项目设计咨询（未开放：依赖知识库与确定性计算工具）", allowReasoning: false, requireProject: true, allowFileUpload: false, allowKnowledgeSearch: false, allowTools: false, enabled: false, sort: 2 },
      { code: "material_compare", name: "材料对比", description: "材料对比分析（未开放：依赖知识库与计算工具）", allowReasoning: false, requireProject: true, allowFileUpload: false, allowKnowledgeSearch: false, allowTools: false, enabled: false, sort: 3 },
      { code: "standard_qa", name: "标准问答", description: "建筑标准条文问答（未开放：依赖知识库）", allowReasoning: false, requireProject: false, allowFileUpload: false, allowKnowledgeSearch: false, allowTools: false, enabled: false, sort: 4 },
      { code: "report_generate", name: "报告生成", description: "工程报告生成（未开放：依赖知识库与报告模板）", allowReasoning: false, requireProject: true, allowFileUpload: false, allowKnowledgeSearch: false, allowTools: false, enabled: false, sort: 5 },
      { code: "information_extract", name: "信息抽取", description: "建筑资料信息抽取（未开放：依赖知识库）", allowReasoning: false, requireProject: true, allowFileUpload: false, allowKnowledgeSearch: false, allowTools: false, enabled: false, sort: 6 }
    ] as const;

    const scenePrompts = [
      { code: "general_chat", name: "通用对话提示词", systemPrompt: "你是蓝格 VICP 建筑节能 AI 助手。请使用中文准确回答；资料不足时明确说明不确定。" },
      { code: "project_design", name: "项目设计提示词", systemPrompt: "你是 VICP 建筑节能项目设计助手。只依据项目资料和确定性计算结果提出建议，并使用中文回答。" },
      { code: "material_compare", name: "材料对比提示词", systemPrompt: "你是建筑保温材料对比助手。客观列出依据、适用条件和限制，禁止编造性能参数。" },
      { code: "standard_qa", name: "标准问答提示词", systemPrompt: "你是建筑节能标准问答助手。回答必须引用资料名称和页码；没有来源时明确拒绝下结论。" },
      { code: "report_generate", name: "报告生成提示词", systemPrompt: "你是 VICP 项目报告助手。输出结构化中文内容，技术结论必须可追溯，工程结论须提示专业人员复核。" },
      { code: "information_extract", name: "信息抽取提示词", systemPrompt: "你是建筑资料信息抽取助手。只提取原文存在的信息，缺失字段返回空值，不得猜测。" }
    ] as const;

    await tx.insert(aiScenes).values(sceneSeeds.map((scene) => ({
      ...scene,
      temperature: null,
      maxOutputTokens: null
    }))).onConflictDoNothing();

    const [deepSeekModel] = await tx.select({ id: aiModels.id }).from(aiModels)
      .where(and(eq(aiModels.providerId, deepSeekProvider?.id ?? ""), eq(aiModels.modelId, "deepseek-chat"))).limit(1);

    const ensureScenePrompt = async (sceneCode: string) => {
      const [scene] = await tx.select({ id: aiScenes.id }).from(aiScenes).where(eq(aiScenes.code, sceneCode)).limit(1);
      if (!scene) return;
      const promptSeed = scenePrompts.find((prompt) => prompt.code === sceneCode);
      const [existingPrompt] = await tx.select({ id: prompts.id }).from(prompts).where(eq(prompts.code, sceneCode)).limit(1);
      const promptId = existingPrompt?.id ?? (await tx.insert(prompts).values({
        sceneId: scene.id,
        name: promptSeed?.name ?? sceneCode,
        code: sceneCode,
        description: promptSeed?.systemPrompt.slice(0, 60)
      }).onConflictDoNothing().returning({ id: prompts.id }))[0]?.id;
      if (!promptId) return;
      const [published] = await tx.select({ id: promptVersions.id }).from(promptVersions)
        .where(and(eq(promptVersions.promptId, promptId), eq(promptVersions.status, "PUBLISHED"))).limit(1);
      if (!published && promptSeed) {
        const [v1] = await tx.insert(promptVersions).values({
          promptId,
          version: 1,
          content: promptSeed.systemPrompt,
          status: "PUBLISHED",
          changeNote: "初始版本"
        }).returning();
        await tx.update(prompts).set({ activeVersionId: v1!.id, updatedAt: new Date() }).where(eq(prompts.id, promptId));
        await tx.update(aiScenes).set({ promptId, updatedAt: new Date() }).where(eq(aiScenes.id, scene.id));
      } else {
        await tx.update(prompts).set({ activeVersionId: published!.id, updatedAt: new Date() })
          .where(and(eq(prompts.id, promptId), isNull(prompts.activeVersionId)));
        await tx.update(aiScenes).set({ promptId, updatedAt: new Date() })
          .where(and(eq(aiScenes.id, scene.id), isNull(aiScenes.promptId)));
      }
    };
    for (const scene of sceneSeeds) await ensureScenePrompt(scene.code);

    if (deepSeekModel) {
      await tx.update(aiScenes).set({ defaultModelId: deepSeekModel.id, updatedAt: new Date() })
        .where(and(eq(aiScenes.code, "general_chat"), isNull(aiScenes.defaultModelId)));
    }
  });

  console.info("基础数据初始化完成");
} finally {
  await client.end({ timeout: 5 });
}
