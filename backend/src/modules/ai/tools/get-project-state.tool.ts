import { tool } from "ai";
import { z } from "zod";
import { loadProjectProfile } from "../ai-project-profile.js";
import { listInjectableProjectMemories } from "../ai-project-memory.service.js";
import { runRegisteredTool, type ToolRuntimeContext } from "./tool-runtime.js";
import { toolOk } from "./tool-output.js";
import { normalizeProjectStateForModel } from "./tool-result-normalizer.js";

export const getProjectStateInput = z.object({
  includeMemories: z
    .boolean()
    .default(true)
    .describe("是否同时返回已核实项目记忆。读取项目条件时保持 true，避免再调用其他项目读取工具")
});

export function createGetProjectStateTool(ctx: ToolRuntimeContext) {
  return tool({
    description: `
      读取当前会话关联项目的档案，以及已核实的长期记忆。
      一次返回项目条件与已核实记忆。未关联项目时返回空档案。
    `,
    inputSchema: getProjectStateInput,
    execute: async ({ includeMemories }, options) => runRegisteredTool(ctx, "get_project_state", { includeMemories }, options, async () => {
      if (!ctx.conversation.projectId) {
        return toolOk(normalizeProjectStateForModel({
          profile: null,
          verifiedMemories: []
        }), { summary: "当前会话未关联项目" });
      }
      const profile = await loadProjectProfile(ctx.app, ctx.conversation.projectId);
      const memories = includeMemories
        ? await listInjectableProjectMemories(ctx.app, ctx.conversation.projectId)
        : [];
      const verifiedMemories = memories.map((item) => ({
        title: item.title,
        content: item.content
      }));
      const data = normalizeProjectStateForModel({
        profile: profile ? {
          name: profile.name,
          description: profile.description,
          region: profile.region,
          buildingType: profile.buildingType
        } : null,
        verifiedMemories
      });
      return toolOk(data, {
        summary: profile
          ? `已读取项目「${profile.name}」，已核实记忆 ${verifiedMemories.length} 条`
          : "会话项目不存在或无权查看"
      });
    })
  });
}
