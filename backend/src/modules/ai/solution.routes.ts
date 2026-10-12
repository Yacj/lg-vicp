import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireClient } from "../../shared/client-guard.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ok } from "../../shared/response.js";
import { thermalQueryStateSchema } from "../thermal/thermal-query-state.js";
import { solutionActionSchema } from "./solution-workflow.js";
import { assertSolutionAccess, loadActiveSolution, solutionDto, startSolution, querySolution, actOnSolution, activateSolutionFromLastLookup, getSolutionSnapshot, recordCalculatedSolution, recordProductSolutions } from "./solution-state.service.js";

export async function solutionRoutes(app: FastifyInstance) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const base = "/conversations/:conversationId/solution";
  const params = z.object({ conversationId: z.uuid() });
  const guards = [app.authenticate, requireClient("C_APP", "PC_AI")];
  const tags = ["共用 / 智配方案"];
  const context = async (request: import("fastify").FastifyRequest, conversationId: string) => {
    const user = getCurrentUser(request);
    const conversation = await assertSolutionAccess(app.db, user, conversationId);
    return { app, request, user, conversation };
  };
  api.get(base, { preHandler: guards, schema: { tags, summary: "恢复当前智配方案状态", params } }, async request => {
    const state = await loadActiveSolution(await context(request, request.params.conversationId));
    return ok(request, state ? solutionDto(state) : null);
  });
  api.post(base, { preHandler: guards, schema: { tags, summary: "开始一轮智配方案", params,
    body: z.object({ expectedVersion: z.number().int().positive().optional(), candidateQueryRevision: z.number().int().positive().optional() }).strict() } }, async request => {
    const ctx = await context(request, request.params.conversationId);
    return ok(request, request.body.candidateQueryRevision
      ? (await activateSolutionFromLastLookup(ctx, request.body.candidateQueryRevision, { action: "START_NEW" }, request.body.expectedVersion)).solutionState
      : await startSolution(ctx, request.body.expectedVersion));
  });
  api.post(`${base}/query`, { preHandler: guards, schema: { tags, summary: "按完整查询条件刷新正式方案池", params,
    body: z.object({ expectedVersion: z.number().int().positive(), query: thermalQueryStateSchema }).strict() } }, async request =>
    ok(request, await querySolution(await context(request, request.params.conversationId), request.body.query, request.body.expectedVersion)));
  api.post(`${base}/actions`, { preHandler: guards, schema: { tags, summary: "选择、加入、移除、比较、指定最终方案或确认冻结", params,
    body: solutionActionSchema.extend({ solutionStateId: z.uuid() }) } }, async request =>
    ok(request, await actOnSolution(await context(request, request.params.conversationId), request.body.solutionStateId, request.body)));
  api.post(`${base}/activate`, { preHandler: guards, schema: { tags, summary: "从最近查询结果一次激活方案并选择或加入候选", params,
    body: z.object({ candidateQueryRevision: z.number().int().positive(), action: z.enum(["ADD", "SELECT", "SET_FINAL"]),
      candidateIds: z.array(z.string().min(1)).min(1).max(100).optional(), positions: z.array(z.number().int().positive()).min(1).max(100).optional() }).strict()
      .refine(body => Boolean(body.candidateIds?.length) !== Boolean(body.positions?.length), { message: "请选择正式候选ID或当前查询序号" }) } }, async request =>
    ok(request, await activateSolutionFromLastLookup(await context(request, request.params.conversationId), request.body.candidateQueryRevision, request.body)));
  api.post(`${base}/calculations`, { preHandler: guards, schema: { tags, summary: "将本人正式计算记录加入方案（支持懒激活）", params,
    body: z.object({ calculationId: z.uuid() }).strict() } }, async request =>
    ok(request, await recordCalculatedSolution(await context(request, request.params.conversationId), request.body.calculationId)));
  api.post(`${base}/products`, { preHandler: guards, schema: { tags, summary: "将正式目录产品纳入方案池（缺少工程事实不能最终确认）", params,
    body: z.object({ expectedVersion: z.number().int().positive(), productIds: z.array(z.uuid()).min(1).max(100) }).strict() } }, async request =>
    ok(request, await recordProductSolutions(await context(request, request.params.conversationId), request.body.productIds, request.body.expectedVersion)));
  api.get(`${base}/snapshots/:snapshotId`, { preHandler: guards, schema: { tags, summary: "读取不可变方案值快照与重签来源图片",
    params: params.extend({ snapshotId: z.uuid() }) } }, async request =>
    ok(request, await getSolutionSnapshot(await context(request, request.params.conversationId), request.params.snapshotId)));
}
