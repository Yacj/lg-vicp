import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { AUTH_CLIENTS } from "../../shared/constants.js";
import { requireClient } from "../../shared/client-guard.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { MD_PERMISSIONS } from "../../shared/md-permissions.js";
import { ok } from "../../shared/response.js";
import {
  catalogProductListQuerySchema,
  catalogProductParamsSchema,
  createCatalogProductBodySchema,
  productCompareBodySchema,
  updateCatalogProductBodySchema
} from "./product.schemas.js";
import {
  compareCatalogProducts,
  createCatalogProduct,
  deleteCatalogProduct,
  getCatalogProduct,
  listCatalogProducts,
  updateCatalogProduct
} from "./product.service.js";

const TAG = "B端 / 平台 / 产品管理";

function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有产品管理权限");
  }
  return user;
}

export async function productRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();
  const preAdmin = [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)];

  route.get("/", {
    preHandler: preAdmin,
    schema: { tags: [TAG], summary: "产品最小骨架列表", querystring: catalogProductListQuerySchema }
  }, async (request) => {
    requirePermission(request, MD_PERMISSIONS.PRODUCT_LIST);
    return ok(request, await listCatalogProducts(app.db, request.query));
  });

  route.post("/", {
    preHandler: preAdmin,
    schema: { tags: [TAG], summary: "新增产品", body: createCatalogProductBodySchema }
  }, async (request) => {
    const actor = requirePermission(request, MD_PERMISSIONS.PRODUCT_CREATE);
    return ok(request, {
      message: "产品已创建",
      product: await createCatalogProduct(app.db, request, actor, request.body)
    });
  });

  route.post("/compare", {
    preHandler: preAdmin,
    schema: { tags: [TAG], summary: "对比 2~N 个产品的已确认字段", body: productCompareBodySchema }
  }, async (request) => {
    const actor = requirePermission(request, MD_PERMISSIONS.PRODUCT_LIST);
    return ok(request, await compareCatalogProducts(
      app.db,
      request,
      actor,
      request.body.productIds,
      request.body.explainWithAi
    ));
  });

  route.get("/:id", {
    preHandler: preAdmin,
    schema: { tags: [TAG], summary: "产品详情", params: catalogProductParamsSchema }
  }, async (request) => {
    requirePermission(request, MD_PERMISSIONS.PRODUCT_LIST);
    return ok(request, await getCatalogProduct(app.db, request.params.id));
  });

  route.put("/:id", {
    preHandler: preAdmin,
    schema: { tags: [TAG], summary: "修改产品", params: catalogProductParamsSchema, body: updateCatalogProductBodySchema }
  }, async (request) => {
    const actor = requirePermission(request, MD_PERMISSIONS.PRODUCT_UPDATE);
    return ok(request, {
      message: "产品已更新",
      product: await updateCatalogProduct(app.db, request, actor, request.params.id, request.body)
    });
  });

  route.delete("/:id", {
    preHandler: preAdmin,
    schema: { tags: [TAG], summary: "删除产品", params: catalogProductParamsSchema }
  }, async (request) => {
    const actor = requirePermission(request, MD_PERMISSIONS.PRODUCT_DELETE);
    await deleteCatalogProduct(app.db, request, actor, request.params.id);
    return ok(request, { message: "产品已删除" });
  });
}
