import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { getObservation, closeObservation } from './observation.mjs?business-v1'
const out=process.argv[2]
const matrix=JSON.parse(await readFile(`${out}/matrix.json`,'utf8'))
const cases=Object.fromEntries(matrix.cases.map(item=>[item.id,item]))
const result={at:new Date().toISOString(),checks:[],note:'以会话和显式UI动作归属核对写入；全局delta可能包含前一会话已点击报告按钮的异步完成，不能把它误判成当前查表自动生成报告。'}
function check(name,fn){fn();result.checks.push({name,status:'PASS'})}
try {
  const state=await getObservation()
  check('ORIGINAL_35_COMPLETED',()=>assert.equal(matrix.cases.reduce((n,item)=>n+item.turns.length,0),35))
  check('CHAT_DID_NOT_AUTO_CONFIRM_OR_REPORT',()=>{for(const item of matrix.cases)for(const turn of item.turns){assert.equal(turn.backendDecision?.reportQueued,false);assert.equal(turn.snapshotsDelta,0)}})
  for(const key of ['S5','R5']) {
    const snapshot=state.snapshots.find(row=>row.conversation_id===cases[key].conversationId)
    check(`${key}_FROZEN_FINAL`,()=>{
      assert.ok(snapshot);assert.equal(snapshot.payload.finalCandidateIds.length,1)
      const final=snapshot.payload.candidates.find(row=>row.candidateId===snapshot.payload.finalCandidateIds[0])
      assert.equal(final.constructionCode,'VICP-OVERALL');assert.equal(final.thicknessMm,25);assert.equal(final.kValue,.2322)
      assert.ok(final.publishedReferenceSource);assert.equal(final.evidenceRef,'Sheet1')
      assert.equal(snapshot.payload.alternatives.length,key==='R5'?1:0)
      if(key==='R5')assert.equal(snapshot.payload.alternatives[0].constructionCode,'VICP-LAYERED')
    })
    check(`${key}_ACTUAL_REPORT_READY`,()=>{
      const reports=state.reports.filter(row=>row.conversation_id===cases[key].conversationId)
      assert.equal(reports.length,1);assert.equal(reports[0].status,'READY')
    })
  }
  check('OTHER_READ_ONLY_CONVERSATIONS_NO_SNAPSHOT_OR_REPORT',()=>{
    const allowed=new Set([cases.S5.conversationId,cases.R5.conversationId])
    assert.ok(state.snapshots.every(row=>allowed.has(row.conversation_id)))
    assert.ok(state.reports.every(row=>allowed.has(row.conversation_id)))
  })
  check('FORMAL_CALCULATION_ONLY_15_AND_20',()=>{
    assert.equal(state.calculations.length,2)
    const records=[...state.calculations].sort((a,b)=>a.input_json.thicknessMm-b.input_json.thicknessMm)
    assert.deepEqual(records.map(row=>row.input_json.thicknessMm),[15,20])
    const {thicknessMm:a,...first}=records[0].input_json,{thicknessMm:b,...second}=records[1].input_json
    assert.deepEqual(first,second)
    assert.equal(records[0].result_json.productResistance,4.8)
    assert.equal(records[0].result_json.totalResistance,5.3068220978349885)
    assert.equal(records[0].result_json.kValue,.18843669178357564)
    assert.ok(Math.abs(records[1].result_json.kValue-.14478438648556763)<1e-14)
    assert.ok(records.every(row=>row.mode==='LAYERED'&&row.result_json.valid&&row.result_json.productResistanceScope==='PRODUCT_LAYER_ROWS_ONLY'&&row.result_json.compliant===null))
  })
  const snapshots=await Promise.all([1,2].map(turn=>readFile(`${out}/R3-T${turn}.backend.json`,'utf8').then(JSON.parse)))
  const candidates=snapshots.map(item=>item.states.find(row=>row.conversation_id===cases.R3.conversationId).task_state_json.lastReferenceLookup.candidates[0])
  check('EIGHT_FROZEN_LAYERS_EXCEPT_CORE_UNCHANGED',()=>{
    const [a,b]=candidates.map(candidate=>candidate.provenanceSnapshot.layers)
    assert.equal(a.length,8);assert.equal(b.length,8)
    for(let i=0;i<a.length;i++)if(a[i].layerType==='PRODUCT_LAYER'){
      assert.equal(a[i].thicknessM,.015);assert.equal(b[i].thicknessM,.02)
      const {thicknessM:x,...first}=a[i],{thicknessM:y,...second}=b[i];assert.deepEqual(first,second)
    }else assert.deepEqual(a[i],b[i])
  })
  const upstream=JSON.parse(await readFile(`${out}/upstream-requests.json`,'utf8'))
  check('APPROVED_MODEL_AND_SUPPORTED_JSON_FORMAT',()=>{
    assert.ok(upstream.some(row=>row.responseFormat?.type==='json_object'))
    assert.ok(upstream.every(row=>!row.model||row.model==='deepseek-chat'))
    assert.ok(upstream.every(row=>!row.responseFormat?.schemaPresent))
  })
  result.status='PASS';await writeFile(`${out}/business-state-verification.json`,JSON.stringify(result,null,2))
  console.log(JSON.stringify({status:result.status,checks:result.checks.length}))
}finally{await closeObservation()}
