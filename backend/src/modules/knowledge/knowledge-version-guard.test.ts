import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/errors.js";
import { assertKnowledgeVersionEditable, isKnowledgeVersionEditable } from "./knowledge-version-guard.js";

describe("assertKnowledgeVersionEditable", () => {
  it("allows draft versions only", () => {
    expect(() => assertKnowledgeVersionEditable({ status: "DRAFT" })).not.toThrow();
    expect(isKnowledgeVersionEditable("DRAFT")).toBe(true);
    for (const status of ["PENDING_REVIEW", "APPROVED", "PUBLISHED", "DISABLED"]) {
      expect(() => assertKnowledgeVersionEditable({ status })).toThrowError(
        expect.objectContaining({ code: "KNOWLEDGE_VERSION_NOT_EDITABLE", statusCode: 409 })
      );
      expect(isKnowledgeVersionEditable(status)).toBe(false);
    }
  });

  it("rejects review and published versions with the same conflict", () => {
    expect(() => assertKnowledgeVersionEditable({ status: "PUBLISHED" })).toThrowError(
      expect.objectContaining({
        code: "KNOWLEDGE_VERSION_NOT_EDITABLE",
        statusCode: 409,
        message: "当前版本已进入审核/发布流程，如需修改请先回到草稿或创建新版本"
      })
    );
  });
});
