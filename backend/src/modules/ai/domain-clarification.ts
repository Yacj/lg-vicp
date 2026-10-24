import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
import { normalizeEntityText } from "../thermal/thermal-query-state.js";
import { describeNumberRoles } from "../thermal/semantic-query.js";
import { parseThermalLookupMessage } from "../thermal/thermal-lookup-mode.js";

const AFFIRMATIVE_REPLIES = new Set(["是的", "是", "对", "对的", "没错", "确认", "好", "可以", "嗯", "是的介绍"]);
/** 只识别“确认上一轮唯一建议”的封闭短回执；否定、换一个、继续问都不算。 */
export function isAffirmativeReply(text: string) {
  return AFFIRMATIVE_REPLIES.has(normalizeEntityText(text).replace(/[。！!？?，,、\s]/g, ""));
}

/** 内部拒绝依据保留在semantic；客户只接收按结构化目标生成的问题，不直接展示模型内部说明。 */
export function customerDomainClarification(semantic: DomainTurnSemantic, message: string): string {
  // Backend 已根据原问生成唯一、可回答的问题时优先使用；它仍然不是新的查询授权。
  if (semantic.clarificationQuestion?.trim()) return semantic.clarificationQuestion.trim();
  if (semantic.clarificationTarget === "METRIC") return "这个数值指材料导热系数 λ、构造传热系数 K，还是热阻 R？确认后我就按这个数值查。";
  const names = semantic.ambiguity.filter(item => item.length <= 160 && item !== message && message.includes(item));
  if (names.length) return `“${names.join("、")}”指的是哪个产品或体系？确认一下名称，我就按原来的目标继续。`;
  if (semantic.productQuery) return "请确认要查看的产品正式名称或目录别名；我会沿用该产品目标，只按现有资料介绍。";
  if (semantic.parameterQuery) return "请确认产品或材料的参数名称、数值或单位；已说明的目标无需重复提供。";
  switch (semantic.intent) {
    case "PRODUCT_DISCOVERY": case "PRODUCT_DETAIL":
      return "你希望了解哪款产品？请提供正式名称或目录别名，我可以先用简洁方式介绍。";
    case "MATERIAL_COMPARE":
      return "你希望比较哪些产品或材料？可以从导热系数及测定条件、所需厚度、防火与固定节点、施工要求和成本逐项核对；缺少正式对比资料的项目会单独说明。";
    case "SOLUTION_ADVICE":
      return semantic.adviceFocus === "PROS_CONS" ? "你希望了解哪种产品或构造的优势与限制？可以先从保温所需厚度、适用基层、防火与固定节点、施工要求和成本逐项核对；优劣结论需要同条件、可核验的资料支持。"
        : "请说明希望参考的体系或构造；已有的基层和厚度条件无需重复提供。";
    case "THERMAL_CALCULATE":
      return "当前计算对象或参数来源尚未核验完整。请关联对应的已发布构造或原始资料，我会先核对缺项。";
    case "REFERENCE_QUERY": case "REFERENCE_REFINE":
      return "查询条件中还有一项尚未明确，请说明要查看的构造或参数；已给定的指标和厚度无需重复提供。";
    case "REPORT_REQUEST":
      return "请明确要查看报告入口，还是创建报告；正式方案报告还需要已确认的最终方案。";
    default:
      // 已知唯一未定角色的数值时只问它的含义，不把已给数字抹掉，也不替用户猜参数类别。
      const explicitTargets = parseThermalLookupMessage(message).filters.map(filter => filter.targetValue);
      const unknownNumbers = describeNumberRoles(message).filter(number => number.role === "UNKNOWN"
        && !explicitTargets.includes(Number(number.raw)));
      if (unknownNumbers.length === 1) return `你说的“${unknownNumbers[0]!.raw}”具体指哪项条件或参数？说明一下含义，我就按这个条件继续查。`;
      return "请补充这轮希望查看的产品、参数或资料，我会沿用已明确的条件。";
  }
}

/** 模型诊断只作审计材料；客户问题由字段和已确认目标生成，不能展示模型对执行范围的内部说明。 */
export function customerQueryDiagnosticClarification(semantic: DomainTurnSemantic, message: string): string | undefined {
  // 查询服务收到计算合同，本身就是已知的目标冲突，不依赖模型自由填写的unresolved字段名。
  if (semantic.pageQuery?.intent === "THERMAL")
    return "你希望先查已有参考档位，还是按当前构造重新计算？已经给出的条件会保留。";
  const diagnostics = semantic.pageQuery?.unresolved;
  if (!diagnostics?.length) return undefined;
  if (diagnostics.some(item => item.field === "intent"))
    return "你希望先查已有参考档位，还是按参数重新计算？刚才给出的条件会保留。";
  if (diagnostics.some(item => item.field === "sourceScope"))
    return "这次资料来源还没有对应清楚。可以告诉我资料名称，或说明不限定来源；其他已给出的条件会保留。";
  return customerDomainClarification({ ...semantic, clarificationQuestion: null }, message);
}
