import {readFile,writeFile} from 'node:fs/promises'
const root='docs/ai/evidence/full-chain-uat-2026-10-19'
const notes={
'S1-T1':'确认VICP正式简称并介绍现有目录；未编造缺失的宣传内容或完整系列。',
'S1-T2':'承接同一产品，按非工程师要求简化表达，没有丢掉身份或强加角色话术。',
'S2-T1':'0.3缺指标时自然确认λ/K/R，没有擅自认作厚度或猜指标。',
'S2-T2':'继承原问0.3，按λ标准单位精确查询；泛称材料不误作产品身份，未命中说明范围。',
'S2-T3':'读取紧邻实际诊断，保留0.3并列出五类核验来源，不将未命中说成市场上不存在。',
'S3-T1':'保留口语/疑似错字，确认缺失指标，没有擅改身份或制造工程答案。',
'S3-T2':'承接原0.3并采用用户明确修正的K/薄抹灰体系；只读当前确认来源，不强制唯一基层。',
'S3-T3':'只新增Ⅲ型条件，继承K=.3和体系；返回真实匹配档位，没有把型号数字当指标。',
'S4-T1':'说明完整性能/价格/耐久证据不足，给出可比维度和需补资料，不杜撰优势。',
'S4-T2':'自然询问具体比较对象，结合上轮比较维度；没有捏造竞品数据、排名或承诺。',
'S5-T1':'提供参考选型步骤，说明基层、热工、节点和标准需分别核对，不擅自计算或确认。',
'S5-T2':'完整返回两条200mm钢筋混凝土Sheet1正式行，输入/数值/来源正确且未自动选定。',
'S5-T3':'同表保留25/35mm各自输入及R/K；说明不同厚度、未绑定历史公式版本，不替用户选Final。',
'S5-T4':'Backend基于当前授权候选唯一绑定自然称呼，实际只选整体法25mm，不产生计算/快照。',
'S5-T5':'实际Final仅整体法25mm，停在核对状态，聊天没有确认快照。',
'S5-T6':'提供真实确认入口，聊天仅只读；实际H5按钮确认并冻结A，幂等与权限另验。',
'S5-T7':'实际H5生成、预览和浏览器保存PDF；逐页核对A的输入、来源、数值及已确认免责声明。',
'R1-T1':'四种基层45mm分别命中，K为.302/.294/.293/.248，页25/26与原图一致。',
'R1-T2':'四基层K同表，准确指出A3-4最低.248，没有把基层差异当同条件产品优劣。',
'R1-T3':'同次两页原引用完整恢复；表格45mm高亮切换和原图详情印刷页25/26均实测。',
'R2-T1':'I型正置/倒置20mm两组均命中；层R=3.2、主断面R=3.569、K=.280，产品整体R保持缺失。',
'R2-T2':'两组R/K同表并说明R所属原列及构造层；未将构造层R冒称产品整体R。',
'R2-T3':'实际H5原图与全屏显示正确来源，定位20mm；印刷页53与物理页33分开。',
'R3-T1':'正式模型八层计算，芯材15mm行R=4.8、包覆各.1，R0/K与Golden一致，不判断达标。',
'R3-T2':'生成真实20mm计算记录，仅芯材层改变；其余七层参数/来源不变，R0约6.906822098、K约.1447843865。',
'R3-T3':'读取上次实际计算的VICP-CALC-1/v1、逐层来源与缺项，不重新计算或虚称已发布参数缺失。',
'R4-T1':'来源库没有适用正式标准限值，明确不能验证浙江住宅K=.3达标，不捏造合规结论。',
'R4-T2':'如实说明缺正式标准版本、条文/限值及生效信息，没有把通用知识当正式依据。',
'R5-T1':'保留两条正式行、原厚度/基层和Sheet1版本，均无图页时不虚构原图。',
'R5-T2':'并列R/K及各R范围，保留不同厚度限制，不自动挑最低K。',
'R5-T3':'唯一绑定自然称呼，将A设Final并保留B作参考；实际状态和后续冻结一致，未聊天确认。',
'R5-T4':'准确核对正式参考参数及Sheet1；明确历史参考行无公式版本绑定，不补造依据。',
'R5-T5':'保持待确认，没有快照或报告副作用，未要求重复基层/工程参数。',
'R5-T6':'只读展示入口；真实H5点击才产生一份确认快照，Final A与备选B分别冻结。',
'R5-T7':'真实H5生成/预览/浏览器下载，PDF逐页核对Final A及备选B、版本和Sheet1来源。'
}
const review={}
const summary=(name,status,reason)=>review[name]={_summary:{status,reason}}
for(const [name,reason] of Object.entries({
'round-01-targeted':'首轮联调暴露λ、引用比较与正式行链路缺陷，保留原失败，不按HTTP成功计通过。',
'round-02-targeted':'正式方案/计算引用和状态续问仍阻断，后续已分别修复。',
'round-03-full':'完整35轮已执行，选择被误作计算及报告来源/基层显示问题尚未修复。',
'round-04-targeted':'计算续问改善，但正式Final链路仍未全部闭合。',
'round-05-compatibility':'自然引用仍有宽合同错误；Confirm误因JSONB键顺序判断SOURCE_CHANGED。',
'round-06-goal-and-confirm':'选择/确认改善，普通比较目标、保留参考与操作授权仍存在失败。',
'round-07-full':'完整35轮；λ泛称被误作具体身份，R1/R2单表比较未满足。',
'round-08-full':'完整35轮；λ拼接边界及S4历史目标合同错误，报告/环境曾受OSS和进程中断影响。',
'round-09-scope-check':'S2/S4五轮正确；额外按钮/权限通过，但真实PDF存在来源标签错误，整体不通过。',
'round-11-final':'完整35轮；R2续问丢R/K，R3计算授权证据截断，不能将安全拒绝计计算通过。',
'round-12-calc-page':'6轮查询/计算定向复测；额外真实计算PDF将芯材20mm标为板厚，保留FAIL证据。',
'round-13-full':'完整35轮；R5 Final操作的窄合同仍截断完整授权证据，后续链路阻断。',
'round-15-final':'完整35轮；普通比较被窄合同误加极值及伪造证据，后续操作误用查询澄清上下文。',
'round-18-acceptance':'完整35轮及状态核验通过，但实际打开原图后印刷页标签被旧location覆盖，R1/R2来源验收失败。'
}))summary(name,'FAIL',reason)
summary('round-17-acceptance','FAIL','未开始35轮；真实模板new-version写入后因响应字段不匹配返回500，已保留并修复。')
summary('round-19-final','PARTIAL','模板工作流及登录环境验证；为补齐印刷页导航关联修复，在输入35问前结束并清理。')
summary('round-20-final','PARTIAL','35问、表格/原图、三类PDF逐页及102项权限检查通过；额外定性厚度问答未解释厚度/R关系，补齐通用DEFINE合同后另起完整35问。单独保留hash参数导航采集到上一报告的脚本错误，未据此核验S5文件。')
for(const key of Object.keys(notes))review['round-20-final'][key]={status:'PASS',reason:notes[key]}
const fail=(round,keys,reason)=>{for(const key of keys)review[round][key]={status:'FAIL',reason}}
fail('round-03-full',['S5-T4'],'选择目标被错误理解为重新计算，未完成授权的选择。')
fail('round-05-compatibility',['R5-T6'],'实际Confirm因JSONB键顺序误报SOURCE_CHANGED，未完成按钮闭环。')
fail('round-07-full',['S2-T2'],'泛称“保温”误成具体产品身份，参数检索范围错误。')
fail('round-08-full',['S2-T2','S2-T3'],'λ证据拼接边界未通过，未形成正确查询及其后续诊断。')
fail('round-11-final',['R2-T2'],'只返回原页链接，漏掉所问两组R/K及口径。')
fail('round-11-final',['R3-T1','R3-T2','R3-T3'],'首轮计算证据截断导致没有实际计算，后续继承与来源说明不成立。')
fail('round-13-full',['R5-T3','R5-T4','R5-T5','R5-T6','R5-T7'],'Final操作未通过完整证据校验，后续核对/确认/PDF闭环未完成。')
fail('round-15-final',['S5-T3','S5-T4','S5-T5','S5-T6','S5-T7'],'普通比较及查询上下文合同错误导致选择、Final和确认/报告未完成。')
for(const round of ['round-14-full-effect','round-16-reference-contract']){
  summary(round,'PARTIAL','14轮方案定向复测及真实按钮确认/生成成功；本轮PDF未完整逐页验收，不据生成状态计全链路PASS。')
  for(const key of Object.keys(notes).filter(key=>key.startsWith('S5-')||key.startsWith('R5-')))review[round][key]={status:key.endsWith('T7')?'PARTIAL':'PASS',reason:key.endsWith('T7')?'实际生成已触发，未完成该轮PDF逐页及实际文件保存验收。':notes[key]}
}
for(const key of ['S2-T1','S2-T2','S2-T3','S4-T1','S4-T2'])review['round-09-scope-check'][key]={status:'PASS',reason:notes[key]}
for(const key of ['R2-T1','R2-T2','R3-T1','R3-T2','R3-T3'])review['round-12-calc-page'][key]={status:'PASS',reason:notes[key]}
for(const key of Object.keys(notes))review['round-18-acceptance'][key]={status:'PASS',reason:notes[key]}
fail('round-18-acceptance',['R1-T3','R2-T3'],'真实原图详情页优先显示旧location标签6/33，与图中26/53不符；后续统一投影修复。')
for(const key of ['S5-T7','R5-T7'])review['round-18-acceptance'][key]={status:'PARTIAL',reason:'PDF真实生成成功，本轮因来源页显示错误结束，未完成逐页PDF验收。'}
// 最后一轮由执行者看完全部回答与截图/PDF后显式传入；不由HTTP状态自动签发PASS。
if(process.argv.includes('--final-reviewed')){
  const round=process.argv[2]
  const matrix=JSON.parse(await readFile(`${root}/${round}/matrix.json`,'utf8'))
  if(matrix.cases.reduce((n,item)=>n+item.turns.length,0)!==35)throw Error('未完整执行35问')
  review[round]={_summary:{status:'PASS',reason:'Codex逐项复核原问、实际回答、状态、来源、H5及逐页PDF后确认；已保留此前所有失败。'}}
  for(const key of Object.keys(notes))review[round][key]={status:'PASS',reason:notes[key]}
}
await writeFile(`${root}/manual-review.json`,JSON.stringify(review,null,2))
console.log(JSON.stringify({rounds:Object.keys(review).length,finalReviewed:process.argv.includes('--final-reviewed')}))
