from pathlib import Path
import json, hashlib

root = Path(__file__).resolve().parents[2]
main = Path('D:/work/lg-vicp/backend')
ev = root / 'docs/ai/evidence/natural-dialogue-repair-2026-10-20'
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = read(ev/'change-manifest.json')
owned = {'backend/'+x['path'] for x in manifest}
own_drift = [x['path'] for x in manifest if sha(root/x['path']) != x['afterSha256'] or sha(main/x['path']) != x['afterSha256']]
assert not own_drift
changed_other = [x['path'] for x in read(ev/'inherited-files.json')
                 if x['path'] not in owned and (not (main.parent/x['path']).exists() or sha(main.parent/x['path']).upper() != x['sha256'].upper())]
def runtime_diff(a, b):
    paths = {x.relative_to(a) for x in a.rglob('*') if x.is_file()} | {x.relative_to(b) for x in b.rglob('*') if x.is_file()}
    return [str(p) for p in sorted(paths) if not str(p).endswith('.d.ts') and
            (not (a/p).is_file() or not (b/p).is_file() or (a/p).read_bytes().replace(b'\r\n',b'\n') != (b/p).read_bytes().replace(b'\r\n',b'\n'))]
backend_drift = runtime_diff(root/'src', main/'src')
app_drift = runtime_diff(root.parent/'app/src', main.parent/'app/src')
app_formatting=[]
for relative in app_drift[:]:
    a,b=root.parent/'app/src'/relative,main.parent/'app/src'/relative
    if a.is_file() and b.is_file() and a.read_bytes().rstrip(b'\r\n')==b.read_bytes().rstrip(b'\r\n'):
        app_formatting.append(relative)
        app_drift.remove(relative)
cleanup=[]
for directory in sorted(ev.iterdir()):
    p=directory/'environment.json'
    if p.is_file():
        e=read(p); c=e.get('cleanup') or {}
        assert e.get('sourceBusinessWrites',0)==0
        assert c.get('databaseRemoved') is True and not c.get('failures'), directory.name
        cleanup.append(dict(round=directory.name, databaseRemoved=True, trackedObjects=c.get('trackedObjects'),failures=[]))
out=dict(status='NOT_READY', ownFiles=len(manifest),ownMainHashDrift=own_drift,
         backendRuntimeDifference=backend_drift,appRuntimeDifference=app_drift,
         appTrailingNewlineOnlyDifference=app_formatting,
         otherInitialFilesChanged=changed_other, otherChangesOverwritten=False,
         sourceBusinessWrites=0,productionDeploy=False,productionMigration=False,
         cleanup=cleanup,privateLoginRemoved=not Path('C:/Users/admin/AppData/Local/Temp/vicp-natural-dialogue-private-login.json').exists())
(ev/'delivery-integrity.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(ownFiles=len(manifest),ownDrift=len(own_drift),backendDrift=len(backend_drift),appDrift=len(app_drift),otherPreservedChanges=len(changed_other),cleanedRounds=len(cleanup),privateLoginRemoved=out['privateLoginRemoved'])))
