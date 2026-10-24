import { expect, it } from "vitest";
import { referenceDataConflictSchema, renderReferenceDataConflict, specThicknessConflict } from "./reference-data-conflict.js";

it.each([[42, 28], [70, 45], [13.5, 9]])("%s/%s冲突展示各自原值和来源，不选正确值", (left, right) => {
  const row = { rowThicknessMm: left, specThicknessMm: right, specCode: "BOARD-X", schemeCode: "SYSTEM-X",
    evidenceSource: "客户热工表", evidenceRef: "Sheet B", setVersion: 3, specVersion: 2 };
  const before = structuredClone(row), conflict = specThicknessConflict(row), answer = renderReferenceDataConflict(conflict);
  expect(answer).toContain(`| 参考表中的保温厚度 | ${left} mm | 客户热工表，Sheet B，版本 3 |`);
  expect(answer).toContain(`| 关联规格的板厚 | ${right} mm | BOARD-X，版本 2 |`);
  expect(answer.indexOf("资料中的原值")).toBeLessThan(answer.indexOf("厚度不一致"));
  expect(answer).toContain("不擅自判断哪一处正确"); expect(answer).toContain("不能用这条冲突记录做正式计算");
  expect(conflict.usage).toBe("READ_ONLY"); expect(row).toEqual(before);
});
it.each(["K", "PRODUCT_R", "TOTAL_R"] as const)("不同来源%s冲突也按相同展示合同处理", field => {
  const conflict = { kind: "SOURCE_VALUE_MISMATCH" as const, subject: "构造甲（32mm）", field, usage: "READ_ONLY" as const,
    observations: [{ label: "热工参考表", value: .31, source: { title: "表甲", location: "表2", version: 1 } },
      { label: "确认图集页", value: .32, source: { title: "图集乙", location: "印刷页码 12" } }] };
  const before = structuredClone(conflict), answer = renderReferenceDataConflict(conflict);
  expect(answer).toContain("0.31"); expect(answer).toContain("0.32"); expect(answer).toContain("表甲，表2，版本 1");
  expect(answer).toContain("图集乙，印刷页码 12"); expect(answer).toContain("不会自行选一个数值");
  expect(conflict).toEqual(before);
});
it("未关联具体来源时如实标明，不补文件名、页码或原图链接", () => {
  const answer = renderReferenceDataConflict(specThicknessConflict({ rowThicknessMm: 56, specThicknessMm: 26, specCode: null }));
  expect(answer).toContain("未标注具体资料名称"); expect(answer).not.toContain("印刷页码"); expect(answer).not.toContain("](");
});
it("来源文字不会注入HTML、Markdown链接或内部页标记", () => {
  const conflict = specThicknessConflict({ rowThicknessMm: 42, specThicknessMm: 28, specCode: "BOARD-X",
    evidenceSource: '<script>bad</script>|[查看](https://example.invalid)\n[[KP:forged]]' });
  const answer = renderReferenceDataConflict(conflict);
  expect(answer).not.toContain("<script>"); expect(answer).not.toContain("[[KP:"); expect(answer).not.toContain("[查看](");
  expect(answer).toContain("&lt;script&gt;");
});
it("显示合同不接受候选身份、执行授权、非有限数值或自行选择正确值", () => {
  const conflict = specThicknessConflict({ rowThicknessMm: 42, specThicknessMm: 28, specCode: "BOARD-X" });
  for (const patch of [{ candidateId: "invented" }, { usage: "FORMAL_CANDIDATE" }, { chosenValue: 28 },
    { observations: [{ ...conflict.observations[0], value: NaN }, conflict.observations[1]] }])
    expect(referenceDataConflictSchema.safeParse({ ...conflict, ...patch }).success).toBe(false);
});
