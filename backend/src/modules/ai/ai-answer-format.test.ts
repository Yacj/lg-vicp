import { describe, expect, it } from "vitest";
import { formatUserVisibleAnswer } from "./ai-answer-format.js";

describe("用户可见正文 formatter", () => {
  it("清理 NUL、多余空行和相邻完全重复行", () => {
    const text = formatUserVisibleAnswer("结论。\u0000\n\n\n结论。\n\n结论。");
    expect(text).toBe("结论。");
  });

  it("去掉单独悬空的 markdown 标记，并补列表前空行", () => {
    const text = formatUserVisibleAnswer("结论如下\n- 关键点一\n**\n- 关键点二");
    expect(text).toContain("结论如下\n\n- 关键点一");
    expect(text).not.toMatch(/^\*\*$/m);
  });

  it("去掉半截开头残留，但不删除有语义的完整句", () => {
    const text = formatUserVisibleAnswer("与部位**\n外墙保温应设置抗裂防护层。");
    expect(text).toBe("外墙保温应设置抗裂防护层。");
    expect(formatUserVisibleAnswer("目前资料里还没有足够依据确定这一点。"))
      .toBe("目前资料里还没有足够依据确定这一点。");
  });
});
