import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

const USER_FACING_LEAK = /我会调用|我将调用|我会检索|我会查询|我不会编造|我不会杜撰|Tool Result|citationAnchor|thermalResult/;

describe("Execution Policy 与 Global Response Policy", () => {
  it("执行规范禁止把内部动作说成用户回答", async () => {
    const { EXECUTION_POLICY } = await import("./ai-execution-policy.js");
    expect(EXECUTION_POLICY).toContain("【执行规范】");
    expect(EXECUTION_POLICY).toContain("禁止改写成对用户说的执行计划");
    expect(EXECUTION_POLICY).toContain("我会检索");
    expect(EXECUTION_POLICY).toContain("优先使用检索能力");
  });

  it("全局回答规则要求结论优先且不描述执行过程", async () => {
    const { GLOBAL_RESPONSE_POLICY, HARD_RESPONSE_CONSTRAINTS } = await import("./ai-response-policy.js");
    expect(GLOBAL_RESPONSE_POLICY).toContain("直接回答当前问题");
    expect(GLOBAL_RESPONSE_POLICY).toContain("不描述准备做什么或内部执行过程");
    expect(GLOBAL_RESPONSE_POLICY).toContain("不重复上一轮已完整回答的内容");
    expect(GLOBAL_RESPONSE_POLICY).toContain("不要把项目级计算所需条件当成参考查询的前置条件");
    expect(HARD_RESPONSE_CONSTRAINTS).toContain("不得向用户暴露内部工具名");
    expect(HARD_RESPONSE_CONSTRAINTS).toContain("不得伪造来源");
    expect(GLOBAL_RESPONSE_POLICY.split("\n").filter((line) => /^\d+\./.test(line)).length).toBeLessThanOrEqual(11);
  });
});

describe("回答链路回归：系统味隔离", () => {
  it("1. 问 VICP 是什么时，用户可见层不引导回答“我会检索”", async () => {
    const { GLOBAL_RESPONSE_POLICY } = await import("./ai-response-policy.js");
    const { DEFAULT_BUSINESS_PROMPT_CONTENT } = await import("../modules/ai-config/ai-business-prompt.catalog.js");
    const userFacing = [
      GLOBAL_RESPONSE_POLICY,
      DEFAULT_BUSINESS_PROMPT_CONTENT.BASE_CHAT,
      DEFAULT_BUSINESS_PROMPT_CONTENT.PRODUCT_CONSULTATION
    ].join("\n");
    expect(userFacing).not.toMatch(/我会检索|我将调用|我可以帮你查/);
  });

  it("2. 问 VICP 优势时，产品咨询 Prompt 要求直接给结论", async () => {
    const { DEFAULT_BUSINESS_PROMPT_CONTENT } = await import("../modules/ai-config/ai-business-prompt.catalog.js");
    expect(DEFAULT_BUSINESS_PROMPT_CONTENT.PRODUCT_CONSULTATION).toContain("直接给结论");
    expect(DEFAULT_BUSINESS_PROMPT_CONTENT.PRODUCT_CONSULTATION).not.toContain("我可以帮你查产品资料");
  });

  it("3. 上一轮已对比后追问价格，只回答价格相关新信息", async () => {
    const { GLOBAL_RESPONSE_POLICY, PREVIOUS_TURN_DEDUPE_HINT, USER_LANGUAGE_NOTES } = await import("./ai-response-policy.js");
    expect(GLOBAL_RESPONSE_POLICY).toContain("不重复上一轮已完整回答的内容");
    expect(PREVIOUS_TURN_DEDUPE_HINT).toContain("不要重写上一轮");
    expect(USER_LANGUAGE_NOTES.missingPrice).toContain("价格");
    expect(USER_LANGUAGE_NOTES.missingPrice).not.toMatch(USER_FACING_LEAK);
  });

  it("4. 项目上下文静默使用，不要求复述项目资料", async () => {
    const { wrapContextForReasoning } = await import("./ai-response-policy.js");
    const { buildSystemMessages } = await import("./prompt-assembly.js");
    const wrapped = wrapContextForReasoning("项目上下文", "项目位于合肥，公共建筑，预算敏感");
    expect(wrapped).toContain("仅供判断，默认不要复述");
    const messages = buildSystemMessages({
      scenePrompt: "业务关注点",
      projectContext: "项目位于合肥"
    });
    expect(messages.some((item) => item.content.includes("项目位于合肥"))).toBe(true);
    expect(messages.some((item) => item.content.includes("默认不要复述"))).toBe(true);
  });

  it("5. 产品资料不足使用用户语言，不解释工具或知识库机制", async () => {
    const { formatKnowledgeContext } = await import("../modules/knowledge/knowledge.service.js");
    const empty = formatKnowledgeContext([]);
    expect(empty).toContain("缺少什么、暂时不能确定什么");
    expect(empty).not.toMatch(/知识库中未检索到|Tool Result|根据安全规则/);
  });

  it("6. 来源可以展示，仍禁止思考链和检索过程", async () => {
    const { GLOBAL_RESPONSE_POLICY, HARD_RESPONSE_CONSTRAINTS } = await import("./ai-response-policy.js");
    expect(GLOBAL_RESPONSE_POLICY).toContain("来源可以展示，但不解释检索过程");
    expect(HARD_RESPONSE_CONSTRAINTS).toContain("思考链");
  });

  it("7. 热工未接入使用用户语言，不暴露 internal state", async () => {
    const { USER_LANGUAGE_NOTES } = await import("./ai-response-policy.js");
    const { emptyThermalState, buildProductComparisonDimensions } = await import("../modules/ai/compare-product.js");
    expect(USER_LANGUAGE_NOTES.missingThermal).toContain("暂时不参与比较");
    expect(USER_LANGUAGE_NOTES.missingThermal).not.toMatch(/thermalResult|NOT_AVAILABLE/);
    const built = buildProductComparisonDimensions({
      products: [
        { id: "a", name: "VICP", status: "ACTIVE" },
        { id: "b", name: "岩棉", status: "ACTIVE" }
      ],
      focus: ["热工"],
      thermal: emptyThermalState()
    });
    expect(built.missingNotes.join("")).toContain("暂时不参与比较");
    expect(built.missingNotes.join("")).not.toContain("thermalResult");
  });

  it("8. 报告确认后不在聊天里重复整段历史", async () => {
    const { DEFAULT_BUSINESS_PROMPT_CONTENT } = await import("../modules/ai-config/ai-business-prompt.catalog.js");
    const { USER_LANGUAGE_NOTES } = await import("./ai-response-policy.js");
    const { normalizeReportForModel } = await import("../modules/ai/tools/tool-result-normalizer.js");
    expect(DEFAULT_BUSINESS_PROMPT_CONTENT.REPORT_GENERATION).toContain("不要复述");
    expect(USER_LANGUAGE_NOTES.reportCreated).toContain("具体内容进入报告");
    const output = normalizeReportForModel({ created: true, selectedNames: ["VICP", "产品A"] });
    expect(output.instruction).toContain("具体内容进入报告");
    expect(output.selectedNames).toEqual(["VICP", "产品A"]);
  });
});

describe("业务 Prompt 不再重复回答风格", () => {
  it("用户可见业务 Prompt 不含“我会调用/我不会编造”", async () => {
    const { DEFAULT_BUSINESS_PROMPT_CONTENT } = await import("../modules/ai-config/ai-business-prompt.catalog.js");
    for (const content of Object.values(DEFAULT_BUSINESS_PROMPT_CONTENT)) {
      expect(content).not.toMatch(USER_FACING_LEAK);
    }
  });
});
