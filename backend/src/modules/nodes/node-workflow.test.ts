import "dotenv/config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import {
  createNodeNextVersion,
  listPublishedNodesWithLinks,
  validateNodeStructure
} from "./node.service.js";

/**
 * drizzle 链式最小桩（与 construction-workflow.test.ts 同款）：
 * - rows 中每个元素是"一次查询调用应返回的数组"，按调用顺序消耗（未配置时返回空数组）
 * - transaction 直接执行回调（回调内的 db 即桩本身），记录每次 set / insert values 用于断言
 */
function makeDb(rows: Array<Array<Record<string, unknown>>>): {
  db: any;
  setCalls: Array<Record<string, unknown>>;
  insertCalls: Array<Record<string, unknown>>;
} {
  let i = 0;
  const setCalls: Array<Record<string, unknown>> = [];
  const insertCalls: Array<Record<string, unknown>> = [];
  const next = () => rows[i++] ?? [];
  const chain = () => ({
    limit: async () => next(),
    returning: async () => next(),
    orderBy: () => chain(),
    offset: () => chain(),
    then: (resolve: (value: unknown) => void) => Promise.resolve(next()).then(resolve)
  });
  const db = {
    select: () => ({
      from: () => ({
        where: () => chain()
      })
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        setCalls.push(values);
        return { where: () => chain() };
      }
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push(values);
        return { returning: async () => next(), then: (resolve: () => void) => Promise.resolve().then(resolve) };
      }
    }),
    delete: () => ({
      where: () => chain()
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  };
  return { db, setCalls, insertCalls };
}

const actor = { id: "u-1", role: "SUPER_ADMIN", permissionCodes: [] } as any;
const request = { ip: "127.0.0.1", headers: {}, id: "req-1" } as FastifyRequest;
const app = (db: any) => ({ db }) as unknown as FastifyInstance;

const nodeRow = {
  id: "n-1", code: "N-LJ-01", version: 1, status: "PUBLISHED", name: "勒脚保温节点",
  position: "勒脚", systemId: "sys-1", atlasPage: "P12", imageFileId: "f-1", cadFileId: null,
  createdById: "u-old", publishedById: "u-old"
};

describe("节点图 new-version（子表同事务复制）", () => {
  it("派生 DRAFT 新行（version+1）并复制节点-方案关联，nodeDrawingId 指向新行", async () => {
    const newRow = { ...nodeRow, id: "n-2", version: 2, status: "DRAFT" };
    const linkRow = { nodeDrawingId: "n-1", schemeId: "sc-1", atlasPage: "P12", remark: "勒脚详图", createdById: "u-old", updatedById: "u-old" };
    const { db, insertCalls } = makeDb([
      [nodeRow],
      [{ max: 1 }],
      [newRow],
      [linkRow]
    ]);
    const result = await createNodeNextVersion(app(db), request, actor, "n-1", "v2 补充 CAD");
    expect(result).toMatchObject({ version: 2, status: "DRAFT", code: "N-LJ-01" });

    // 父行插入：系统列不复制，version+1，状态 DRAFT
    const nodeInsert = insertCalls[0] as any;
    expect(nodeInsert).toMatchObject({ version: 2, status: "DRAFT", code: "N-LJ-01", changeNote: "v2 补充 CAD", createdById: "u-1" });
    expect(nodeInsert.id).toBeUndefined();
    expect(nodeInsert.publishedById).toBeUndefined();

    // 关联复制：nodeDrawingId -> 新行，业务字段原样保留
    const linkInsert = insertCalls[1] as Array<Record<string, unknown>>;
    expect(linkInsert[0]).toMatchObject({ nodeDrawingId: "n-2", schemeId: "sc-1", atlasPage: "P12", remark: "勒脚详图" });
    expect(linkInsert[0]!.id).toBeUndefined();
  });
});

describe("节点结构校验（submit/publish 前置）", () => {
  it("部位必填、高清图/CAD 至少一个、引用系统已发布时校验通过", async () => {
    const { db } = makeDb([
      [nodeRow],
      [{ id: "sys-1" }],
      []
    ]);
    await expect(validateNodeStructure(app(db), "n-1")).resolves.toBeUndefined();
  });

  it("部位缺失且无图无 CAD 时返回违规明细", async () => {
    const { db } = makeDb([[{ ...nodeRow, position: "", imageFileId: null, cadFileId: null }]]);
    await expect(validateNodeStructure(app(db), "n-1")).rejects.toThrow("部位必填；节点图必须至少提供一张高清图或 CAD 文件");
  });

  it("关联的构造方案未发布时校验失败", async () => {
    const linkRow = { nodeDrawingId: "n-1", schemeId: "sc-draft", atlasPage: "P12" };
    const { db } = makeDb([
      [nodeRow],
      [{ id: "sys-1" }],
      [linkRow],
      []
    ]);
    await expect(validateNodeStructure(app(db), "n-1")).rejects.toThrow("关联的构造方案未发布或已失效");
  });
});

describe("已发布节点读取（报告快照数据源）", () => {
  it("只返回已发布节点，且只保留关联到已发布方案的链接", async () => {
    const linkPublished = { nodeDrawingId: "n-1", schemeId: "sc-1", atlasPage: "P12", createdById: "u-old" };
    const linkDraft = { nodeDrawingId: "n-1", schemeId: "sc-draft", atlasPage: "P13", createdById: "u-old" };
    const { db } = makeDb([
      [nodeRow],
      [linkPublished, linkDraft],
      [{ id: "sc-1" }]
    ]);
    const nodes = await listPublishedNodesWithLinks(db, { systemId: "sys-1", position: "勒脚" });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.schemeLinks.map((link) => link.schemeId)).toEqual(["sc-1"]);
  });

  it("无已发布节点时返回空数组（不查询关联）", async () => {
    const { db } = makeDb([[]]);
    await expect(listPublishedNodesWithLinks(db, { position: "窗台" })).resolves.toEqual([]);
  });
});