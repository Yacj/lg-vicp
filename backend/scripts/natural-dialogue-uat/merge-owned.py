"""Merge only the audited manifest; refuse concurrent edits in the destination."""
from pathlib import Path
import hashlib, json, shutil

root = Path(__file__).resolve().parents[2]
target = Path('D:/work/lg-vicp/backend')
evidence = root / 'docs/ai/evidence/natural-dialogue-repair-2026-10-20'
manifest_path = evidence / 'change-manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
extra = ['src/modules/ai/source-query-binding.test.ts', 'src/modules/ai/product-continuation-review.ts', 'src/modules/ai/product-continuation-review.test.ts',
         'src/modules/ai/solution-unchanged-answer.ts', 'src/modules/ai/solution-unchanged-answer.test.ts']
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
by_path = {entry['path']: entry for entry in manifest}
for relative in extra:
    if relative not in by_path:
        assert not (target / relative).exists(), f'Concurrent new file: {relative}'
        entry = dict(path=relative, type='ADDED', beforeSha256=None, afterSha256=None)
        manifest.append(entry)
        by_path[relative] = entry
for entry in manifest:
    relative = entry['path']
    source, destination = root / relative, target / relative
    assert source.is_file(), relative
    if destination.exists():
        assert sha(destination).lower() == (entry['afterSha256'] or '').lower(), f'Concurrent edit: {relative}'
    else:
        assert entry['type'] == 'ADDED', f'Missing original: {relative}'
for entry in manifest:
    source, destination = root / entry['path'], target / entry['path']
    if not destination.exists() or sha(source) != sha(destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    entry['afterSha256'] = sha(source)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(files=len(manifest), concurrentChanges=0)))
