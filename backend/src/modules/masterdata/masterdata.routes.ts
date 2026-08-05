import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { MD_PERMISSIONS } from "../../shared/md-permissions.js";
import { ok } from "../../shared/response.js";
import {
  certificateWorkflow,
  createCertificate,
  createEnterpriseProfile,
  deleteCertificate,
  deleteEnterpriseProfile,
  getCertificate,
  getEnterpriseProfile,
  listCertificates,
  listEnterpriseProfiles,
  updateCertificate,
  updateEnterpriseProfile
} from "./md-enterprise.service.js";
import {
  createMaterial,
  createMaterialParameter,
  deleteMaterial,
  deleteMaterialParameter,
  getMaterial,
  getMaterialParameter,
  listMaterialParameters,
  listMaterials,
  updateMaterial,
  updateMaterialParameter
} from "./md-material.service.js";
import {
  attachmentWorkflow,
  createAttachment,
  createProductParameter,
  createProductSeries,
  createProductSpec,
  deleteAttachment,
  deleteProductParameter,
  deleteProductSeries,
  deleteProductSpec,
  getProductParameter,
  getProductSeries,
  getProductSpec,
  listAttachments,
  listProductParameterGroups,
  listProductParameters,
  listProductSeries,
  listProductSpecs,
  updateAttachment,
  updateProductParameter,
  updateProductSeries,
  updateProductSpec
} from "./md-product.service.js";
import {
  listPublishedEnterpriseProfiles,
  listPublishedMaterialParameters,
  listPublishedMaterials,
  listPublishedProductParameters,
  listPublishedProductSpecs
} from "./md-read.service.js";
import {
  approveBodySchema,
  attachmentCreateSchema,
  attachmentDto,
  attachmentUpdateSchema,
  certificateCreateSchema,
  certificateDto,
  certificateUpdateSchema,
  enterpriseProfileCreateSchema,
  enterpriseProfileDto,
  enterpriseProfileUpdateSchema,
  materialCreateSchema,
  materialDto,
  materialParameterCreateSchema,
  materialParameterDto,
  materialParameterUpdateSchema,
  materialUpdateSchema,
  mdAttachmentListQuerySchema,
  mdListQuerySchema,
  mdMaterialParameterListQuerySchema,
  mdParameterGroupQuerySchema,
  mdParameterListQuerySchema,
  mdSpecListQuerySchema,
  MD_RESPONSES,
  newVersionBodySchema,
  productParameterCreateSchema,
  productParameterDto,
  productParameterUpdateSchema,
  productSeriesCreateSchema,
  productSeriesDto,
  productSeriesUpdateSchema,
  productSpecCreateSchema,
  productSpecDto,
  productSpecUpdateSchema,
  publishedMaterialParameterQuerySchema,
  publishedMaterialQuerySchema,
  publishedParameterQuerySchema,
  publishedSpecQuerySchema,
  rejectBodySchema,
  uuidParams
} from "./md.schemas.js";
import {
  registerSimpleWorkflow,
  registerVersionedWorkflow,
  type WorkflowPerms
} from "./workflow-routes.js";

const MD_TAG = "B端 / 平台 / 主数据";

function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有主数据管理权限");
  }
  return user;
}

const P = MD_PERMISSIONS;
const ENTERPRISE_PERMS: WorkflowPerms = {
  list: P.ENTERPRISE_LIST, create: P.ENTERPRISE_CREATE, update: P.ENTERPRISE_UPDATE,
  remove: P.ENTERPRISE_DELETE, approve: P.ENTERPRISE_APPROVE, publish: P.ENTERPRISE_PUBLISH
};
const PRODUCT_PERMS: WorkflowPerms = {
  list: P.PRODUCT_LIST, create: P.PRODUCT_CREATE, update: P.PRODUCT_UPDATE,
  remove: P.PRODUCT_DELETE, approve: P.PRODUCT_APPROVE, publish: P.PRODUCT_PUBLISH
};
const MATERIAL_PERMS: WorkflowPerms = {
  list: P.MATERIAL_LIST, create: P.MATERIAL_CREATE, update: P.MATERIAL_UPDATE,
  remove: P.MATERIAL_DELETE, approve: P.MATERIAL_APPROVE, publish: P.MATERIAL_PUBLISH
};

/** 工作流工厂公共上下文（标签/权限/Schema 均来自本模块约定） */
const workflowCtx = {
  tag: MD_TAG,
  require: requirePermission,
  uuidParams,
  approveBody: approveBodySchema,
  rejectBody: rejectBodySchema,
  newVersionBody: newVersionBodySchema
} as const;

export async function masterdataRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ================================================================ 企业内容（版本化）
  route.get("/enterprise-profiles", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询企业内容列表",
      querystring: mdListQuerySchema, response: { 200: MD_RESPONSES.profileList }
    }
  }, async (request) => {
    requirePermission(request, ENTERPRISE_PERMS.list);
    return ok(request, await listEnterpriseProfiles(app, request.query));
  });

  route.post("/enterprise-profiles", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "新增企业内容",
      body: enterpriseProfileCreateSchema, response: { 200: MD_RESPONSES.profileSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, ENTERPRISE_PERMS.create);
    return ok(request, { item: await createEnterpriseProfile(app, request, actor, request.body) });
  });

  route.get("/enterprise-profiles/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询企业内容详情",
      params: uuidParams, response: { 200: MD_RESPONSES.profileSingle }
    }
  }, async (request) => {
    requirePermission(request, ENTERPRISE_PERMS.list);
    return ok(request, { item: await getEnterpriseProfile(app, request.params.id) });
  });

  route.patch("/enterprise-profiles/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "修改企业内容",
      params: uuidParams, body: enterpriseProfileUpdateSchema,
      response: { 200: MD_RESPONSES.profileSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, ENTERPRISE_PERMS.update);
    return ok(request, { item: await updateEnterpriseProfile(app, request, actor, request.params.id, request.body) });
  });

  route.delete("/enterprise-profiles/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [MD_TAG], summary: "删除企业内容草稿", params: uuidParams, response: { 200: MD_RESPONSES.message } }
  }, async (request) => {
    const actor = requirePermission(request, ENTERPRISE_PERMS.remove);
    return ok(request, await deleteEnterpriseProfile(app, request, actor, request.params.id));
  });

  registerVersionedWorkflow({ ...workflowCtx, app, base: "/enterprise-profiles", label: "企业内容", entity: "enterpriseProfile", perms: ENTERPRISE_PERMS, dto: enterpriseProfileDto });

  // ================================================================ 企业证书（非版本化）
  route.get("/enterprise-certificates", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询企业证书列表",
      querystring: mdListQuerySchema, response: { 200: MD_RESPONSES.certificateList }
    }
  }, async (request) => {
    requirePermission(request, ENTERPRISE_PERMS.list);
    return ok(request, await listCertificates(app, request.query));
  });

  route.post("/enterprise-certificates", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "新增企业证书",
      body: certificateCreateSchema, response: { 200: MD_RESPONSES.certificateSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, ENTERPRISE_PERMS.create);
    return ok(request, { item: await createCertificate(app, request, actor, request.body) });
  });

  route.get("/enterprise-certificates/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询企业证书详情",
      params: uuidParams, response: { 200: MD_RESPONSES.certificateSingle }
    }
  }, async (request) => {
    requirePermission(request, ENTERPRISE_PERMS.list);
    return ok(request, { item: await getCertificate(app, request.params.id) });
  });

  route.patch("/enterprise-certificates/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "修改企业证书",
      params: uuidParams, body: certificateUpdateSchema,
      response: { 200: MD_RESPONSES.certificateSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, ENTERPRISE_PERMS.update);
    return ok(request, { item: await updateCertificate(app, request, actor, request.params.id, request.body) });
  });

  route.delete("/enterprise-certificates/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [MD_TAG], summary: "删除企业证书草稿", params: uuidParams, response: { 200: MD_RESPONSES.message } }
  }, async (request) => {
    const actor = requirePermission(request, ENTERPRISE_PERMS.remove);
    return ok(request, await deleteCertificate(app, request, actor, request.params.id));
  });

  registerSimpleWorkflow({ ...workflowCtx, app, base: "/enterprise-certificates", label: "企业证书", workflow: certificateWorkflow, perms: ENTERPRISE_PERMS, dto: certificateDto });

  // ================================================================ 产品系列（版本化）
  route.get("/product-series", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询产品系列列表",
      querystring: mdListQuerySchema, response: { 200: MD_RESPONSES.seriesList }
    }
  }, async (request) => {
    requirePermission(request, PRODUCT_PERMS.list);
    return ok(request, await listProductSeries(app, request.query));
  });

  route.post("/product-series", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "新增产品系列",
      body: productSeriesCreateSchema, response: { 200: MD_RESPONSES.seriesSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.create);
    return ok(request, { item: await createProductSeries(app, request, actor, request.body) });
  });

  route.get("/product-series/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询产品系列详情",
      params: uuidParams, response: { 200: MD_RESPONSES.seriesSingle }
    }
  }, async (request) => {
    requirePermission(request, PRODUCT_PERMS.list);
    return ok(request, { item: await getProductSeries(app, request.params.id) });
  });

  route.patch("/product-series/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "修改产品系列",
      params: uuidParams, body: productSeriesUpdateSchema,
      response: { 200: MD_RESPONSES.seriesSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.update);
    return ok(request, { item: await updateProductSeries(app, request, actor, request.params.id, request.body) });
  });

  route.delete("/product-series/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [MD_TAG], summary: "删除产品系列草稿", params: uuidParams, response: { 200: MD_RESPONSES.message } }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.remove);
    return ok(request, await deleteProductSeries(app, request, actor, request.params.id));
  });

  registerVersionedWorkflow({ ...workflowCtx, app, base: "/product-series", label: "产品系列", entity: "productSeries", perms: PRODUCT_PERMS, dto: productSeriesDto });

  // ================================================================ 产品规格（版本化）
  route.get("/product-specs", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询产品规格列表",
      querystring: mdSpecListQuerySchema, response: { 200: MD_RESPONSES.specList }
    }
  }, async (request) => {
    requirePermission(request, PRODUCT_PERMS.list);
    return ok(request, await listProductSpecs(app, request.query));
  });

  route.post("/product-specs", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "新增产品规格",
      body: productSpecCreateSchema, response: { 200: MD_RESPONSES.specSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.create);
    return ok(request, { item: await createProductSpec(app, request, actor, request.body) });
  });

  route.get("/product-specs/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询产品规格详情",
      params: uuidParams, response: { 200: MD_RESPONSES.specSingle }
    }
  }, async (request) => {
    requirePermission(request, PRODUCT_PERMS.list);
    return ok(request, { item: await getProductSpec(app, request.params.id) });
  });

  route.patch("/product-specs/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "修改产品规格",
      params: uuidParams, body: productSpecUpdateSchema,
      response: { 200: MD_RESPONSES.specSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.update);
    return ok(request, { item: await updateProductSpec(app, request, actor, request.params.id, request.body) });
  });

  route.delete("/product-specs/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [MD_TAG], summary: "删除产品规格草稿", params: uuidParams, response: { 200: MD_RESPONSES.message } }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.remove);
    return ok(request, await deleteProductSpec(app, request, actor, request.params.id));
  });

  registerVersionedWorkflow({ ...workflowCtx, app, base: "/product-specs", label: "产品规格", entity: "productSpec", perms: PRODUCT_PERMS, dto: productSpecDto });

  // ================================================================ 产品性能参数（版本化）
  route.get("/product-parameters/groups", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询产品参数冲突视图（按参数分组，四来源并存）",
      querystring: mdParameterGroupQuerySchema, response: { 200: MD_RESPONSES.parameterGroups }
    }
  }, async (request) => {
    requirePermission(request, PRODUCT_PERMS.list);
    return ok(request, { groups: await listProductParameterGroups(app, request.query) });
  });

  route.get("/product-parameters", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询产品性能参数列表",
      querystring: mdParameterListQuerySchema, response: { 200: MD_RESPONSES.parameterList }
    }
  }, async (request) => {
    requirePermission(request, PRODUCT_PERMS.list);
    return ok(request, await listProductParameters(app, request.query));
  });

  route.post("/product-parameters", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "新增产品性能参数",
      body: productParameterCreateSchema, response: { 200: MD_RESPONSES.parameterSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.create);
    return ok(request, { item: await createProductParameter(app, request, actor, request.body) });
  });

  route.get("/product-parameters/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询产品性能参数详情",
      params: uuidParams, response: { 200: MD_RESPONSES.parameterSingle }
    }
  }, async (request) => {
    requirePermission(request, PRODUCT_PERMS.list);
    return ok(request, { item: await getProductParameter(app, request.params.id) });
  });

  route.patch("/product-parameters/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "修改产品性能参数",
      params: uuidParams, body: productParameterUpdateSchema,
      response: { 200: MD_RESPONSES.parameterSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.update);
    return ok(request, { item: await updateProductParameter(app, request, actor, request.params.id, request.body) });
  });

  route.delete("/product-parameters/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [MD_TAG], summary: "删除产品性能参数草稿", params: uuidParams, response: { 200: MD_RESPONSES.message } }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.remove);
    return ok(request, await deleteProductParameter(app, request, actor, request.params.id));
  });

  registerVersionedWorkflow({ ...workflowCtx, app, base: "/product-parameters", label: "产品性能参数", entity: "productParameter", perms: PRODUCT_PERMS, dto: productParameterDto });

  // ================================================================ 产品附件（非版本化）
  route.get("/product-attachments", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询产品/企业附件列表",
      querystring: mdAttachmentListQuerySchema, response: { 200: MD_RESPONSES.attachmentList }
    }
  }, async (request) => {
    requirePermission(request, PRODUCT_PERMS.list);
    return ok(request, await listAttachments(app, request.query));
  });

  route.post("/product-attachments", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "新增产品/企业附件",
      body: attachmentCreateSchema, response: { 200: MD_RESPONSES.attachmentSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.create);
    return ok(request, { item: await createAttachment(app, request, actor, request.body) });
  });

  route.patch("/product-attachments/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "修改附件描述",
      params: uuidParams, body: attachmentUpdateSchema,
      response: { 200: MD_RESPONSES.attachmentSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.update);
    return ok(request, { item: await updateAttachment(app, request, actor, request.params.id, request.body) });
  });

  route.delete("/product-attachments/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [MD_TAG], summary: "删除附件草稿", params: uuidParams, response: { 200: MD_RESPONSES.message } }
  }, async (request) => {
    const actor = requirePermission(request, PRODUCT_PERMS.remove);
    return ok(request, await deleteAttachment(app, request, actor, request.params.id));
  });

  registerSimpleWorkflow({ ...workflowCtx, app, base: "/product-attachments", label: "附件", workflow: attachmentWorkflow, perms: PRODUCT_PERMS, dto: attachmentDto });

  // ================================================================ 材料（版本化）
  route.get("/materials", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询材料列表",
      querystring: mdListQuerySchema, response: { 200: MD_RESPONSES.materialList }
    }
  }, async (request) => {
    requirePermission(request, MATERIAL_PERMS.list);
    return ok(request, await listMaterials(app, request.query));
  });

  route.post("/materials", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "新增材料",
      body: materialCreateSchema, response: { 200: MD_RESPONSES.materialSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, MATERIAL_PERMS.create);
    return ok(request, { item: await createMaterial(app, request, actor, request.body) });
  });

  route.get("/materials/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询材料详情",
      params: uuidParams, response: { 200: MD_RESPONSES.materialSingle }
    }
  }, async (request) => {
    requirePermission(request, MATERIAL_PERMS.list);
    return ok(request, { item: await getMaterial(app, request.params.id) });
  });

  route.patch("/materials/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "修改材料",
      params: uuidParams, body: materialUpdateSchema,
      response: { 200: MD_RESPONSES.materialSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, MATERIAL_PERMS.update);
    return ok(request, { item: await updateMaterial(app, request, actor, request.params.id, request.body) });
  });

  route.delete("/materials/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [MD_TAG], summary: "删除材料草稿", params: uuidParams, response: { 200: MD_RESPONSES.message } }
  }, async (request) => {
    const actor = requirePermission(request, MATERIAL_PERMS.remove);
    return ok(request, await deleteMaterial(app, request, actor, request.params.id));
  });

  registerVersionedWorkflow({ ...workflowCtx, app, base: "/materials", label: "材料", entity: "material", perms: MATERIAL_PERMS, dto: materialDto });

  // ================================================================ 材料参数版本（版本化）
  route.get("/material-parameter-versions", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询材料参数版本列表",
      querystring: mdMaterialParameterListQuerySchema, response: { 200: MD_RESPONSES.materialParameterList }
    }
  }, async (request) => {
    requirePermission(request, MATERIAL_PERMS.list);
    return ok(request, await listMaterialParameters(app, request.query));
  });

  route.post("/material-parameter-versions", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "新增材料参数版本",
      body: materialParameterCreateSchema, response: { 200: MD_RESPONSES.materialParameterSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, MATERIAL_PERMS.create);
    return ok(request, { item: await createMaterialParameter(app, request, actor, request.body) });
  });

  route.get("/material-parameter-versions/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询材料参数版本详情",
      params: uuidParams, response: { 200: MD_RESPONSES.materialParameterSingle }
    }
  }, async (request) => {
    requirePermission(request, MATERIAL_PERMS.list);
    return ok(request, { item: await getMaterialParameter(app, request.params.id) });
  });

  route.patch("/material-parameter-versions/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "修改材料参数版本",
      params: uuidParams, body: materialParameterUpdateSchema,
      response: { 200: MD_RESPONSES.materialParameterSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, MATERIAL_PERMS.update);
    return ok(request, { item: await updateMaterialParameter(app, request, actor, request.params.id, request.body) });
  });

  route.delete("/material-parameter-versions/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [MD_TAG], summary: "删除材料参数草稿", params: uuidParams, response: { 200: MD_RESPONSES.message } }
  }, async (request) => {
    const actor = requirePermission(request, MATERIAL_PERMS.remove);
    return ok(request, await deleteMaterialParameter(app, request, actor, request.params.id));
  });

  registerVersionedWorkflow({ ...workflowCtx, app, base: "/material-parameter-versions", label: "材料参数版本", entity: "materialParameterVersion", perms: MATERIAL_PERMS, dto: materialParameterDto });

  // ================================================================ 已发布读取（只读 PUBLISHED + 生效中，供计算模块/受控读取）
  route.get("/published/enterprise-profiles", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询已发布且生效中的企业内容",
      response: { 200: MD_RESPONSES.publishedList(enterpriseProfileDto) }
    }
  }, async (request) => {
    requirePermission(request, ENTERPRISE_PERMS.list);
    return ok(request, { items: await listPublishedEnterpriseProfiles(app.db) });
  });

  route.get("/published/product-specs", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询已发布且生效中的产品规格",
      querystring: publishedSpecQuerySchema,
      response: { 200: MD_RESPONSES.publishedList(productSpecDto) }
    }
  }, async (request) => {
    requirePermission(request, PRODUCT_PERMS.list);
    return ok(request, { items: await listPublishedProductSpecs(app.db, request.query) });
  });

  route.get("/published/product-parameters", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询已发布且生效中的产品性能参数（可带用途过滤）",
      querystring: publishedParameterQuerySchema,
      response: { 200: MD_RESPONSES.publishedList(productParameterDto) }
    }
  }, async (request) => {
    requirePermission(request, PRODUCT_PERMS.list);
    return ok(request, { items: await listPublishedProductParameters(app.db, request.query) });
  });

  route.get("/published/materials", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询已发布且生效中的材料",
      querystring: publishedMaterialQuerySchema,
      response: { 200: MD_RESPONSES.publishedList(materialDto) }
    }
  }, async (request) => {
    requirePermission(request, MATERIAL_PERMS.list);
    return ok(request, { items: await listPublishedMaterials(app.db, request.query) });
  });

  route.get("/published/material-parameter-versions", {
    preHandler: [app.authenticate],
    schema: {
      tags: [MD_TAG], summary: "查询已发布且生效中的材料参数版本",
      querystring: publishedMaterialParameterQuerySchema,
      response: { 200: MD_RESPONSES.publishedList(materialParameterDto) }
    }
  }, async (request) => {
    requirePermission(request, MATERIAL_PERMS.list);
    return ok(request, { items: await listPublishedMaterialParameters(app.db, request.query) });
  });
}