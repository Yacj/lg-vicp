import { describe, expect, it, vi } from "vitest";

// env 模块在导入链顶层解析环境变量，须先于被测模块完成注入
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

import { AiError, AI_ERROR_CODES } from "../../shared/ai-errors.js";
import { assertInsulationSystemForScene, isProfessionalScene } from "./ai.routes.js";
import { formatInsulationSystemContext } from "../../shared/prompt-assembly.js";
import { AI_SCENES } from "../../shared/constants.js";

/**
 * AI 会话保温体系守卫测试（P0-3）：
 * 专业场景（非 general_chat）在创建会话与发送专业消息前必须选择保温体系；
 * general_chat 不受影响；历史会话缺失体系时发送前提示补选。
 */

describe("isProfessionalScene", () => {
  it("general_chat 不是专业场景", () => {
    expect(isProfessionalScene(AI_SCENES.GENERAL_CHAT)).toBe(false);
  });

  it("project_design / material_compare / standard_qa / report_generate / information_extract 是专业场景", () => {
    for (const scene of [
      AI_SCENES.PROJECT_DESIGN,
      AI_SCENES.MATERIAL_COMPARE,
      AI_SCENES.STANDARD_QA,
      AI_SCENES.REPORT_GENERATE,
      AI_SCENES.INFORMATION_EXTRACT
    ]) {
      expect(isProfessionalScene(scene)).toBe(true);
    }
  });
});

describe("assertInsulationSystemForScene", () => {
  it("专业场景未选体系：拦截并返回 AI_INSULATION_SYSTEM_REQUIRED（400 语义）", () => {
    expect(() => assertInsulationSystemForScene(AI_SCENES.PROJECT_DESIGN, null)).toThrow(AiError);
    expect(() => assertInsulationSystemForScene(AI_SCENES.MATERIAL_COMPARE, undefined)).toThrow(AiError);
    try {
      assertInsulationSystemForScene(AI_SCENES.PROJECT_DESIGN, null);
    } catch (error) {
      expect((error as AiError).code).toBe(AI_ERROR_CODES.AI_INSULATION_SYSTEM_REQUIRED);
      expect((error as AiError).statusCode).toBe(400);
    }
  });

  it("专业场景已选体系：放行", () => {
    expect(() =>
      assertInsulationSystemForScene(AI_SCENES.MATERIAL_COMPARE, "a1b2c3d4-0000-4000-8000-000000000001")
    ).not.toThrow();
  });

  it("general_chat 未选体系：不拦截（不破坏纯闲聊）", () => {
    expect(() => assertInsulationSystemForScene(AI_SCENES.GENERAL_CHAT, null)).not.toThrow();
    expect(() => assertInsulationSystemForScene(AI_SCENES.GENERAL_CHAT, undefined)).not.toThrow();
  });
});

describe("formatInsulationSystemContext", () => {
  it("注入体系名称/编码/类型并声明不得虚构体系规则", () => {
    const context = formatInsulationSystemContext({
      name: "VICP薄抹灰外保温系统",
      code: "VICP-TMD",
      systemType: "外墙外保温"
    });
    expect(context).toContain("VICP薄抹灰外保温系统");
    expect(context).toContain("VICP-TMD");
    expect(context).toContain("外墙外保温");
    expect(context).toContain("不得自行编造体系规则");
  });

  it("编码/类型缺失时省略对应行", () => {
    const context = formatInsulationSystemContext({ name: "某体系", code: null, systemType: null });
    expect(context).not.toContain("编码：");
    expect(context).not.toContain("类型：");
  });
});
