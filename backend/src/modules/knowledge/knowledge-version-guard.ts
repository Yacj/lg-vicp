import { AppError } from "../../shared/errors.js";

/** 进入审核或发布流程后的知识版本都是审核快照，只允许通过新草稿继续修改。 */
export function assertKnowledgeVersionEditable(version: { status: string }): void {
  if (version.status !== "DRAFT") {
    throw new AppError(
      "KNOWLEDGE_VERSION_NOT_EDITABLE",
      "当前版本已进入审核/发布流程，如需修改请先回到草稿或创建新版本",
      409
    );
  }
}

export function isKnowledgeVersionEditable(status: string): boolean {
  return status === "DRAFT";
}
