import type { DbExecutor } from "../../db/client.js";
import { listPublishedConstructionSchemes, getPublishedConstructionSchemeDetail } from "../construction/construction-read.service.js";

/** 语义层只读取已发布模型身份和层结构，计算参数仍由正式服务读取。 */
export async function publishedCalculationModels(db: DbExecutor) {
  const schemes = await listPublishedConstructionSchemes(db);
  return Promise.all(schemes.slice(0, 80).map(async scheme => {
    const detail = await getPublishedConstructionSchemeDetail(db, scheme.id);
    return { id: detail.id, code: detail.schemeCode, name: detail.name, version: detail.version,
      source: detail.evidenceSource, reference: detail.evidenceRef,
      layers: detail.layers.map(layer => ({ id: layer.id, name: layer.layerName, type: layer.layerType,
        thicknessMm: layer.thickness, materialId: layer.materialId })),
      options: detail.productOptions.map(option => ({ productSpecId: option.productSpecId, minThickness: option.minThickness, maxThickness: option.maxThickness })) };
  }));
}
