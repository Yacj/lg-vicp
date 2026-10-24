"""只读提取客户DOCX的原始表头，供确认快照显示投影逐页核对。"""
from pathlib import Path
import hashlib,json,xml.etree.ElementTree as E,zipfile
package=Path('C:/Users/admin/xwechat_files/zhai579670_8a65/msg/file/2026-10/小格AI阶段03修复交接包-v3/03-AI修复交接')
source=package/'attachments/知识库.docx'
out=Path('docs/ai/evidence/table-header-repair-2026-10-19')
out.mkdir(parents=True,exist_ok=True)
raw=source.read_bytes()
assert hashlib.sha256(raw).hexdigest()=='c6da4d241fa819647f9fcdd3575909ddff39340ad8e839692ad84a4ad593a919'
with zipfile.ZipFile(source) as archive:
 root=E.fromstring(archive.read('word/document.xml'))
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
tables=[]
for index,table in enumerate(root.findall('.//w:body/w:tbl',ns),1):
 rows=[[ ''.join(t.text or '' for t in cell.findall('.//w:t',ns)) for cell in row.findall('w:tc',ns)] for row in table.findall('w:tr',ns)[:3]]
 tables.append({'table':index,'title':rows[0][0],'headerRows':rows[1:]})
result={'docxSha256':hashlib.sha256(raw).hexdigest(),'tables':tables}
(out/'docx-headers.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
shapes={json.dumps(t['headerRows'],ensure_ascii=False) for t in tables}
print(json.dumps({'tables':len(tables),'distinctHeaderLayouts':len(shapes),'output':str(out/'docx-headers.json')},ensure_ascii=False))
