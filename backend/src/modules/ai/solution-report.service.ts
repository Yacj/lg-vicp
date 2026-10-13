import { loadActiveSolution, getSolutionSnapshot } from "./solution-state.service.js";
import { toSolutionDocumentModel } from "./solution-document-model.js";
import { generateTemplateReport } from "../reports/report-snapshot.service.js";
import { toolError, toolOk } from "./tools/tool-output.js";
import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
export async function generateConfirmedSolutionReport(ctx: Pick<ToolRuntimeContext,"app"|"request"|"user"|"conversation"|"onEvent">, reportType?: string) {
  const active=await loadActiveSolution(ctx);
  if (!active || active.projectId !== ctx.conversation.projectId || active.stage !== "CONFIRMED" || !active.confirmedSnapshotId)
    return toolError({code:"SOLUTION_SNAPSHOT_REQUIRED",message:"请先明确最终方案并确认，形成不可变方案快照后再生成方案报告。"});
  const snapshot=await getSolutionSnapshot(ctx,active.confirmedSnapshotId);
  if (snapshot.projectId !== ctx.conversation.projectId || !snapshot.payload.candidates.length)
    return toolError({code:"SOLUTION_SNAPSHOT_REQUIRED",message:"当前没有可生成报告的已确认方案快照。"});
  const model=toSolutionDocumentModel(snapshot);
  const readableImages=new Set((snapshot.referenceImages ?? []).filter(page=>page.imageUrl).map(page=>page.sourcePageId));
  model.referencePages=model.referencePages.map(page=>({...page,pageId:page.sourcePageId,
    pageImageObjectKey:readableImages.has(page.sourcePageId as string) && typeof page.objectKey==="string" ? page.objectKey : null}));
  const queued=await generateTemplateReport(ctx.app,ctx.request,ctx.user,{reportType:reportType === "project_brief" ? "project_brief" : "technical_scheme",
    projectId:snapshot.projectId,conversationId:snapshot.conversationId,solutionDocumentModel:model});
  ctx.onEvent?.("report_queued",{reportId:queued.report.id,taskId:queued.taskId,solutionSnapshotId:snapshot.id,status:"QUEUED"});
  return toolOk({queued:true,reportId:queued.report.id,taskId:queued.taskId,solutionSnapshotId:snapshot.id},{summary:"已按确认的方案快照排队生成报告。"});
}
