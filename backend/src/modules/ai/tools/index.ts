/**
 * Chat Agent Tool Registry：只组装领域级 Tools，不按数据库函数拆碎工具。
 */
import type { AgentToolName } from "../ai-capability-router.js";
import { createCompareProductsTool } from "./compare-products.tool.js";
import { createCompareSolutionsTool } from "./compare-solutions.tool.js";
import { createGenerateReportTool } from "./generate-report.tool.js";
import { createGetProductDataTool } from "./get-product-data.tool.js";
import { createGetProjectStateTool } from "./get-project-state.tool.js";
import { createSearchKnowledgeTool } from "./search-knowledge.tool.js";
import { createThermalTool } from "./thermal-calculate.tool.js";
import type { ToolRuntimeContext } from "./tool-runtime.js";

export {
  TOOL_STATUS_LABELS,
  hashToolInput,
  isAgentWaitSignal,
  runRegisteredTool,
  stableStringify,
  summarizeToolPayload,
  type AgentWaitSignal,
  type ToolRuntimeContext
} from "./tool-runtime.js";
export { toolError, toolOk, type ToolErrorOutput, type ToolOkOutput, type ToolOutput } from "./tool-output.js";

export function createAgentTools(ctx: ToolRuntimeContext, allowed: AgentToolName[]) {
  const registry = {
    search_knowledge: createSearchKnowledgeTool(ctx),
    get_project_state: createGetProjectStateTool(ctx),
    get_product_data: createGetProductDataTool(ctx),
    thermal: createThermalTool(ctx),
    compare_products: createCompareProductsTool(ctx),
    compare_solutions: createCompareSolutionsTool(ctx),
    generate_report: createGenerateReportTool(ctx)
  };

  return Object.fromEntries(
    allowed.map((name) => [name, registry[name]])
  ) as Partial<typeof registry>;
}
