from pathlib import Path
import json, shutil, tempfile, hashlib
ROOT = Path('D:/work/lg-vicp')
OUT = ROOT / 'backend/docs/ai/evidence/full-chain-uat-2026-10-19'
OUT.mkdir(exist_ok=True)
source = ROOT / 'backend/docs/ai/evidence/phase04-retest-2026-10-19/h5-run-02/server.mts'
code = source.read_text(encoding='utf-8-sig')
old_directory = 'D:/work/lg-vicp/backend/docs/ai/evidence/phase04-retest-2026-10-19/h5-run-02'
code = code.replace(old_directory, OUT.as_posix())
code = code.replace('vicp-phase04-private-login.json', 'vicp-final-uat-private-login.json').replace('port:3319', 'port:3329')
code = code.replace('select id,mode,result_json from thermal_calc_records', 'select id,mode,input_json,result_json from thermal_calc_records')
(OUT / 'server.mts').write_text(code, encoding='utf-8')
shadow = Path(tempfile.gettempdir()) / 'vicp-final-uat-h5'
if not shadow.exists():
    shutil.copytree(ROOT / 'app', shadow, ignore=shutil.ignore_patterns('node_modules', 'dist', '.git', '.audit', 'unpackage', 'app.zip'))
(shadow / 'env').mkdir(exist_ok=True)
for mode in ['development', 'production']:
    values = 'VITE_API_BASE_URL=http://127.0.0.1:3329\nVITE_ENABLE_API_MOCK=false\n'
    (shadow / 'env' / f'.env.{mode}.local').write_text(values, encoding='utf-8')
    (shadow / f'.env.{mode}.local').write_text(values, encoding='utf-8')
(OUT / 'preparation.json').write_text(json.dumps({'sourceHarness':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'shadowApp':str(shadow),'api':'http://127.0.0.1:3329','h5':'http://127.0.0.1:8889','sourceMode':'READ_ONLY','syntheticEngineeringData':False},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'prepared':str(OUT),'shadowApp':str(shadow)},ensure_ascii=False))
