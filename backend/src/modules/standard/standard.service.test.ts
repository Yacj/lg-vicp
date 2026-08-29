import { describe, expect, it } from "vitest";
import { StandardError } from "../../shared/standard-errors.js";
import {
  confirmReplacement,
  createManualDocument,
  expireSupersededDocuments,
  publishDocument,
  publishIndicator,
  updateDocument
} from "./standard.service.js";

/**
 * drizzle 链式查询桩：select 链按预设队列返回行数组；
 * update/insert 记录 set/values 调用供断言（事务与顶层共用同一桩）。
 */
class Chain {
  private cursor = 0;
  constructor(
    private readonly rows: unknown[],
    private readonly hooks: { onSet?: (set: unknown) => void; onValues?: (values: unknown) => void } = {}
  ) {}

  select() { return this; }
  from() { return this; }
  where() { return this; }
  orderBy() { return Promise.resolve(this.rows); }
  limit() { return Promise.resolve([this.rows[Math.min(this.cursor++, this.rows.length - 1)]]); }
  set(set: unknown) { this.hooks.onSet?.(set); return this; }
  values(values: unknown) { this.hooks.onValues?.(values); return this; }
  returning() { return Promise.resolve(this.rows); }
  execute() { return Promise.resolve(this.rows); }
  /** 无终结符的查询（如 where 后直接 await）按整表结果解析 */
  then(resolve: (rows: unknown) => unknown) { return Promise.resolve(this.rows).then(resolve); }
}

interface StubOptions {
  /** select 链按序返回（每项 = 行数组；undefined 表示空结果） */
  selects?: unknown[][];
  /** 记录所有 update().set() 的入参 */
  updateSets?: unknown[];
  /** 记录所有 insert().values() 的入参 */
  insertValues?: unknown[];
}

function stubDb(options: StubOptions = {}) {
  const selects = options.selects ?? [];
  const updateSets = options.updateSets ?? [];
  const insertValues = options.insertValues ?? [];
  let selectIndex = 0;

  const tx = {
    select: () => new Chain(selects[Math.min(selectIndex++, selects.length - 1)] ?? [], {}),
    update: () => new Chain([{}], { onSet: (set) => updateSets.push(set) }),
    insert: () => new Chain([{}], { onValues: (values) => insertValues.push(values) }),
    delete: () => new Chain([])
  };
  return {
    db: {
      select: () => new Chain(selects[Math.min(selectIndex++, selects.length - 1)] ?? [], {}),
      update: () => new Chain([{}], { onSet: (set) => updateSets.push(set) }),
      insert: () => new Chain([{}], { onValues: (values) => insertValues.push(values) }),
      delete: () => new Chain([]),
      transaction: async (callback: (txDb: unknown) => Promise<unknown>) => callback(tx)
    },
    updateSets,
    insertValues
  };
}

const actor = { id: "user-1", role: "SUPER_ADMIN", channelType: null, clientType: "B_ADMIN", permissionCodes: [] };
const request = { ip: "127.0.0.1", headers: {}, id: "req-1" } as never;

const manualInput = {
  provinceCode: "500000",
  provinceName: "重庆市",
  documentNo: "DBJ50/T-428-2023",
  title: "居住建筑节能设计标准",
  applicability: [{ regionCode: "500000", regionName: "重庆市" }],
  indicators: [{ indicatorName: "传热系数限值", value: 0.45, evidenceRef: "第4.2.1条" }]
};

const publishedDocument = {
  id: "doc-1", provinceCode: "500000", documentNo: "DBJ50/T-428-2023", title: "居住建筑节能设计标准",
  status: "PUBLISHED", ingestType: "CRAWL", effectiveAt: new Date("2024-01-01"), expiresAt: null,
  originUrl: "https://std.example.gov.cn/detail.html"
};

describe("人工录入（MANUAL 组合提交）", () => {
  it("指标为空或证据缺失时拒绝提交", async () => {
    const { db } = stubDb();
    await expect(createManualDocument({ db, storage: {} as never, queues: undefined } as never, request, actor, {
      ...manualInput, indicators: []
    })).rejects.toThrow(StandardError);
    await expect(createManualDocument({ db, storage: {} as never, queues: undefined } as never, request, actor, {
      ...manualInput, indicators: [{ indicatorName: "x", value: 0.5, evidenceRef: "" }]
    })).rejects.toThrow(/证据/);
  });

  it("同省份同编号已存在时拒绝（防重复）", async () => {
    const { db } = stubDb({ selects: [[{ id: "doc-dup" }]] });
    await expect(createManualDocument({ db, storage: {} as never, queues: undefined } as never, request, actor, manualInput))
      .rejects.toThrow(/已存在/);
  });

  it("组合提交：文档 DRAFT + 适用范围 DRAFT + 指标 PENDING_REVIEW", async () => {
    const { db, insertValues } = stubDb({ selects: [[]] });
    const document = await createManualDocument({ db, storage: {} as never, queues: undefined } as never, request, actor, manualInput);
    expect(document).toBeDefined();
    // 事务内依次写入：文档、适用范围、指标、审计
    const [docValues, appValues, indicatorValues] = insertValues as unknown as Array<Record<string, unknown>>;
    expect(docValues.ingestType).toBe("MANUAL");
    expect(docValues.status).toBe("DRAFT");
    expect(docValues.version).toBe(1);
    expect(appValues.regionCode).toBe("500000");
    expect(appValues.status).toBe("DRAFT");
    expect(indicatorValues.status).toBe("PENDING_REVIEW");
    expect(indicatorValues.evidenceRef).toBe("第4.2.1条");
  });
});

describe("审核流转守卫", () => {
  it("非 APPROVED 状态的文档不可发布", async () => {
    const { db } = stubDb({ selects: [[{ id: "doc-1", status: "PENDING_REVIEW" }]] });
    await expect(publishDocument({ db, storage: {} as never } as never, request, actor, "doc-1"))
      .rejects.toThrow(/不允许执行/);
  });

  it("仅 DRAFT 文档可编辑", async () => {
    const { db } = stubDb({ selects: [[{ id: "doc-1", status: "APPROVED" }]] });
    await expect(updateDocument({ db, storage: {} as never } as never, request, actor, "doc-1", { title: "新标题" }))
      .rejects.toThrow(/草稿/);
  });
});

describe("指标发布 → 转换落库 thermal_standard_limits", () => {
  it("文档未发布时拒绝发布指标", async () => {
    const { db } = stubDb({
      selects: [
        [{ id: "ind-1", documentId: "doc-1", status: "APPROVED", indicatorType: "K_VALUE", applicabilityId: "app-1" }],
        [{ ...publishedDocument, status: "DRAFT" }]
      ]
    });
    await expect(publishIndicator({ db, storage: {} as never } as never, request, actor, "ind-1"))
      .rejects.toThrow(/发布标准文档/);
  });

  it("同 (regionCode, basisCode) 旧版 DISABLED，新行 version 递增并溯源", async () => {
    const { db, updateSets, insertValues } = stubDb({
      selects: [
        [{ id: "ind-1", documentId: "doc-1", status: "APPROVED", indicatorType: "K_VALUE", applicabilityId: "app-1", value: 0.45, evidenceRef: "第4.2.1条", rawText: null, evidenceLevel: "A" }],
        [publishedDocument],
        [{ id: "app-1", documentId: "doc-1", regionCode: "500000", regionName: "重庆市", status: "PUBLISHED" }],
        [{ max: 2 }]
      ]
    });
    const result = await publishIndicator({ db, storage: {} as never } as never, request, actor, "ind-1");
    expect(result).toBeDefined();
    // 事务内 update：旧 limits DISABLED
    const disableSet = updateSets.find((set) => (set as Record<string, unknown>).status === "DISABLED");
    expect(disableSet).toBeDefined();
    // limits 新行断言（最后一个 insert 前的审计行除外）
    const limitValues = (insertValues as unknown as Array<Record<string, unknown>>).find((values) => values.basisCode === "DBJ50/T-428-2023");
    expect(limitValues).toMatchObject({
      regionCode: "500000",
      basisCode: "DBJ50/T-428-2023",
      basisName: "居住建筑节能设计标准",
      limitKValue: 0.45,
      clauseRef: "第4.2.1条",
      version: 3,
      status: "PUBLISHED",
      standardDocumentId: "doc-1"
    });
  });

  it("非 K_VALUE 指标仅审核流转不生成限值行", async () => {
    const { db, insertValues } = stubDb({
      selects: [
        [{ id: "ind-2", documentId: "doc-1", status: "APPROVED", indicatorType: "HEAT_RESISTANCE", applicabilityId: "app-1" }],
        [publishedDocument]
      ]
    });
    await publishIndicator({ db, storage: {} as never } as never, request, actor, "ind-2");
    const hasLimit = (insertValues as unknown as Array<Record<string, unknown>>).some((values) => "limitKValue" in values);
    expect(hasLimit).toBe(false);
  });

  it("指标未关联适用范围时拒绝发布", async () => {
    const { db } = stubDb({
      selects: [
        [{ id: "ind-1", documentId: "doc-1", status: "APPROVED", indicatorType: "K_VALUE", applicabilityId: null }],
        [publishedDocument]
      ]
    });
    await expect(publishIndicator({ db, storage: {} as never } as never, request, actor, "ind-1"))
      .rejects.toThrow(/适用范围/);
  });
});

describe("替代关系与过渡期", () => {
  it("确认替代时设置旧文档 expiresAt 为过渡期结束时间", async () => {
    const { db, updateSets } = stubDb({
      selects: [[{ id: "rep-1", oldDocumentId: "doc-old", newDocumentId: "doc-new", status: "PENDING", transitionStartAt: null, transitionEndAt: new Date("2026-12-31") }]]
    });
    await confirmReplacement({ db, storage: {} as never } as never, request, actor, "rep-1");
    const docSet = updateSets.find((set) => (set as Record<string, unknown>).expiresAt !== undefined && (set as Record<string, unknown>).status === undefined);
    expect(docSet).toMatchObject({ expiresAt: new Date("2026-12-31") });
  });

  it("每日扫描将过渡期已结束的旧文档置为 DISABLED", async () => {
    const { db, updateSets } = stubDb({ selects: [[{ id: "doc-old" }]] });
    const count = await expireSupersededDocuments(db as never);
    expect(count).toBe(1);
    const disableSet = updateSets.find((set) => (set as Record<string, unknown>).status === "DISABLED");
    expect(disableSet).toBeDefined();
  });
});
// ---------------------------------------------------------------- P0-7 可见性回归：抓取/人工 → 审核 → 发布 → AI/候选才可消费

describe("P0-7 标准可见性回归", () => {
  it("抓取/人工新增标准（未审核指标）不能影响候选 K 限值：PENDING_REVIEW 指标发布被拒绝且不产生限值行", async () => {
    const { db, insertValues } = stubDb({
      selects: [
        [{ id: "ind-crawl-1", documentId: "doc-1", status: "PENDING_REVIEW", indicatorType: "K_VALUE", applicabilityId: "app-1", value: 0.4 }]
      ]
    });
    await expect(publishIndicator({ db, storage: {} as never } as never, request, actor, "ind-crawl-1"))
      .rejects.toThrow(StandardError);
    const hasLimit = (insertValues as unknown as Array<Record<string, unknown>>).some((values) => "limitKValue" in values);
    expect(hasLimit).toBe(false);
  });

  it("审核驳回（REJECTED）的指标不可见：发布被拒绝且不产生限值行", async () => {
    const { db, insertValues } = stubDb({
      selects: [
        [{ id: "ind-rejected", documentId: "doc-1", status: "REJECTED", indicatorType: "K_VALUE", applicabilityId: "app-1", value: 0.4 }]
      ]
    });
    await expect(publishIndicator({ db, storage: {} as never } as never, request, actor, "ind-rejected"))
      .rejects.toThrow(StandardError);
    const hasLimit = (insertValues as unknown as Array<Record<string, unknown>>).some((values) => "limitKValue" in values);
    expect(hasLimit).toBe(false);
  });

  it("发布新版本仅将旧 PUBLISHED 限值行置 DISABLED，不篡改其数值（历史计算/报告快照不漂移）", async () => {
    const { db, updateSets } = stubDb({
      selects: [
        [{ id: "ind-1", documentId: "doc-1", status: "APPROVED", indicatorType: "K_VALUE", applicabilityId: "app-1", value: 0.5, evidenceRef: "第4.2.1条", rawText: null, evidenceLevel: "A" }],
        [publishedDocument],
        [{ id: "app-1", documentId: "doc-1", regionCode: "500000", regionName: "重庆市", status: "PUBLISHED" }],
        [{ max: 1 }]
      ]
    });
    await publishIndicator({ db, storage: {} as never } as never, request, actor, "ind-1");
    const disableSet = (updateSets as Array<Record<string, unknown>>).find((set) => set.status === "DISABLED");
    expect(disableSet).toBeDefined();
    // 旧行只改状态与时间戳，limitKValue/regionCode/basisCode 等历史数值一律不动
    expect(Object.keys(disableSet!).sort()).toEqual(["status", "updatedAt"]);
  });
});
