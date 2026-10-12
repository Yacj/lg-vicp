import "dotenv/config";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { describe, expect, it, vi } from "vitest";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { solutionRoutes } from "./solution.routes.js";
import { aiDebugRoutes } from "./ai-debug.routes.js";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors.js";
const mocks = vi.hoisted(() => ({ access: vi.fn(), active: vi.fn(), act: vi.fn(), query: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: mocks.access, loadActiveSolution: mocks.active,
  solutionDto: (value: unknown) => value, startSolution: vi.fn(), querySolution: mocks.query,
  actOnSolution: mocks.act, getSolutionSnapshot: vi.fn(), recordCalculatedSolution: vi.fn(), recordProductSolutions: vi.fn() }));
const conversationId = "00000000-0000-4000-8000-000000000001", stateId = "00000000-0000-4000-8000-000000000002";
async function appFor(client: "C_APP" | "PC_AI" | "B_ADMIN" | null) {
  const app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
  await app.register(errorHandlerPlugin);
  app.decorate("authenticate", async (request: any) => { if (!client) throw new UnauthorizedError(); request.currentUser = { id: "user", clientType: client }; });
  mocks.access.mockResolvedValue({ id: conversationId, projectId: null }); mocks.active.mockResolvedValue({ id: stateId });
  mocks.act.mockResolvedValue({ solutionState: { id: stateId, stage: "READY_TO_CONFIRM" } });
  await app.register(solutionRoutes, { prefix: "/api/v1/ai" }); return app;
}
describe("智配 REST 输入与客户端权限", () => {
  it.each(["C_APP", "PC_AI"] as const)("%s 可恢复状态", async client => {
    const app = await appFor(client);
    try { const response = await app.inject(`/api/v1/ai/conversations/${conversationId}/solution`);
      expect(response.json()).toMatchObject({ success: true, data: { id: stateId } }); }
    finally { await app.close(); }
  });
  it.each([["B_ADMIN", 403], [null, 401]] as const)("拒绝客户端 %s", async (client, code) => {
    const app = await appFor(client);
    try { const response = await app.inject(`/api/v1/ai/conversations/${conversationId}/solution`);
      expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ success: false, error: { code } }); }
    finally { await app.close(); }
  });
  it("事实值注入与缺版本参数均被拒绝", async () => {
    const app = await appFor("C_APP");
    try { for (const payload of [{ solutionStateId: stateId, action: "ADD", candidateIds: ["row"] },
      { solutionStateId: stateId, action: "ADD", expectedVersion: 1, candidateIds: ["row"], kValue: .2 }]) {
      const response = await app.inject({ method: "POST", url: `/api/v1/ai/conversations/${conversationId}/solution/actions`, payload });
      expect(response.json()).toMatchObject({ success: false, error: { code: 400 } });
    } } finally { await app.close(); }
  });
  it("UI Final 动作经过同一服务，返回结构化状态", async () => {
    const app = await appFor("C_APP");
    try { const response = await app.inject({ method: "POST", url: `/api/v1/ai/conversations/${conversationId}/solution/actions`,
      payload: { solutionStateId: stateId, action: "SET_FINAL", expectedVersion: 2, positions: [1, 3], candidateSetRevision: 1 } });
      expect(response.json()).toMatchObject({ success: true, data: { solutionState: { stage: "READY_TO_CONFIRM" } } });
      expect(mocks.act).toHaveBeenLastCalledWith(expect.any(Object), stateId, expect.objectContaining({ positions: [1, 3], expectedVersion: 2 }));
    } finally { await app.close(); }
  });
  it("服务权限拒绝不因成功的客户端校验被绕过", async () => {
    const app = await appFor("C_APP"); mocks.access.mockRejectedValueOnce(new ForbiddenError("项目无权访问"));
    try { const response = await app.inject(`/api/v1/ai/conversations/${conversationId}/solution`);
      expect(response.json()).toMatchObject({ success: false, error: { code: 403 } }); }
    finally { await app.close(); }
  });
  it.each(["C_APP", "PC_AI", "B_ADMIN"] as const)("调试状态接口限制B端，客户端%s", async client => {
    const app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    await app.register(errorHandlerPlugin);
    app.decorate("authenticate", async (request: any) => { request.currentUser = { id: "user", clientType: client, role: "SUPER_ADMIN" }; });
    app.decorate("db", { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: stateId, projectId: null }] }) }) }) } as any);
    await app.register(aiDebugRoutes, { prefix: "/api/v1/platform/ai" });
    try { const response = await app.inject(`/api/v1/platform/ai/debug/conversations/${conversationId}/solution`);
      if (client === "B_ADMIN") expect(response.json()).toMatchObject({ success: true, data: { id: stateId } });
      else expect(response.json()).toMatchObject({ success: false, error: { code: 403 } });
    } finally { await app.close(); }
  });
});
