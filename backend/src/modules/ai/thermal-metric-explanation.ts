import type { DomainTurnSemantic } from "./ai-domain-semantic.js";

type DefinitionRequest = Pick<NonNullable<DomainTurnSemantic["factRead"]>, "metric" | "explanationAspect" | "definitionSubjects">;
type Concept = NonNullable<DefinitionRequest["definitionSubjects"]>[number];

// 稳定的工程概念由Backend说明；Semantic只选择阅读目标，不能生成参数或计算结果。
const relationship = "材料层热阻的关系式为 R=δ/(λ×α)。在材料、导热系数 λ 和修正系数 α 相同的条件下，芯材越厚，该芯层热阻越大；其他构造层及表面热阻不变时，总热阻增大，传热系数 K 减小。这里只解释关系，不计算具体厚度的结果。";
const scope = "芯层热阻只描述芯层，产品整体热阻描述完整产品，整构造传热阻描述整套构造，三者不能互填。仅凭芯材厚度无法确定产品整体或整构造的数值，还需其他层参数及正式计算依据。原表未单独给出产品整体热阻时，应明确标注未给出；R、K 的名称和单位按来源保留。";

const meanings = {
  K: "传热系数 K 表示整套构造传热的容易程度，单位是 W/(m²·K)。其他条件相同时，K 越小，保温效果越好。它与材料导热系数 λ、热阻 R 是不同指标，数值不能直接混着比较。",
  PRODUCT_R: "产品层热阻 R 表示该产品层阻碍热量通过的能力，单位是 (m²·K)/W；同等条件下，R 越大，越不容易传热。完整产品、其中芯层和整套构造的热阻要分开看，不能互相代替。",
  TOTAL_R: "总热阻 R₀ 描述整套构造阻碍热量通过的能力，单位是 (m²·K)/W；同等条件下，总热阻越大，传热系数 K 越小。具体包含哪些构造层和表面热阻，要按原表或正式计算依据核对，不能当作板材自身热阻。"
};
const conciseMeanings: Record<Concept, string> = {
  K: "传热系数 K 描述整套构造传热的容易程度，单位是 W/(m²·K)；其他条件相同时，K 越小，保温效果越好。",
  LAMBDA: "导热系数 λ 描述材料本身传导热量的能力，单位是 W/(m·K)；其他条件相同时，λ 越小，越不容易导热。",
  R: "热阻 R 表示阻碍热量通过的能力，单位是 (m²·K)/W；要区分材料层、完整产品与整构造的范围。",
  PRODUCT_R: "产品层热阻 R 表示该产品层阻碍热量通过的能力，单位是 (m²·K)/W；它不等于单独芯层或整套构造的热阻。",
  TOTAL_R: "整构造总热阻 R₀ 描述整套构造阻碍热量通过的能力，单位是 (m²·K)/W；包含范围按原表或正式计算依据核对。"
};

/** 不读用户问句、不解析数字、不读取旧候选；缺新字段的旧合同保持原行为。 */
export function explainThermalMetric(request: DefinitionRequest): string {
  if (!request.explanationAspect) return `${relationship}\n\n${scope}`;
  if (request.explanationAspect === "RELATIONSHIP") return `${relationship}\n\n芯层、完整产品和整构造的热阻口径不同，不能仅凭芯材厚度确定后两者的数值。`;
  const subjects = [...new Set(request.definitionSubjects ?? (request.metric ? [request.metric] : []))];
  if (subjects.length > 1)
    return `这些是不同的指标，不能直接当作同一个数。\n${subjects.map(subject => conciseMeanings[subject]).join("\n")}`;
  if (request.explanationAspect === "SCOPE") {
    const first = subjects[0];
    return `${first ? conciseMeanings[first] + "\n" : ""}芯层、完整产品和整构造的热阻范围不同，三者不能互填。原表未单独给出产品整体热阻时，应明确标注未给出，不能拿芯层或总热阻代替。`;
  }
  if (subjects.length) {
    const first = subjects[0]!;
    return first === "LAMBDA" || first === "R" ? conciseMeanings[first] : meanings[first];
  }
  if (request.metric) return meanings[request.metric];
  return "热阻 R 表示阻碍热量通过的能力，传热系数 K 表示整套构造传热的容易程度。其他条件相同时，R 越大、K 越小，保温效果越好。R 要区分芯层、完整产品和整构造，不能直接互换；材料导热系数 λ 也不能当作 K。";
}
