import { describe, expect, it } from "vitest";
import { findFirstContentHit, matchContentFilter, type ContentFilterRow } from "./ai-content-filter.service.js";

function makeFilter(overrides: Partial<ContentFilterRow> = {}): ContentFilterRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    keyword: "游戏",
    matchType: "CONTAINS",
    sceneCodes: null,
    hitMessage: null,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

describe("matchContentFilter", () => {
  it("CONTAINS 命中包含的关键词", () => {
    expect(matchContentFilter("我想玩游戏", makeFilter())).toBe("游戏");
  });

  it("CONTAINS 未命中返回 null", () => {
    expect(matchContentFilter("我想看建筑规范", makeFilter())).toBeNull();
  });

  it("空内容或空关键词返回 null", () => {
    expect(matchContentFilter("", makeFilter())).toBeNull();
    expect(matchContentFilter("内容", makeFilter({ keyword: "" }))).toBeNull();
  });

  it("REGEX 命中正则表达式", () => {
    const filter = makeFilter({ keyword: "违规(内容|消息)\\d+", matchType: "REGEX" });
    expect(matchContentFilter("违规内容123", filter)).toBe("违规内容123");
    expect(matchContentFilter("这条违规消息42", filter)).toBe("违规消息42");
    expect(matchContentFilter("违规", filter)).toBeNull();
  });

  it("REGEX 对英文大小写不敏感", () => {
    const filter = makeFilter({ keyword: "\\bgame\\b", matchType: "REGEX" });
    expect(matchContentFilter("GAME 攻略", filter)).toBe("GAME");
  });

  it("非法正则返回 null 而不是抛错", () => {
    const filter = makeFilter({ keyword: "([", matchType: "REGEX" });
    expect(matchContentFilter("任意内容", filter)).toBeNull();
  });
});

describe("findFirstContentHit", () => {
  const filters: ContentFilterRow[] = [
    makeFilter({ id: "00000000-0000-0000-0000-000000000001", keyword: "游戏" }),
    makeFilter({ id: "00000000-0000-0000-0000-000000000002", keyword: "赌博", matchType: "REGEX", sceneCodes: ["general_chat"] }),
    makeFilter({ id: "00000000-0000-0000-0000-000000000003", keyword: "黄色", enabled: false })
  ];

  it("返回第一个命中的词条", () => {
    const hit = findFirstContentHit("聊聊游戏和赌博", "general_chat", filters);
    expect(hit).not.toBeNull();
    expect(hit!.keyword).toBe("游戏");
  });

  it("sceneCodes 限定场景：其他场景不命中", () => {
    const hit = findFirstContentHit("聊聊赌博", "standard_qa", filters);
    expect(hit).toBeNull();
  });

  it("sceneCodes 为空数组表示全局生效", () => {
    const hit = findFirstContentHit("聊聊游戏", "standard_qa", [makeFilter({ sceneCodes: [] })]);
    expect(hit).not.toBeNull();
  });

  it("禁用的词条不参与匹配", () => {
    const hit = findFirstContentHit("黄色内容", "general_chat", filters);
    expect(hit).toBeNull();
  });

  it("未命中返回 null", () => {
    expect(findFirstContentHit("建筑节能设计", "general_chat", filters)).toBeNull();
  });

  it("命中时携带自定义提示语", () => {
    const hit = findFirstContentHit("游戏", "general_chat", [makeFilter({ hitMessage: "当前话题不在服务范围" })]);
    expect(hit?.hitMessage).toBe("当前话题不在服务范围");
  });
});