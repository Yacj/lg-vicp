import { describe, expect, it } from "vitest";
import {
  mergeConversationTaskState,
  parseConversationTaskState,
  resolveConversationTask
} from "./conversation-task.js";

describe("ConversationTaskState 解析", () => {
  it("缺省为 GENERAL，不是 Agent 类型", () => {
    expect(parseConversationTaskState(null).taskType).toBe("GENERAL");
    expect(parseConversationTaskState({ taskType: "COMPARISON_AGENT" }).taskType).toBe("GENERAL");
  });
});

describe("任务判定优先级", () => {
  it("UI 确认生成报告优先于模型和当前状态", () => {
    const decision = resolveConversationTask({
      uiAction: "GENERATE_REPORT",
      currentState: { taskType: "COMPARISON" },
      message: "其实我想继续问问热工",
      selectedProductIds: ["p1", "p2"]
    });
    expect(decision.source).toBe("UI_ACTION");
    expect(decision.generateReportNow).toBe(true);
    expect(decision.skipToolLoop).toBe(true);
    expect(decision.state.taskType).toBe("REPORT_GENERATION");
    expect(decision.state.selectedProductIds).toEqual(["p1", "p2"]);
  });

  it("用户勾选产品直接写入 selectedProductIds", () => {
    const decision = resolveConversationTask({
      uiAction: "SELECT_PRODUCTS",
      optionIds: ["a", "b", "a"],
      currentState: { taskType: "GENERAL" }
    });
    expect(decision.source).toBe("UI_ACTION");
    expect(decision.generateReportNow).toBe(false);
    expect(decision.state.selectedProductIds).toEqual(["a", "b"]);
    expect(decision.state.taskType).toBe("COMPARISON");
  });

  it("当前 COMPARISON 状态优先于自然语言猜测", () => {
    const decision = resolveConversationTask({
      currentState: { taskType: "COMPARISON", selectedProductIds: ["p1", "p2"] },
      message: "你好"
    });
    expect(decision.source).toBe("TASK_STATE");
    expect(decision.state.taskType).toBe("COMPARISON");
    expect(decision.skipToolLoop).toBe(false);
  });

  it("自然语言对比才进入 COMPARISON", () => {
    const decision = resolveConversationTask({
      message: "VICP 和岩棉有什么区别？"
    });
    expect(decision.source).toBe("INTENT");
    expect(decision.state.taskType).toBe("COMPARISON");
    expect(decision.generateReportNow).toBe(false);
  });

  it("简单问候不进 Tool Loop", () => {
    const decision = resolveConversationTask({ message: "你好" });
    expect(decision.skipToolLoop).toBe(true);
    expect(decision.state.taskType).toBe("GENERAL");
  });

  it("单产品咨询进入 PRODUCT_CONSULTATION", () => {
    const decision = resolveConversationTask({ message: "VICP有什么优势？" });
    expect(decision.state.taskType).toBe("PRODUCT_CONSULTATION");
  });
});

describe("任务上下文静默使用", () => {
  it("不向模型复述任务类型码或快照内部 ID", async () => {
    const { formatConversationTaskContext } = await import("./conversation-task.js");
    const text = formatConversationTaskContext({
      taskType: "COMPARISON",
      userGoal: "对比 VICP 和岩棉",
      selectedProductIds: ["p1", "p2"],
      reportContextSnapshotId: "snap-secret"
    });
    expect(text).toContain("对比 VICP 和岩棉");
    expect(text).toContain("仅供判断");
    expect(text).not.toContain("COMPARISON");
    expect(text).not.toContain("snap-secret");
  });

  it("GENERAL 任务下仍注入上一轮参考档位", async () => {
    const { formatConversationTaskContext } = await import("./conversation-task.js");
    const text = formatConversationTaskContext({
      taskType: "GENERAL",
      lastReferenceLookup: {
        query: { targetK: 0.3, systemHint: "薄抹灰" },
        candidates: [{ id: "row-1", specClass: "II", kValue: 0.294, thicknessMm: 55, evidenceSource: "保温图集" }],
        createdAt: "2026-09-21T00:00:00.000Z"
      }
    });
    expect(text).toContain("已查询的参考档位");
    expect(text).toContain("0.294");
    expect(text).toContain("优先于知识检索片段");
  });
});

describe("USER_SELECTION 任务对接", () => {
  it("报告类型确认写入 selectedReportType 并直接生成", () => {
    const decision = resolveConversationTask({
      waitingType: "USER_SELECTION",
      selectionKind: "REPORT_TYPE",
      selectedIds: ["technical_scheme"],
      currentState: { taskType: "GENERAL" }
    });
    expect(decision.generateReportNow).toBe(true);
    expect(decision.state.selectedReportType).toBe("technical_scheme");
  });

  it("图集来源确认写入 confirmedKnowledgeSourceIds，不触发生成报告", () => {
    const decision = resolveConversationTask({
      waitingType: "USER_SELECTION",
      selectionKind: "KNOWLEDGE_SOURCE",
      selectedIds: ["d1", "d2"],
      currentState: { taskType: "GENERAL" }
    });
    expect(decision.generateReportNow).toBe(false);
    expect(decision.state.confirmedKnowledgeSourceIds).toEqual(["d1", "d2"]);
  });
});

describe("任务状态合并", () => {
  it("保留已确认产品选择", () => {
    const merged = mergeConversationTaskState(
      { taskType: "COMPARISON", selectedProductIds: ["p1"] },
      { selectedProductIds: ["p1", "p2", "p3"] }
    );
    expect(merged.selectedProductIds).toEqual(["p1", "p2", "p3"]);
    expect(merged.taskType).toBe("COMPARISON");
  });

  it("保留上一轮参考档位查询", () => {
    const lookup = {
      query: { targetK: 0.3, systemHint: "薄抹灰" },
      candidates: [{ id: "row-1", specClass: "II" as const, kValue: 0.294, thicknessMm: 55 }],
      createdAt: "2026-09-21T00:00:00.000Z"
    };
    const parsed = parseConversationTaskState({ lastReferenceLookup: lookup });
    expect(parsed.lastReferenceLookup?.candidates[0]?.kValue).toBe(0.294);
    const merged = mergeConversationTaskState(
      { taskType: "GENERAL", lastReferenceLookup: lookup },
      { userGoal: "查 0.3 方案" }
    );
    expect(merged.lastReferenceLookup?.candidates).toHaveLength(1);
    expect(merged.userGoal).toBe("查 0.3 方案");
  });
});
