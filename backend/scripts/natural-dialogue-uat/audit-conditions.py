from pathlib import Path
import json,hashlib,operator,sys
p=Path(sys.argv[1]);ops={'EXACT':operator.eq,'LT':operator.lt,'LTE':operator.le,'GT':operator.gt,'GTE':operator.ge};out={'parameterExecutions':[],'productFilters':[]}
for l in (p/'parameters.ndjson').read_text(encoding='utf-8-sig').splitlines():
 r=json.loads(l);q=r['query'];bad=[f for f in r['facts'] if q['operator'] in ops and not ops[q['operator']](f['value'],q['targetValue'])]
 out['parameterExecutions'].append({'query':q,'returned':len(r['facts']),'violations':len(bad),'identityCount':r['diagnostics']['identityCount']})
for name in ['product-chain.json','exploration.json','repeat-product/exploration.json']:
 if not (p/name).is_file():continue
 for t in json.loads((p/name).read_text(encoding='utf-8-sig'))['turns']:
  facts=t['metadata']['backendDecision'].get('productAnswerFacts',{});f=facts.get('parameterFilter')
  if f:
   attrs=[a for item in facts.get('knowledgeItems',[]) for a in item['attributes'] if a['key']==f['field']];bad=[a for a in attrs if f['operator'] in ops and not ops[f['operator']](a['value'],f['targetValue'])]
   out['productFilters'].append({'question':t['question'],'filter':f,'values':[a['value'] for a in attrs],'violations':len(bad)})
m=json.loads((p/'matrix.json').read_text(encoding='utf-8-sig'));assert m['userTurns']==35
frozen=Path('C:/Users/admin/xwechat_files/zhai579670_8a65/msg/file/2026-10/小格AI阶段03修复交接包-v3/03-AI修复交接/baseline/frozen-scenarios.json');sha=hashlib.sha256(frozen.read_bytes()).hexdigest();assert sha=='59f1de38bfb5d48bb9fb4207e4e1b48175342f52b7fe201bc7fcecbe35342857'
a=json.loads(frozen.read_text(encoding='utf-8-sig'));assert [(c['id'],c['prompts']) for c in a['cases']]==[(c['id'],c['prompts']) for c in m['cases']];out['frozenPromptsUnchanged']=True
last=json.loads((p/'S3-T3.backend.json').read_text(encoding='utf-8-sig'));cid=next(c['conversationId'] for c in m['cases'] if c['id']=='S3');state=next(s for s in last['states'] if s['conversation_id']==cid);out['S3FinalQuery']=state['task_state_json'].get('confirmedPageLookup',{}).get('query');assert out['S3FinalQuery']['specClass']=='III';assert out['S3FinalQuery']['filters'][0]['targetValue']==.3
out['runtimeDrift']=[x['path'] for x in json.loads((p/'source-manifest.json').read_text(encoding='utf-8-sig')) if hashlib.sha256(Path(x['path']).read_bytes()).hexdigest().upper()!=x['sha256'].upper()]
frozen_paths={Path(x['path']).resolve() for x in json.loads((p/'source-manifest.json').read_text(encoding='utf-8-sig'))}
actual_paths={x.resolve() for x in (Path(__file__).resolve().parents[2]/'src').rglob('*') if x.is_file()}
out['runtimeAddedOrRemoved']=[str(x) for x in frozen_paths.symmetric_difference(actual_paths)]
assert not any(x['violations'] for x in out['parameterExecutions']+out['productFilters']);assert not out['runtimeDrift'];assert not out['runtimeAddedOrRemoved']
(p/'independent-condition-audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'parameterExecutions':len(out['parameterExecutions']),'productFilters':len(out['productFilters']),'valueViolations':0,'runtimeDrift':0,'frozenPromptsUnchanged':True}))
