from pathlib import Path
import shutil,hashlib,json
root=Path(__file__).resolve().parents[2]
main=Path('D:/work/lg-vicp/backend')
paths=['docs/ai/natural-dialogue-repair-2026-10-20.md','docs/ai/evidence/natural-dialogue-repair-2026-10-20','scripts/natural-dialogue-uat']
planned=[]
for relative in paths:
    source=root/relative
    for p in ([source] if source.is_file() else [x for x in source.rglob('*') if x.is_file() and '__pycache__' not in x.parts]):
        target=main/p.relative_to(root)
        if target.exists():
            assert hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256(target.read_bytes()).digest(), f'Existing delivery file differs: {target}'
        planned.append((p,target))
for source,target in planned:
    target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists():shutil.copyfile(source,target)
assert all(hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256(t.read_bytes()).digest() for p,t in planned)
print(json.dumps(dict(copiedFiles=len(planned),bytes=sum(p.stat().st_size for p,t in planned),verified=True)))
