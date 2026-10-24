"""Independent source/formula and downloaded PDF checks; no business writes."""
from pathlib import Path
import json, sys, hashlib, math
from pypdf import PdfReader

p = Path(sys.argv[1])
read = lambda name: json.loads((p / name).read_text(encoding='utf-8-sig'))
state, matrix, flow = read('final-backend.json'), read('matrix.json'), read('single-flow.json')
case = next(c for c in matrix['cases'] if c['id'] == 'S5')
authorized = {case['conversationId'], flow['conversationId']}
confirmed = [s for s in state['solutions'] if s.get('confirmed_snapshot_id')]
assert all(s['conversation_id'] in authorized for s in confirmed)
assert state['snapshotCount'] == len({s['confirmed_snapshot_id'] for s in confirmed})
assert all(r['conversation_id'] in authorized for r in state['reports'])
query_state = read('S5-T2.backend.json')
task = next(s['task_state_json'] for s in query_state['states'] if s['conversation_id'] == case['conversationId'])
lookup = task.get('lastReferenceLookup')
source_checks = {'executed': bool(lookup and lookup.get('candidates'))}
if source_checks['executed']:
    query = lookup['query']
    assert query['substrateMaterial'] == '钢筋混凝土' and query['substrateThickness'] == 200
    assert query['referenceSetIds']
    for candidate in lookup['candidates']:
        assert candidate['substrateMaterial'] == query['substrateMaterial']
        assert candidate['substrateThickness'] == query['substrateThickness']
        assert candidate['setId'] in query['referenceSetIds'] and candidate['evidenceRef'] == 'Sheet1'
        assert candidate['publishedReferenceSource']['setId'] == candidate['setId']
    source_checks.update(candidates=len(lookup['candidates']), sourceIds=query['referenceSetIds'], scopePreserved=True)

fixture = json.loads(Path('fixtures/thermal-regression/vicp-sheet-layered.json').read_text(encoding='utf-8-sig'))
calculations = []
for actual in state['calculations']:
    thickness = actual['input_json']['thicknessMm']
    assert thickness in (15, 20)
    total = fixture['rules']['interiorSurfaceResistance'] + fixture['rules']['exteriorSurfaceResistance']
    core = 0
    for layer in fixture['layers']:
        delta = thickness / 1000 if layer['layerType'] == 'PRODUCT_LAYER' else layer['thicknessM']
        r = delta / (layer['lambda'] * layer['correctionFactor'])
        total += r
        if layer['layerType'] == 'PRODUCT_LAYER': core += r
    result = actual['result_json']
    assert math.isclose(result['totalResistance'], total, abs_tol=1e-10)
    assert math.isclose(result['kValue'], 1 / total, abs_tol=1e-10)
    assert math.isclose(result['productResistance'], core, abs_tol=1e-10)
    assert result['productResistanceScope'] == 'PRODUCT_LAYER_ROWS_ONLY' and result['compliant'] is None
    calculations.append(dict(thicknessMm=thickness, coreR=core, totalR=total, k=1/total, source='客户分层公式fixture；芯材口径，非完整产品R'))
assert sorted(c['thicknessMm'] for c in calculations) == [15, 20]

pdf_path = p / 'real-h5-preview.pdf'
reader = PdfReader(pdf_path)
text = '\n'.join(page.extract_text() or '' for page in reader.pages)
(p / 'actual-pdf-text.txt').write_text(text, encoding='utf-8')
snapshot = next(step for step in flow['steps'] if step['name'] == 'CONFIRM')['result']['data']['snapshot']
assert snapshot['id'] == flow['snapshotId']
assert len(snapshot['payload']['candidates']) == 1 and not snapshot['payload']['alternatives']
candidate = snapshot['payload']['candidates'][0]
required = [flow['snapshotId'], candidate['specCode'], 'Sheet1', str(candidate['kValue']), str(candidate['totalThermalResistance'])]
missing = [value for value in required if value not in text]
assert not missing, missing
sha = lambda name: hashlib.sha256((p/name).read_bytes()).hexdigest()
assert sha('real-h5-preview.pdf') == sha('real-h5-download.pdf') == sha('real-browser-download.pdf')
placeholder = '免责声明正式措辞待甲方确认' in ''.join(text.split())
out = dict(sourceQuery=source_checks, calculations=calculations,
    mutationAudit=dict(snapshotCount=state['snapshotCount'],reports=len(state['reports']),onlyExplicitH5Conversations=True),
    pdf=dict(pages=len(reader.pages), snapshotMatches=True, missingRequiredText=missing,
             sha256=sha('real-h5-preview.pdf'), downloadBytesMatch=True, internalPlaceholderPresent=placeholder,
             status='PARTIAL' if placeholder else 'PASS', visualReview='另见实际PDF逐页渲染及人工检查'))
(p/'independent-artifact-audit.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(sourceScope=source_checks['executed'], calculations=len(calculations), pdfPages=len(reader.pages), pdfStatus=out['pdf']['status'])))
