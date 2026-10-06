/**
 * 产品对比结构化结果。
 * 当前禁止固定权重、总分、排名、K 值筛选或宣称唯一最优。
 * 热工结果为可选能力，缺失时 status=NOT_AVAILABLE，对比仍可完成。
 */
import { USER_LANGUAGE_NOTES } from "../../shared/ai-response-policy.js";

export type ComparisonSourceType =
  | "PRODUCT_FIELD"
  | "KNOWLEDGE"
  | "USER_REQUIREMENT"
  | "THERMAL"
  | "OTHER";

export type ComparisonSourceRef = {
  type: "CATALOG_PRODUCT" | "KNOWLEDGE_DOCUMENT" | "USER_REQUIREMENT" | "THERMAL" | "COMPARISON_RULE";
  id: string;
  label: string;
  productId?: string;
};

export type ComparisonDimensionItem = {
  productId: string;
  value?: string | number | null;
  evidenceRefs?: ComparisonSourceRef[];
  insufficient?: boolean;
  note?: string;
};

export type ComparisonDimension = {
  key: string;
  label: string;
  sourceType: ComparisonSourceType;
  items: ComparisonDimensionItem[];
  insufficient?: boolean;
  note?: string;
};

export type ConfirmedRequirement = {
  key?: string;
  text: string;
  sourceMessageId?: string;
};

export type ThermalCapabilityState = {
  status: "NOT_AVAILABLE" | "PENDING" | "AVAILABLE";
  results?: unknown[];
};

export type ComparisonProduct = {
  id: string;
  name: string;
  categoryId?: string | null;
  summary?: string | null;
  status?: string | null;
  knowledgeDocumentIds?: string[];
};

export type ComparisonContext = {
  conversationId: string;
  projectId?: string | null;
  userGoal?: string;
  confirmedRequirements: ConfirmedRequirement[];
  productIds: string[];
  dimensions: ComparisonDimension[];
  evidenceRefs: ComparisonSourceRef[];
  thermal?: ThermalCapabilityState;
};

export type ProductComparisonResult = {
  products: ComparisonProduct[];
  dimensions: ComparisonDimension[];
  evidenceRefs: ComparisonSourceRef[];
  missingNotes: string[];
  thermal: ThermalCapabilityState;
  ranking: null;
  scores: null;
};

export type CompareProductsInput = {
  productIds: string[];
  focus?: string[];
  userGoal?: string;
  confirmedRequirements?: ConfirmedRequirement[];
  conversationId?: string;
  projectId?: string | null;
  thermal?: ThermalCapabilityState;
};

const COST_FOCUS_PATTERN = /性价比|价格|造价|成本|单价/;
const THERMAL_FOCUS_PATTERN = /热工|传热|k\s*值|热阻/;

function uniqueRefs(refs: ComparisonSourceRef[]): ComparisonSourceRef[] {
  const seen = new Set<string>();
  const result: ComparisonSourceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.type}:${ref.id}:${ref.productId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

export function isCostLikeFocus(text: string): boolean {
  return COST_FOCUS_PATTERN.test(text);
}

export function isThermalLikeFocus(text: string): boolean {
  return THERMAL_FOCUS_PATTERN.test(text);
}

export function emptyThermalState(): ThermalCapabilityState {
  return { status: "NOT_AVAILABLE", results: [] };
}

function fieldDimension(
  key: string,
  label: string,
  products: ComparisonProduct[],
  read: (product: ComparisonProduct) => string | number | null | undefined
): ComparisonDimension {
  return {
    key,
    label,
    sourceType: "PRODUCT_FIELD",
    items: products.map((product) => {
      const value = read(product);
      const missing = value == null || value === "";
      return {
        productId: product.id,
        value: missing ? null : value,
        insufficient: missing,
        note: missing ? "产品目录未提供该字段" : undefined,
        evidenceRefs: [{ type: "CATALOG_PRODUCT", id: product.id, label: product.name, productId: product.id }]
      };
    })
  };
}

export function buildProductComparisonDimensions(input: {
  products: ComparisonProduct[];
  focus?: string[];
  confirmedRequirements?: ConfirmedRequirement[];
  knowledgeEvidence?: Array<{
    productId: string;
    documentId: string;
    title: string;
    excerpt?: string | null;
  }>;
  thermal?: ThermalCapabilityState;
}): { dimensions: ComparisonDimension[]; missingNotes: string[]; evidenceRefs: ComparisonSourceRef[] } {
  const products = input.products;
  const dimensions: ComparisonDimension[] = [];
  const missingNotes: string[] = [];
  const evidenceRefs: ComparisonSourceRef[] = products.map((product) => ({
    type: "CATALOG_PRODUCT",
    id: product.id,
    label: product.name,
    productId: product.id
  }));

  dimensions.push(fieldDimension("name", "产品名称", products, (item) => item.name));
  dimensions.push(fieldDimension("summary", "产品简介", products, (item) => item.summary));
  dimensions.push(fieldDimension("categoryId", "产品分类", products, (item) => item.categoryId));

  const knowledgeByProduct = new Map<string, Array<{ documentId: string; title: string; excerpt?: string | null }>>();
  for (const item of input.knowledgeEvidence ?? []) {
    const list = knowledgeByProduct.get(item.productId) ?? [];
    list.push(item);
    knowledgeByProduct.set(item.productId, list);
    evidenceRefs.push({
      type: "KNOWLEDGE_DOCUMENT",
      id: item.documentId,
      label: item.title,
      productId: item.productId
    });
  }

  if ((input.knowledgeEvidence ?? []).length > 0 || products.some((item) => (item.knowledgeDocumentIds ?? []).length > 0)) {
    dimensions.push({
      key: "knowledge",
      label: "技术资料",
      sourceType: "KNOWLEDGE",
      items: products.map((product) => {
        const docs = knowledgeByProduct.get(product.id) ?? [];
        if (docs.length === 0) {
          return {
            productId: product.id,
            value: null,
            insufficient: true,
            note: USER_LANGUAGE_NOTES.missingKnowledge
          };
        }
        return {
          productId: product.id,
          value: docs.map((doc) => doc.title).join("；"),
          insufficient: false,
          evidenceRefs: docs.map((doc) => ({
            type: "KNOWLEDGE_DOCUMENT" as const,
            id: doc.documentId,
            label: doc.title,
            productId: product.id
          }))
        };
      })
    });
  }

  const focusItems = [
    ...(input.focus ?? []).map((text) => ({ key: text, text })),
    ...(input.confirmedRequirements ?? []).map((item) => ({ key: item.key ?? item.text, text: item.text }))
  ];

  for (const focus of focusItems) {
    if (isCostLikeFocus(focus.text)) {
      const note = USER_LANGUAGE_NOTES.missingPrice;
      missingNotes.push(note);
      dimensions.push({
        key: `focus:${focus.key}`,
        label: focus.text,
        sourceType: "USER_REQUIREMENT",
        insufficient: true,
        note,
        items: products.map((product) => ({
          productId: product.id,
          value: null,
          insufficient: true,
          note
        }))
      });
      continue;
    }

    if (isThermalLikeFocus(focus.text) && input.thermal?.status !== "AVAILABLE") {
      const note = USER_LANGUAGE_NOTES.missingThermal;
      missingNotes.push(note);
      dimensions.push({
        key: `focus:${focus.key}`,
        label: focus.text,
        sourceType: "THERMAL",
        insufficient: true,
        note,
        items: products.map((product) => ({
          productId: product.id,
          value: null,
          insufficient: true,
          note
        }))
      });
      continue;
    }

    dimensions.push({
      key: `focus:${focus.key}`,
      label: focus.text,
      sourceType: "USER_REQUIREMENT",
      items: products.map((product) => {
        const summary = product.summary ?? "";
        const knowledge = (knowledgeByProduct.get(product.id) ?? [])
          .map((doc) => `${doc.title} ${doc.excerpt ?? ""}`)
          .join(" ");
        const haystack = `${product.name} ${summary} ${knowledge}`;
        const matched = haystack.toLowerCase().includes(focus.text.toLowerCase());
        if (!matched) {
          return {
            productId: product.id,
            value: null,
            insufficient: true,
            note: `资料不足，暂时无法就「${focus.text}」给出该产品结论`
          };
        }
        return {
          productId: product.id,
          value: summary || product.name,
          insufficient: false,
          evidenceRefs: [{
            type: "CATALOG_PRODUCT",
            id: product.id,
            label: product.name,
            productId: product.id
          }]
        };
      })
    });
  }

  if (input.thermal?.status === "AVAILABLE" && (input.thermal.results?.length ?? 0) > 0) {
    dimensions.push({
      key: "thermal",
      label: "热工结果（可选）",
      sourceType: "THERMAL",
      items: products.map((product) => ({
        productId: product.id,
        value: JSON.stringify(input.thermal?.results ?? []),
        insufficient: false,
        evidenceRefs: [{ type: "THERMAL", id: product.id, label: "已注入热工结果", productId: product.id }]
      }))
    });
  }

  const knowledgeMissing = products.filter((product) => (product.knowledgeDocumentIds ?? []).length === 0);
  if (knowledgeMissing.length === products.length) {
    missingNotes.push("现有产品资料还不足以支持详细技术对比。");
  }

  return {
    dimensions,
    missingNotes: [...new Set(missingNotes)],
    evidenceRefs: uniqueRefs(evidenceRefs)
  };
}

export function freezeProductComparisonResult(result: ProductComparisonResult): ProductComparisonResult {
  return {
    products: result.products.map((item) => ({ ...item, knowledgeDocumentIds: [...(item.knowledgeDocumentIds ?? [])] })),
    dimensions: result.dimensions.map((dimension) => ({
      ...dimension,
      items: dimension.items.map((item) => ({
        ...item,
        evidenceRefs: item.evidenceRefs?.map((ref) => ({ ...ref }))
      }))
    })),
    evidenceRefs: result.evidenceRefs.map((ref) => ({ ...ref })),
    missingNotes: [...result.missingNotes],
    thermal: {
      status: result.thermal.status,
      results: result.thermal.results ? [...result.thermal.results] : []
    },
    ranking: null,
    scores: null
  };
}

export function buildComparisonContext(input: {
  conversationId: string;
  projectId?: string | null;
  userGoal?: string;
  confirmedRequirements?: ConfirmedRequirement[];
  productIds: string[];
  result: ProductComparisonResult;
}): ComparisonContext {
  return {
    conversationId: input.conversationId,
    projectId: input.projectId ?? null,
    userGoal: input.userGoal,
    confirmedRequirements: input.confirmedRequirements ?? [],
    productIds: [...input.productIds],
    dimensions: input.result.dimensions,
    evidenceRefs: input.result.evidenceRefs,
    thermal: input.result.thermal
  };
}
