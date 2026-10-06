import { describe, expect, it } from "vitest";
import {
  candidatesFromHits,
  resolveKnowledgeSourceDecision,
  shouldForceReselectKnowledgeSource,
  sourceClassChanged
} from "./knowledge-source-selection.js";

const atlas = (id: string, title: string) => ({
  id, title, kind: "atlas" as const, description: "图集"
});

describe("图集/知识来源选择", () => {
  it("0 个候选不进入选择 UI", () => {
    const decision = resolveKnowledgeSourceDecision({ candidates: [] });
    expect(decision.action).toBe("NONE");
    expect(decision.selectedIds).toEqual([]);
  });

  it("1 个候选自动选中，不打断用户", () => {
    const decision = resolveKnowledgeSourceDecision({ candidates: [atlas("d1", "苏 J/T15")] });
    expect(decision).toMatchObject({ action: "AUTO", selectedIds: ["d1"] });
  });

  it("2 个候选进入多选 USER_SELECTION", () => {
    const decision = resolveKnowledgeSourceDecision({
      candidates: [atlas("d1", "A"), atlas("d2", "B")]
    });
    expect(decision.action).toBe("WAIT");
    if (decision.action === "WAIT") {
      expect(decision.request.selectionKind).toBe("KNOWLEDGE_SOURCE");
      expect(decision.request.multiple).toBe(true);
      expect(decision.request.minSelections).toBe(1);
      expect(decision.request.autoSelectWhenSingle).toBe(true);
      expect(decision.request.options).toHaveLength(2);
    }
  });

  it("3 个候选仍为多选", () => {
    const decision = resolveKnowledgeSourceDecision({
      candidates: [atlas("d1", "A"), atlas("d2", "B"), atlas("d3", "C")]
    });
    expect(decision.action).toBe("WAIT");
    if (decision.action === "WAIT") {
      expect(decision.request.options.map((item) => item.id)).toEqual(["d1", "d2", "d3"]);
    }
  });

  it("已确认来源仍有效时复用，不重新弹", () => {
    const decision = resolveKnowledgeSourceDecision({
      candidates: [atlas("d1", "A"), atlas("d2", "B"), atlas("d3", "C")],
      confirmedIds: ["d1", "d3"],
      confirmedKind: "atlas",
      neededKind: "atlas",
      previousCandidateIds: ["d1", "d2", "d3"]
    });
    expect(decision).toMatchObject({ action: "REUSE", selectedIds: ["d1", "d3"] });
  });

  it("用户主动更换来源时重新进入选择", () => {
    expect(shouldForceReselectKnowledgeSource("换一个图集")).toBe(true);
    const decision = resolveKnowledgeSourceDecision({
      candidates: [atlas("d1", "A"), atlas("d2", "B")],
      confirmedIds: ["d1"],
      forceReselect: true
    });
    expect(decision.action).toBe("WAIT");
  });

  it("来源失效或候选显著变化时重新选择", () => {
    const invalid = resolveKnowledgeSourceDecision({
      candidates: [atlas("x1", "新图集"), atlas("x2", "另一本")],
      confirmedIds: ["old"],
      previousCandidateIds: ["old"]
    });
    expect(invalid.action).toBe("WAIT");
  });

  it("从检索命中去重文档，且与保温体系无关", () => {
    const candidates = candidatesFromHits([
      { documentId: "d1", sourceTitle: "图集A", docType: "DETAIL_ATLAS" },
      { documentId: "d1", sourceTitle: "图集A", docType: "DETAIL_ATLAS" },
      { documentId: "d2", sourceTitle: "标准B", docType: "STANDARD" }
    ]);
    expect(candidates.map((item) => item.id)).toEqual(["d1", "d2"]);
    expect(candidates[0]?.kind).toBe("atlas");
    expect(candidates[1]?.kind).toBe("standard");
    expect(sourceClassChanged("atlas", "standard")).toBe(true);
    expect(sourceClassChanged("atlas", "approved_document")).toBe(false);
  });
});
