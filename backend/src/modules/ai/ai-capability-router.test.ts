import { describe, expect, it } from "vitest";
import { resolveAiCapabilities } from "./ai-capability-router.js";

describe("resolveAiCapabilities", () => {
  it("寒暄不触发任何能力", () => {
    expect(resolveAiCapabilities({ message: "你好" })).toMatchObject({
      needKnowledgeSearch: false,
      needProjectContext: false,
      needThermalTool: false
    });
  });

  it("自由输入不要求 quickPromptId / scene，图集问题自动检索知识", () => {
    const result = resolveAiCapabilities({ message: "VICP窗洞口怎么做？" });
    expect(result.needKnowledgeSearch).toBe(true);
    expect(result.explicitKnowledgeRequest).toBe(false);
  });

  it("明确要求根据图集/标准时标记 explicitKnowledgeRequest", () => {
    expect(resolveAiCapabilities({ message: "请根据图集查询窗洞口做法" }).explicitKnowledgeRequest).toBe(true);
    expect(resolveAiCapabilities({ message: "系统资料里节能标准怎么规定的" }).explicitKnowledgeRequest).toBe(true);
    expect(resolveAiCapabilities({
      message: "请根据当前已发布的知识资料，帮助我查询与问题相关的图集内容，并给出对应章节、页码和原文来源。"
    })).toMatchObject({
      needKnowledgeSearch: true,
      explicitKnowledgeRequest: true
    });
  });

  it("有 projectId 时注入项目上下文，但仍可同时检索知识", () => {
    const result = resolveAiCapabilities({
      message: "VICP窗洞口怎么做？",
      projectId: "proj-1"
    });
    expect(result.needKnowledgeSearch).toBe(true);
    expect(result.needProjectContext).toBe(true);
  });

  it("提到当前项目但没有 projectId 时不注入项目上下文（无项目不等于 AI 不可用）", () => {
    expect(resolveAiCapabilities({ message: "分析当前项目的保温方案" }).needProjectContext).toBe(false);
  });

  it("热工 / 对比 / 报告关键词分别触发对应能力", () => {
    expect(resolveAiCapabilities({ message: "帮我算一下传热系数 K 值" }).needThermalTool).toBe(true);
    expect(resolveAiCapabilities({ message: "VICP 和岩棉怎么对比" }).needComparisonTool).toBe(true);
    expect(resolveAiCapabilities({ message: "帮我生成报告" }).needReportContext).toBe(true);
  });
});
