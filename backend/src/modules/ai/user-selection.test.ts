import { describe, expect, it } from "vitest";
import {
  autoSelectWhenSingleOption,
  buildUserSelectionRequest,
  collectResumeSelectedIds,
  validateUserSelection,
  UserSelectionError
} from "./user-selection.js";

describe("USER_SELECTION 统一协议", () => {
  const knowledgeRequest = buildUserSelectionRequest({
    selectionKind: "KNOWLEDGE_SOURCE",
    title: "请选择资料来源",
    options: [
      { id: "a1", title: "图集A" },
      { id: "a2", title: "图集B" },
      { id: "a3", title: "图集C" }
    ],
    multiple: true,
    minSelections: 1,
    autoSelectWhenSingle: true
  });

  it("selectedIds 必须属于 options", () => {
    expect(() => validateUserSelection(knowledgeRequest, { selectedIds: ["missing"] }))
      .toThrow(UserSelectionError);
    const ok = validateUserSelection(knowledgeRequest, { selectedIds: ["a2"] });
    expect(ok.selectedIds).toEqual(["a2"]);
  });

  it("数量满足 min/max", () => {
    expect(() => validateUserSelection(knowledgeRequest, { selectedIds: [] }))
      .toThrow(/至少/);
    const two = validateUserSelection(knowledgeRequest, { optionIds: ["a1", "a3"] });
    expect(two.selectedIds).toEqual(["a1", "a3"]);
  });

  it("兼容旧 optionId / optionIds", () => {
    expect(collectResumeSelectedIds({ optionId: "a1", optionIds: ["a2"] })).toEqual(["a2", "a1"]);
    const selected = validateUserSelection(knowledgeRequest, { optionId: "a1", optionIds: ["a2"] });
    expect(selected.selectedIds).toEqual(["a2", "a1"]);
  });

  it("单选项且 autoSelectWhenSingle 时自动选中", () => {
    const single = buildUserSelectionRequest({
      selectionKind: "KNOWLEDGE_SOURCE",
      title: "来源",
      options: [{ id: "only", title: "唯一图集" }],
      multiple: true,
      minSelections: 1,
      autoSelectWhenSingle: true
    });
    expect(autoSelectWhenSingleOption(single)).toEqual(["only"]);
  });
});
