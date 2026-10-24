import "dotenv/config";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), approve: vi.fn(), reject: vi.fn(), publish: vi.fn(), disable: vi.fn(), next: vi.fn() }));
vi.mock("../masterdata/md-workflow.service.js", async original => ({ ...await original<object>(), submitForReview: mocks.submit,
  approveEntity: mocks.approve, rejectEntity: mocks.reject, publishEntity: mocks.publish, disableEntity: mocks.disable, createNextVersion: mocks.next }));
vi.mock("./report-template.service.js", async original => ({ ...await original<object>(), validateReportTemplateStructure: vi.fn() }));
import { reportTemplateRoutes } from "./report-template.routes.js";
const id = "10000000-0000-4000-8000-000000000001";
const sections = [{ key: "disclaimer", title: "免责声明", order: 1, enabled: true, sourceType: "TEXT", content: "已经确认的文案" }];
const row = { id, code: "fixture", name: "模板", version: 2, description: null, sectionsJson: sections, requiresProject: false,
  changeNote: null, evidenceSource: null, evidenceRef: null, evidenceLevel: null, effectiveAt: null, expiresAt: null,
  status: "DRAFT", submittedById: null, submittedAt: null, approvedById: null, approvedAt: null, approvalNote: null,
  rejectedById: null, rejectedAt: null, rejectReason: null, publishedById: null, publishedAt: null,
  createdById: null, updatedById: null, createdAt: new Date(), updatedAt: new Date() };
beforeEach(() => { for (const mock of Object.values(mocks)) mock.mockReset().mockResolvedValue(row); });
it.each(["new-version", "submit", "approve", "reject", "publish", "disable"])("报告模板%s响应转换数据库章节字段，不在提交成功后返回500", async action => {
  const app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
  app.decorate("authenticate", async request => { request.currentUser = { id, role: "SUPER_ADMIN" } as any; });
  await app.register(reportTemplateRoutes, { prefix: "/templates" });
  try {
    const response = await app.inject({ method: "POST", url: `/templates/${id}/${action}`,
      ...(["new-version", "approve", "reject"].includes(action) ? { payload: action === "reject" ? { rejectReason: "复核" } : {} } : {}) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, data: { item: { id, sections, version: 2 } } });
    expect(response.json().data.item).not.toHaveProperty("sectionsJson");
    expect(row.sectionsJson).toEqual(sections);
  } finally { await app.close(); }
});
