import type { FastifyInstance } from "fastify";
import { aiRuleUsageLogs } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import type { PublishedComparisonRuleQuery } from "./comparison-read.service.js";
import { listPublishedComparisonRules } from "./comparison-read.service.js";

/**
 * 材料对比 AI 消费服务：
 * - loadApprovedComparisonRules：只读已发布且生效中的规则（状态门禁在 read service 内强制），
 *   按场景条件（竞品类别/维度）筛选，供 material_compare 场景对话注入 system prompt；
 * - formatComparisonRuleContext：把规则格式化为中文上下文（含证据来源/页码/等级、适用条件、必要披露）；
 * - logComparisonRuleUsage：回答引用规则时批量写入 ai_rule_usage_logs（含规则快照，历史不漂移）。
 * 数据不足（competitorValue 为空）的规则只输出 VICP 自身已验证表现，不生成对方负面结论；
 * forbiddenWording（禁止措辞）仅记录不参与输出。
 */

/** 场景条件：AI 对话按竞品类别/维度筛选已审核规则（缺省返回全部已发布规则） */
export interface ComparisonRuleContextQuery extends PublishedComparisonRuleQuery {
  limit?: number;
}

export async function loadApprovedComparisonRules(app: FastifyInstance, query: ComparisonRuleContextQuery = {}) {
  const rules = await listPublishedComparisonRules(app, query);
  return query.limit ? rules.slice(0, query.limit) : rules;
}

/** 材料描述（型号/密度/测试条件，防止混比） */
function materialLine(material: { category: string; name: string; model: string; density: number | null; densityUnit: string | null; testConditions: string | null }): string {
  const parts = [`${material.name}（${material.model}）`];
  if (material.density !== null) parts.push(`密度 ${material.density}${material.densityUnit ?? ""}`);
  if (material.testConditions?.trim()) parts.push(`测试条件：${material.testConditions}`);
  return parts.join("，");
}

/** 格式化已审核规则为中文上下文（AI 必须遵守，禁止自由编造对比数据） */
export function formatComparisonRuleContext(
  rules: Awaited<ReturnType<typeof loadApprovedComparisonRules>>
): string {
  if (rules.length === 0) return "";
  const lines = rules.map((rule, index) => {
    const dimension = rule.subIndicatorName ? `${rule.dimensionName}（${rule.subIndicatorName}）` : rule.dimensionName;
    const vicpLine = materialLine(rule.vicpMaterial);
    const competitorLine = materialLine(rule.competitorMaterial);
    const benchmark = rule.benchmarkDesc;
    const values = [
      `VICP（${vicpLine}）：${rule.vicpValue} ${rule.vicpUnit}`
    ];
    if (rule.competitorValue !== null) {
      values.push(`竞品（${competitorLine}）：${rule.competitorValue} ${rule.competitorUnit ?? ""}`);
    } else {
      values.push("竞品侧定量数据缺失：只陈述 VICP 自身已验证表现，不得生成对方负面结论");
    }
    const evidence = rule.evidence.map((e) =>
      `《${e.source}》${e.pageRef ? `第${e.pageRef}页` : ""}${e.clauseRef ? `条款${e.clauseRef}` : ""}（证据等级 ${e.evidenceLevel}，${e.side === "VICP" ? "VICP 侧" : "竞品侧"}）`
    ).join("；") || "无证据记录";
    return [
      `${index + 1}. 维度：${dimension}`,
      `   比较基准：${benchmark}`,
      `   数值：${values.join("；")}`,
      `   VICP 优势（须按此口径表述）：${rule.advantageText}`,
      `   适用条件（必须输出）：${rule.applicability}`,
      `   必要披露与风险提示（必须输出）：${rule.mandatoryDisclosure}`,
      `   证据：${evidence}`
    ].join("\n");
  });
  return [
    "【已审核材料对比规则（来源：材料对比规则库，必须遵守，禁止编造或推算对比数据）】",
    ...lines
  ].join("\n");
}

/** AI 回答引用规则时落库使用日志（含规则快照，审计可追溯且历史不漂移） */
export async function logComparisonRuleUsage(
  app: FastifyInstance,
  actor: AuthUser,
  input: {
    conversationId: string;
    messageId?: string | null;
    rules: Awaited<ReturnType<typeof loadApprovedComparisonRules>>;
  }
): Promise<void> {
  if (input.rules.length === 0) return;
  await app.db.insert(aiRuleUsageLogs).values(input.rules.map((rule) => ({
    conversationId: input.conversationId,
    messageId: input.messageId ?? null,
    ruleId: rule.id,
    ruleCode: rule.ruleCode,
    versionId: rule.versionId,
    ruleVersion: rule.ruleVersion,
    ruleSnapshot: {
      ruleId: rule.id,
      versionId: rule.versionId,
      versionCode: rule.ruleCode,
      ruleVersion: rule.ruleVersion,
      dimensionName: rule.dimensionName,
      subIndicatorName: rule.subIndicatorName,
      benchmarkType: rule.benchmarkType,
      benchmarkDesc: rule.benchmarkDesc,
      vicpValue: rule.vicpValue,
      vicpUnit: rule.vicpUnit,
      competitorValue: rule.competitorValue,
      competitorUnit: rule.competitorUnit,
      advantageText: rule.advantageText,
      applicability: rule.applicability,
      mandatoryDisclosure: rule.mandatoryDisclosure,
      usedBy: { userId: actor.id }
    }
  })));
}