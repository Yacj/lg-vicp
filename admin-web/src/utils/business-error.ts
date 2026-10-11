import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { BusinessError } from '@/types/error'

/**
 * 业务错误 → 用户文案的**唯一入口**（知识库 + 热工 + 后续业务模块共用）。
 *
 * 两条链路，优先级从高到低：
 * 1. `details.errorCode` 稳定错误码 → `BUSINESS_ERROR_CODE_MESSAGES`（不随后端措辞变化）。
 * 2. `message` 术语替换链 → `BUSINESS_MESSAGE_REPLACEMENTS`（后端技术说明转普通用户句子）。
 *
 * 约定：
 * - 新增术语 / 错误码请追加到本文件对应分组，**不要在业务组件内另建别名表**。
 * - 后端业务码位于 `error.details.errorCode`（HTTP 语义码在 `error.code`，不要混用）。
 */

/**
 * 后端技术术语 → 用户可读文案的替换链。
 * 顺序敏感：先匹配完整技术长句，再匹配裸枚举 / 缩写；替换结果不得再命中后续规则。
 */
const BUSINESS_MESSAGE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/未提供 thermalSetId[：:]?已确认页面与 chunks[，,]未同步 thermal_reference_rows/gi, '页面已确认，但热工数据尚未同步。请到“核对识别结果”检查热工参考集设置。'],
  [/离线页图版本有 (\d+) 页缺少原页图片，不能发布为 AI_ENABLED/g, '有 $1 页缺少原图。请到“资料页面”补充图片后再发布。'],
  [/离线页图版本有 (\d+) 页识别未确认，不能发布为 AI_ENABLED/g, '有 $1 页尚未核对。请到“核对识别结果”确认后再发布。'],
  [/离线页图版本有 (\d+) 页识别结果待人工确认，不能发布为 AI_ENABLED/g, '有 $1 页识别结果待核对。请到“核对识别结果”确认后再发布。'],
  [/离线页图版本有 (\d+) 页识别失败，请重新识别后再发布/g, '有 $1 页识别失败。请到“核对识别结果”重试。'],
  [/离线页图版本有 (\d+) 页正在识别中，请等待识别完成后再发布/g, '有 $1 页正在识别。请等待完成后再发布。'],
  [/离线页图版本有 (\d+) 页尚未完成识别，请完成识别并确认后再发布/g, '有 $1 页尚未识别。请到“核对识别结果”完成识别与确认。'],
  [/当前版本还没有可用于 AI 检索的正式内容：请上传完整页面图片并完成识别确认，或补充原始文件并完成解析/g, '这份资料还没有可用于问答的内容。请上传并核对资料页面，或补充可读取文字的文件。'],
  [/当前版本还没有可被 AI 检索的内容（chunks = 0），不能发布为 AI_ENABLED/g, '这份资料还没有可供问答查找的内容。请核对页面文字，再更新问答内容。'],
  [/版本正式索引重建失败，请重新重建后再发布/g, '问答内容更新失败，请重新更新后再发布。'],
  [/版本正式索引尚未完成（或页面变更后未重建），请先执行版本索引重建/g, '问答内容尚未准备好，或资料修改后尚未更新。请点击“更新问答内容”。'],
  [/版本正式索引内容版本不一致（indexRevision=\d+，contentRevision=\d+），请重新重建版本索引/g, '资料内容已变化，请重新更新问答内容。'],
  [/^严格发布检查未通过：.*$/g, '发布前还有资料质量问题。请核对章节、页码和页面识别结果。'],
  // ── 知识库：发布 / 解析门禁 ──
  [/缺少 ORIGINAL 正式原文件，不能发布 AI 可引用版本/g, '还没有知识文件，不能发布给提问使用。'],
  [/原文件没有文本层且未绑定可检索的文本源：请上传 SEARCH_SOURCE 资产后升级解析，或将版本用途改为 BROWSE_ONLY（仅浏览）/g, '当前文件读不出文字。请补充可搜索文字版本，或改为只查看原文件。'],
  [/原文件没有文本层且不存在 SEARCH_SOURCE 文本源，不能进入 AI 检索/g, '当前文件读不出文字，请先补充可搜索文字版本。'],
  [/检索文本未映射到任何 ORIGINAL 页面，不能生成可回溯的 AI 引用/g, '可搜索文字版本还没有和原文件页面对上，暂时不能发布给提问使用。'],
  [/原文目录尚不可用：请从 PDF 书签、目录页、配套检索源或人工维护生成 TOC/g, '还没有识别到章节目录，可以重新解析或在更多设置中补充章节。'],
  [/原文目录尚未人工确认（CONFIRMED），AI 引用的目录路径以当前草稿为准/g, '章节目录还没有确认，提问引用会按当前识别结果。'],
  [/有 (\d+) 页仅使用物理页码回退（FALLBACK），未识别到可靠印刷页码/g, '有 $1 页没有识别到印刷页码，会用文件页码代替。'],
  [/检索页到原文页的映射尚未人工核验（verified），引用回溯可能偏页/g, '文字版本和原文件的页面对应关系还没有核对，引用页码可能不准。'],
  [/有 (\d+) 条低置信映射不能用于正式 AI 引用/g, '有 $1 处页面对应关系不够确定，可能影响引用是否准确。'],
  [/SEARCH_SOURCE 资产绑定完成，已自动发起升级解析（重建检索内容与页面映射）/g, '已补充可搜索文字版本，正在重新解析。'],
  [/SEARCH_SOURCE 资产绑定完成；如为检索文本源，请触发“升级解析”重建内容与页面映射/g, '已补充可搜索文字版本。如果没有自动开始，请点击重新解析。'],
  [/仅审核通过的版本可以发布/g, '请先审核通过，再发布给提问使用。'],
  [/版本尚未完成解析，不能发布/g, '请等解析完成后再发布。'],
  [/版本尚未完成解析，不能审核/g, '请等解析完成后再审核。'],
  [/已发布或已停用的版本不允许重新解析，请创建新版本/g, '已发布的知识库不能直接重新解析，请更换文件后再解析。'],
  [/仅已发布版本可以停用/g, '只有已发布的知识库可以停用。'],
  [/已发布版本无需重复审核/g, '这份知识库已经审核过了。'],
  [/知识库还在解析中，完成后即可测试。/g, '知识库还在解析中，完成后就可以测试。'],
  [/当前文件无法读取文字，请先补充可搜索文字版本。/g, '当前文件读不出文字，请先补充可搜索文字版本。'],
  [/当前 PDF 无法直接读取文字，请补充可搜索文字版本，或仅作为原文浏览。/g, '当前文件读不出文字。请补充可搜索文字版本，或改为只查看原文件。'],

  // ── 知识库：页面识别 / 映射（后端以字段级 message 返回，不带 errorCode） ──
  [/该页面已有识别任务正在排队或执行/g, '这一页已有识别任务在处理中，请稍后再试。'],
  [/确认前需要页面全文（fullText\/parsedText）/g, '这一页还没有识别出文字内容，请先识别再确认。'],
  [/人工选择的构造方案与识别数据不兼容/g, '选择的构造方案和这一页的识别结果对不上，请重新选择。'],
  [/人工选择的产品规格不存在、未发布或不属于该构造方案/g, '选择的产品规格不存在、未发布，或不属于该构造方案，请重新选择。'],

  // ── 热工：参考集 / 计算规则 / 标准限值 ──
  [/图集热工参考集或导入作业不存在/g, '找不到这个热工参考集或导入任务，请刷新后重试。'],
  [/参考行唯一约束冲突，导入已整体回滚/g, '导入的数据有重复项，已全部撤销，请修正后重新导入。'],
  [/导入文件存在错误行，需显式确认忽略/g, '导入文件里有错误行，请确认忽略后再导入。'],
  [/图集热工参考集结构校验未通过/g, '热工参考集的文件结构不符合要求，请检查后重新导入。'],
  [/参考集最新版本状态不允许应用导入，请先派生新版本草稿/g, '当前参考集版本状态不允许导入，请先创建一个新版本草稿。'],
  [/引用的构造方案或产品规格未发布或已失效/g, '引用的构造方案或产品规格还没有发布，或已失效。'],
  [/没有已发布且生效中的计算规则，请先在后台配置并审核发布/g, '还没有可用的热工计算规则，请先配置并发布计算规则。'],
  [/该地区没有已发布且生效中的标准限值，合格判定暂缺/g, '这个地区还没有可用的标准限值，暂时无法判断是否满足要求。'],
  [/当前状态不允许执行该操作/g, '当前状态不允许执行这个操作，请刷新后重试。'],

  // ── 通用术语降噪 ──
  [/正式原文件/g, '知识文件'],
  [/检索文件/g, '可搜索文字版本'],
  [/无文本层/g, '读不出文字'],
  [/检索源/g, '可搜索文字版本'],
  [/物理页/g, '文件页'],
  [/页面映射/g, '页面对应'],
  [/图集热工参考集/g, '热工参考集'],
  [/参考行/g, '参考方案'],
  [/\bORIGINAL\b/g, '知识文件'],
  [/\bSEARCH_SOURCE\b/g, '可搜索文字版本'],
  [/\bBROWSE_ONLY\b/g, '只查看原文件'],
  [/\bAI_ENABLED\b/g, '可用于提问'],
  [/\bCONFIRMED\b/g, '已确认'],
  [/\bFALLBACK\b/g, '文件页'],
  [/\bTOC\b/g, '目录'],
  [/\bOCR\b/g, '文字识别'],
  [/\bChunk\b/gi, '内容'],
  [/\bBlock\b/gi, '内容'],

  // ── 识别 / 索引状态枚举：技术说明里若直接出现，统一转成中文状态名 ──
  [/\bREVIEW_REQUIRED\b/g, '待校验'],
  [/\bINDEX_READY\b/g, '问答内容已准备好'],
  [/\bINDEXING\b/g, '问答内容更新中'],
  [/\bINDEX_PENDING\b/g, '问答内容待更新'],
  [/\bINDEX_FAILED\b/g, '问答内容更新失败'],
  [/\bPROCESSING\b/g, '识别中'],

  // ── 稳定业务错误码：即使以裸码形式出现在文案里，也给出可读说明 ──
  [/PAGE_RECOGNITION_BUSY/g, '该页正在识别，请稍后再试。'],
  [/PAGE_RECOGNITION_IN_PROGRESS/g, '该页正在识别，请稍后再试。'],
  [/PAGE_RECOGNITION_MAPPING_AMBIGUOUS/g, '检测到多个可匹配的正式构造方案或产品规格，请选择后再确认。'],
  [/PAGE_RECOGNITION_MAPPING_INVALID/g, '选择的构造方案或产品规格和识别结果对不上，请重新选择。'],
  [/PAGE_RECOGNITION_MAPPING_NOT_FOUND/g, '未匹配到正式构造方案或产品规格，请先补充正式业务数据。'],
  [/KNOWLEDGE_VERSION_NOT_EDITABLE/g, '当前版本不可编辑，请创建新版本。'],
  [/KNOWLEDGE_INDEX_NOT_READY/g, '问答内容还未准备好，请先更新问答内容。'],
  [/KNOWLEDGE_INDEX_STALE/g, '资料内容已变化，请先更新问答内容。'],
  [/THERMAL_REFERENCE_SET_NOT_EDITABLE/g, '当前热工参考集已发布，本次确认不会修改正式热工数据。'],
  [/THERMAL_SET_NOT_EDITABLE/g, '当前热工参考集已发布，本次确认不会修改正式热工数据。'],
]

/**
 * 稳定业务错误码 → 用户可读文案。
 * 后端业务错误码位于 `error.details.errorCode`（不在 HTTP 状态码上），
 * 按码给出确定性文案，避免依赖 message 的措辞变化。
 */
export const BUSINESS_ERROR_CODE_MESSAGES: Record<string, string> = {
  // ── 知识库发布 / 解析门禁（shared/knowledge-errors.ts） ──
  KNOWLEDGE_NOT_READY_FOR_TEST: '知识库还在解析中，完成后就可以测试。',
  KNOWLEDGE_SEARCH_SOURCE_REQUIRED: '当前文件读不出文字，请先补充可搜索文字版本。',
  KNOWLEDGE_VERSION_EMPTY: '当前知识库还没有资料页面，请先上传页面后再发布。',
  KNOWLEDGE_VERSION_NOT_DISABLED: '只有已停用的版本可以重新启用。',
  KNOWLEDGE_PUBLISHED_VERSION_CONFLICT: '知识库已有发布版本，请先停用当前发布版本，再启用此版本。',
  KNOWLEDGE_VERSION_NOT_APPROVED: '当前版本还没有审核通过，请先审核再发布。',
  KNOWLEDGE_VERSION_ALREADY_PUBLISHED: '这份知识库已经发布过了，不需要重复发布。',
  KNOWLEDGE_VERSION_PAGES_UNCONFIRMED: '还有资料页面没有完成识别确认，请先确认后再发布。',
  KNOWLEDGE_VERSION_PAGES_MISSING_IMAGE: '还有资料页面缺少页面图片，请先补齐后再发布。',
  KNOWLEDGE_VERSION_PAGES_RECOGNITION_FAILED: '还有资料页面识别失败，请重新识别并确认后再发布。',
  KNOWLEDGE_SEARCHABLE_CONTENT_REQUIRED: '这份知识库还没有可被提问检索的内容，请先生成后再发布。',

  // ── 知识库页面识别 / 上传 ──
  PAGE_RECOGNITION_BUSY: '该页正在识别，请稍后再试。',
  PAGE_RECOGNITION_IN_PROGRESS: '该页正在识别，请稍后再试。',
  PAGE_RECOGNITION_NOT_READY: '这一页还没有识别结果，请先识别再确认。',
  PAGE_RECOGNITION_REQUIRED: '这一页还没有识别结果，请先识别再确认。',
  PAGE_RECOGNITION_MAPPING_AMBIGUOUS: '检测到多个可匹配的正式构造方案或产品规格，请选择后再确认。',
  PAGE_RECOGNITION_MAPPING_INVALID: '选择的构造方案或产品规格和识别结果对不上，请重新选择。',
  PAGE_RECOGNITION_MAPPING_NOT_FOUND: '未匹配到正式构造方案或产品规格，请先补充正式业务数据，或调整本页映射后再确认。',
  PAGE_IMAGE_REQUIRED: '这一页还没有页面图片，请先上传页面图片。',
  DUPLICATE_PHYSICAL_PAGE_NUMBER: '这个文件页码已经用过了，请检查后重新上传。',
  PAGE_IN_USE: '这一页正在被其他流程使用，请稍后再试。',
  FILE_IN_USE: '这个文件正在被其他流程使用，请稍后再试。',

  // ── 知识库解析失败码（随 workspace 透出） ──
  PARSE_FAILED: '解析失败，请检查文件后重试。',
  PDF_PAGE_PARSE_FAILED: 'PDF 有页面内容无法正常解析，请检查文件后重试。',
  PDF_TEXT_PARSE_FAILED: 'PDF 文字内容无法正常解析，请检查文件后重试。',

  // ── 热工 ──
  THERMAL_ENTITY_NOT_FOUND: '找不到这个热工参考集或导入任务，请刷新后重试。',
  THERMAL_STATUS_CONFLICT: '当前状态不允许执行这个操作，请刷新后重试。',
  THERMAL_DUPLICATE_KEY: '导入的数据有重复项，已全部撤销，请修正后重新导入。',
  THERMAL_IMPORT_INVALID: '导入文件里有错误行，请确认忽略后再导入。',
  THERMAL_STRUCTURE_INVALID: '热工参考集的文件结构不符合要求，请检查后重新导入。',
  THERMAL_SET_VERSION_CONFLICT: '当前参考集版本状态不允许导入，请先创建一个新版本草稿。',
  THERMAL_REFERENCE_NOT_PUBLISHED: '引用的构造方案或产品规格还没有发布，或已失效。',
  THERMAL_CALC_RULE_NOT_PUBLISHED: '还没有可用的热工计算规则，请先配置并发布计算规则。',
  THERMAL_STANDARD_LIMIT_NOT_FOUND: '这个地区还没有可用的标准限值，暂时无法判断是否满足要求。',
  THERMAL_REFERENCE_SET_NOT_EDITABLE: '当前热工参考集已发布，本次确认不会修改正式热工数据。',

  // ── 防御性登记：后端当前未随 details.errorCode 透出，保留以免上游补齐后前端漏译 ──
  KNOWLEDGE_VERSION_NOT_EDITABLE: '当前版本不可编辑，请创建新版本。',
  KNOWLEDGE_VERSION_NOT_FOUND: '找不到这个知识版本，请刷新后重试。',
  KNOWLEDGE_PAGE_NOT_FOUND: '找不到这个页面，请刷新后重试。',
  KNOWLEDGE_PAGE_REQUIRED: '请先上传资料页面，再进行识别和校验。',
  KNOWLEDGE_INDEX_NOT_READY: '问答内容还未准备好，请先更新问答内容。',
  KNOWLEDGE_INDEX_STALE: '资料内容已变化，请先更新问答内容。',
  THERMAL_SET_NOT_EDITABLE: '当前热工参考集已发布，本次确认不会修改正式热工数据。',
}

/** 从业务错误 `details.errorCode` 提取稳定错误码（非业务错误返回 null）。 */
export function businessErrorCode(error: unknown): string | null {
  if (!(error instanceof BusinessError)) {
    return null
  }
  const details = error.details
  if (!details || typeof details !== 'object') {
    return null
  }
  const code = (details as Record<string, unknown>).errorCode
  return typeof code === 'string' && code.trim() !== '' ? code : null
}

/** 全局兜底文案：无法识别错误类型或后端未给出可读说明时使用（与 normalizeFeedbackError 口径一致）。 */
export const BUSINESS_FALLBACK_MESSAGE = '操作失败，请稍后重试。'

/** 把后端技术说明转成普通用户能看懂的句子。 */
export function businessUserMessage(message: string | null | undefined): string {
  const text = (message ?? '').trim()
  if (!text) {
    return BUSINESS_FALLBACK_MESSAGE
  }
  let next = text
  for (const [pattern, replacement] of BUSINESS_MESSAGE_REPLACEMENTS) {
    next = next.replace(pattern, replacement)
  }
  if (/error|exception|stack|worker boom|traceback/i.test(next) && /[A-Z]/i.test(next)) {
    return '系统在处理时遇到问题，请稍后重试。'
  }
  const technicalCheck = next.replace(/\b(?:PDF|ZIP|PNG|JPG|JPEG|AI|MB)\b/g, '')
  if (/(?:[a-z]+[A-Z][A-Za-z]*|[a-z]+_[a-z_]+|\b[A-Z][A-Z_]{2,}\b|\bchunks\b|\bJSON\b)/.test(technicalCheck)) {
    return '系统未能完成处理。请刷新当前页面后重试；若仍失败，请联系管理员。'
  }
  return next.replace(/\s{2,}/g, ' ').trim()
}

/**
 * 业务错误 → 用户可读文案。
 * 优先按 `details.errorCode` 映射（稳定），缺失时回退到 message 的术语替换。
 */
export function businessUserError(error: unknown, fallback = BUSINESS_FALLBACK_MESSAGE): string {
  const code = businessErrorCode(error)
  if (code && code in BUSINESS_ERROR_CODE_MESSAGES) {
    return BUSINESS_ERROR_CODE_MESSAGES[code]!
  }
  if (!(error instanceof Error)) {
    return fallback
  }
  const message = normalizeFeedbackError(error).message
  const presented = message.trim() !== '' ? businessUserMessage(message) : fallback
  const requestId = normalizeFeedbackError(error).requestId
  if (requestId && (presented === fallback || presented.startsWith('系统未能完成处理') || presented.startsWith('系统在处理时遇到问题'))) {
    return `${presented}（请求编号：${requestId}）`
  }
  return presented
}
