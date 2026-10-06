import { describe, expect, it } from "vitest";
import { isTerminalReportAttempt } from "./report-job-state.js";

describe("报告 BullMQ 重试对用户透明", () => {
  it("中间 attempt 不是终态失败", () => {
    expect(isTerminalReportAttempt({ attemptsMade: 0, opts: { attempts: 3 } })).toBe(false);
    expect(isTerminalReportAttempt({ attemptsMade: 1, opts: { attempts: 3 } })).toBe(false);
  });

  it("最后一次 attempt 才视为 FAILED", () => {
    expect(isTerminalReportAttempt({ attemptsMade: 2, opts: { attempts: 3 } })).toBe(true);
  });
});
