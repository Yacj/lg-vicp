import "dotenv/config"; // 必须在导入服务前加载 env（服务顶层引用 env 配置）
import { describe, expect, it } from "vitest";
import {
  applyExtractRules,
  buildPagedUrl,
  decodeHtml,
  DEFAULT_EXTRACT_RULES,
  extractKValueIndicators,
  extractLinks,
  extractPdfLink,
  filterListItems,
  filterToday,
  mapStandardStatus,
  resolveUrl
} from "./standard-crawl.service.js";

const LIST_HTML = `
<html><body>
  <div class="list">
    <a href="/std/2023/db50-001.html">关于发布《DBJ50/T-428-2023 居住建筑节能设计标准》的通知</a>
    <a href="/std/2023/db50-002.html">DBJ50/T-429-2023 公共建筑节能设计标准</a>
    <a href="javascript:void(0)">无效链接</a>
    <a href="#anchor">锚点</a>
    <a href="/pdf/notice.pdf">附件：标准文本</a>
    <a href="mailto:std@example.gov.cn">联系</a>
  </div>
</body></html>`;

describe("列表链接解析", () => {
  it("提取有效链接并过滤锚点/脚本/邮件", () => {
    const links = extractLinks(LIST_HTML);
    expect(links).toHaveLength(3);
    expect(links[0]).toEqual({ href: "/std/2023/db50-001.html", text: "关于发布《DBJ50/T-428-2023 居住建筑节能设计标准》的通知" });
    expect(links.map((l) => l.href)).not.toContain("#anchor");
  });

  it("相对链接解析为绝对 URL", () => {
    expect(resolveUrl("https://std.example.gov.cn/list/", "/std/a.html")).toBe("https://std.example.gov.cn/std/a.html");
    expect(resolveUrl("https://std.example.gov.cn/list/", "b.html")).toBe("https://std.example.gov.cn/list/b.html");
    expect(resolveUrl("https://std.example.gov.cn/list/", "http://[invalid")).toBeNull();
  });

  it("url 翻页参数：已存在参数替换，不存在追加", () => {
    expect(buildPagedUrl("https://std.example.gov.cn/list?page=2&size=10", "page", 3)).toBe(
      "https://std.example.gov.cn/list?page=3&size=10"
    );
    expect(buildPagedUrl("https://std.example.gov.cn/list", "page", 2)).toBe(
      "https://std.example.gov.cn/list?page=2"
    );
  });
});

describe("列表项关键字过滤", () => {
  const items = [
    { href: "/a", text: "DBJ50/T-428-2023 居住建筑节能设计标准" },
    { href: "/b", text: "DBJ50/T-429-2023 公共建筑节能设计标准" },
    { href: "/c", text: "关于征集绿色建筑评价标准的通知" }
  ];

  it("titleKeywords 命中任一保留，excludeKeywords 剔除", () => {
    const filtered = filterListItems(items, { titleKeywords: ["节能"], excludeKeywords: ["征集"] });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((i) => i.href)).toEqual(["/a", "/b"]);
  });

  it("空配置不过滤", () => {
    expect(filterListItems(items, { titleKeywords: [], excludeKeywords: [] })).toHaveLength(3);
  });
});

describe("当天发布过滤", () => {
  const now = new Date("2026-03-14T08:00:00Z");

  it("含今天日期的保留，历史日期剔除，无日期保留", () => {
    const items = [
      { href: "/a", text: "2026年3月14日 发布通知" },
      { href: "/b", text: "2026-02-10 发布通知" },
      { href: "/c", text: "某标准公告" }
    ];
    const filtered = filterToday(items, now);
    expect(filtered.map((i) => i.href)).toEqual(["/a", "/c"]);
  });
});

describe("提取规则引擎", () => {
  it("按规则提取首个匹配（捕获组优先）", () => {
    const html = "编号：DBJ50/T-428-2023，发布日期 2023-05-01";
    const result = applyExtractRules(html, [
      { field: "documentNo", pattern: "\\bDBJ?\\s*\\d{1,3}\\s*/\\s*T?\\s*-?\\s*\\d{1,4}(?:\\s*-\\s*\\d{4})?\\b" },
      { field: "publishDate", pattern: "((?:20\\d{2})-(?:\\d{1,2})-(?:\\d{1,2}))" }
    ]);
    expect(result.documentNo).toBe("DBJ50/T-428-2023");
    expect(result.publishDate).toBe("2023-05-01");
  });

  it("非法正则跳过该字段不影响其他规则", () => {
    const result = applyExtractRules("编号：DBJ50/T-428-2023", [
      { field: "bad", pattern: "([" },
      { field: "documentNo", pattern: "(DBJ[\\d/T-]+)" }
    ]);
    expect(result.bad).toBeUndefined();
    expect(result.documentNo).toBe("DBJ50/T-428-2023");
  });

  it("默认规则从详情页提取编号与标题", () => {
    const html = `<html><head><title>DBJ50/T-428-2023 居住建筑节能设计标准</title></head>
      <body>本标准编号 DBJ50/T-428-2023，于 2023 年 5 月 1 日发布。</body></html>`;
    const result = applyExtractRules(html, DEFAULT_EXTRACT_RULES);
    expect(result.documentNo).toBe("DBJ50/T-428-2023");
    expect(result.title).toContain("DBJ50/T-428-2023");
  });
});

describe("标准状态映射", () => {
  it("征求意见 → DRAFT_CONSULTATION", () => {
    expect(mapStandardStatus("《xx标准》公开征求意见")).toBe("DRAFT_CONSULTATION");
  });
  it("废止 → REPEALED", () => {
    expect(mapStandardStatus("关于废止《DBJ50/T-100-2018》的公告")).toBe("REPEALED");
  });
  it("替代 → SUPERSEDED", () => {
    expect(mapStandardStatus("本标准自2026年1月1日起被《DBJ50/T-428-2023》替代")).toBe("SUPERSEDED");
  });
  it("默认 → OFFICIAL", () => {
    expect(mapStandardStatus("关于发布地方标准的通知")).toBe("OFFICIAL");
  });
});

describe("K 值指标提取", () => {
  it("提取传热系数限值及原文片段", () => {
    const html = "外墙的传热系数不应大于 0.45 W/(m²·K)，屋面不应大于 0.30 W/(m²·K)。";
    const indicators = extractKValueIndicators(html);
    expect(indicators).toHaveLength(2);
    expect(indicators[0].value).toBe(0.45);
    expect(indicators[0].unit).toBe("W/(m²·K)");
    expect(indicators[0].rawText).toContain("传热系数");
    expect(indicators[0].rawText).toContain("0.45 W/(m²·K)");
  });

  it("无匹配时返回空数组", () => {
    expect(extractKValueIndicators("本页面不含限值信息")).toEqual([]);
  });
});

describe("HTML 解码与 PDF 链接", () => {
  it("UTF-8 正常解码", () => {
    const buffer = Buffer.from("<title>标准公告</title>", "utf-8");
    expect(decodeHtml(buffer, "text/html; charset=utf-8")).toContain("标准公告");
  });

  it("GBK 页面按 meta charset 解码不乱码", () => {
    // "节能设计标准" 的 GBK 字节（Windows-936 编码，非 UTF-8 可表示）
    const gbkBytes = [0xBD, 0xDA, 0xC4, 0xDC, 0xC9, 0xE8, 0xBC, 0xC6, 0xB1, 0xEA, 0xD7, 0xBC];
    const buffer = Buffer.concat([
      Buffer.from('<meta charset="gb2312"><title>', "latin1"),
      Buffer.from(gbkBytes),
      Buffer.from("</title>", "latin1")
    ]);
    const html = decodeHtml(buffer, "text/html");
    expect(html).toContain("节能设计标准");
  });

  it("提取 PDF 附件链接并解析为绝对地址", () => {
    const pdf = extractPdfLink(LIST_HTML, "https://std.example.gov.cn/list/");
    expect(pdf).toBe("https://std.example.gov.cn/pdf/notice.pdf");
  });
});