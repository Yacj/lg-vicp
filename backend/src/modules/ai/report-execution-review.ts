import {z} from "zod";
import {generateObject, type LanguageModel} from "ai";
import {languageModelSamplingOptions} from "../ai-config/ai-task-runtime-policy.js";

const reportAuthorizationSchema=z.object({
  operation:z.enum(["EXECUTE","PREPARE","UNCLEAR"]),
  confidence:z.number().min(0).max(1),evidence:z.string().min(1).max(2000)
}).strict();

/** 只审查本轮是否授权实际新建报告，不读取身份、参数或方案状态；后续权限及Snapshot检查不变。 */
export async function reviewReportAuthorization(model:LanguageModel,message:string,abortSignal:AbortSignal) {
 const result=await generateObject({model,output:"no-schema",maxRetries:0,abortSignal,
  ...languageModelSamplingOptions("SEMANTIC_QUERY"),
  system:`核验完整用户原话是否授权系统现在实际生成报告。输出JSON：${JSON.stringify(z.toJSONSchema(reportAuthorizationSchema))}。EXECUTE仅表示明确要求系统本轮实际创建或重新生成文件；PREPARE表示只想了解生成方法、查看入口/状态/已有报告，或打算自己稍后点击操作。愿望和最终目标不等于授权当前执行；同一句有最终目标及操作方式限制时，必须共同理解，不能只截取肯定生成片段。否定、假设、转述不能授权生成；可确定只读意图时PREPARE，不能确定时UNCLEAR。evidence必须完整逐字保留本轮原话。禁止输出任何ID、工程参数或权限结论，不能因为已有确认快照而推定授权。`,
  prompt:message});
 const value=reportAuthorizationSchema.parse(result.object);
 return value.evidence===message&&value.confidence>=.9?value.operation:"UNCLEAR";
}
