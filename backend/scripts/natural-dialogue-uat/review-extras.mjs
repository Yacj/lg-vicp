import { readFile, writeFile } from 'node:fs/promises'
const root='docs/ai/evidence/natural-dialogue-repair-2026-10-20'
const final=`${root}/round-22-final`
const records=[]
const four=JSON.parse(await readFile(`${final}/four-original-cases.json`,'utf8'))
for(const c of four.cases) for(const [i,t] of c.turns.entries())records.push({key:`${c.key}-T${i+1}`,question:t.prompt,status:'PASS',
  reason:c.key==='G1'?'知识库产品范围与参数来源可核对，没有用一条目录SKU代替全部产品。':c.key==='G4'?'指标/热阻口径缺项分别说明，保留原始0.2。':'保留原始数值、比较符与未知名称；未删除名称后宽查或返回越界材料。',evidence:`${c.key}-T${i+1}.sse.txt`})
for(const [file,prefix] of [['product-chain.json','P1'],['parameter-continuation.json','P2']]){
  let p=file
  // File names are explicit in the execution helper; no raw result is changed.
  if(prefix==='P2')p='parameter-followups.json'
  const candidates=prefix==='P2'?['parameter-followups.json','parameter-chain.json','parameter-continuation.json','parameter-refinement.json']:['product-chain.json']
  let data
  for(const name of candidates){try{data=JSON.parse(await readFile(`${final}/${name}`,'utf8'));p=name;break}catch{}}
  if(!data)throw Error(`Missing actual ${prefix} result`)
  for(const [i,t] of data.turns.entries())records.push({key:`${prefix}-T${i+1}`,question:t.question,status:prefix==='P1'&&i===0?'PARTIAL':'PASS',
    reason:prefix==='P1'&&i===0?'简介仍以资料条目和参数类别为主，归属表达欠清晰；准确性检查通过不等于客服表达已通过。':prefix==='P1'?'产品身份、参数焦点与相同/更低范围保持，实际属性及来源满足筛选条件。':'逐字段修改数值/比较符；换话题后不将裸数值重新继承为旧λ查询。',evidence:`${prefix}-T${i+1}.sse.txt`})
}
for(const directory of ['', 'repeat-product/']){
 const data=JSON.parse(await readFile(`${final}/${directory}exploration.json`,'utf8'))
 for(const [i,t] of data.turns.entries())records.push({key:`${directory?'REPEAT-':''}E1-T${i+1}`,question:t.question,
   status:[1,4].includes(i)?'PARTIAL':'PASS',reason:[1,4].includes(i)?'产品范围和事实保持，但简介/改写仍有资料清单式回退，表达质量未完全通过。':i===3?'按当前产品解释λ并给出0.0025及正确材料层口径，不再落入整套热工DEFINE。':i>=5?'换到石墨聚苯板后沿用实际0.032/第50页；更低查询保持该焦点，未增加全库最低结论。':'参数存在与归属正确，没有把概览未展示值说成资料缺参。',
   evidence:`${directory}E1-T${i+1}.sse.txt`})
}
const counts=Object.fromEntries(['PASS','PARTIAL','FAIL'].map(s=>[s,records.filter(r=>r.status===s).length]))
await writeFile(`${final}/extra-business-review.json`,JSON.stringify({method:'同执行者逐轮阅读；非独立人工盲测；不改原始执行状态',counts,turns:records},null,2))
for(const [round,failures] of [['round-17-final',{1:'FAIL',3:'PARTIAL'}],['round-18-final',{3:'PARTIAL'}],['round-19-final',{0:'FAIL'}],['round-21-final',{0:'FAIL',1:'FAIL'}]]){
 const data=JSON.parse(await readFile(`${root}/${round}/exploration.json`,'utf8'))
 const rows=data.turns.map((t,i)=>({key:`E1-T${i+1}`,question:t.question,status:failures[i]||'PASS',
   reason:failures[i]?i===3?'参数含义续问误落热工公式说明。':round==='round-19-final'?'将未展示数值说成资料未给，事实表达错误。':round==='round-21-final'?'含无独立证据的芯材/机制推断或内部核验措辞，保留失败证据。':'要求简单表达却重新询问参数名，未完成改写目标。':'实际参数、来源与产品连续目标核对。',evidence:`E1-T${i+1}.sse.txt`}))
 await writeFile(`${root}/${round}/exploration-business-review.json`,JSON.stringify({reviewer:'同执行者，非盲测',turns:rows},null,2))
}
console.log(JSON.stringify({additionalTurns:records.length,counts}))
