from pathlib import Path
import hashlib, json, xml.etree.ElementTree as E, zipfile
import pypdfium2 as pdfium
from pypdf import PdfReader
root=Path('docs/ai/evidence/full-chain-uat-2026-10-19')
source=Path('C:/Users/admin/xwechat_files/zhai579670_8a65/msg/file/2026-10/小格AI阶段03修复交接包-v3/03-AI修复交接/attachments/知识库.docx')
assert hashlib.sha256(source.read_bytes()).hexdigest()=='c6da4d241fa819647f9fcdd3575909ddff39340ad8e839692ad84a4ad593a919'
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with zipfile.ZipFile(source) as archive: xml=E.fromstring(archive.read('word/document.xml'))
records=[]
for index,table in enumerate(xml.findall('.//w:body/w:tbl',ns),1):
    tail=[[ ''.join(t.text or '' for t in cell.findall('.//w:t',ns)) for cell in row.findall('w:tc',ns)] for row in table.findall('w:tr',ns)[-2:]]
    records.append({'table':index,'tailRows':tail})
(root/'source-review/docx-footers.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf8')
pdf=root/'round-03-full/real-h5-preview.pdf'
reader=PdfReader(pdf)
text='\n\n'.join(page.extract_text() or '' for page in reader.pages)
(root/'round-03-full/pdf-text.txt').write_text(text,encoding='utf8')
doc=pdfium.PdfDocument(str(pdf))
for index in range(len(doc)):
    doc[index].render(scale=1.25).to_pil().save(root/f'round-03-full/pdf-page-{index+1}.png')
result={'pages':len(doc),'characters':len(text),'sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'imagePagesRendered':len(doc)}
(root/'round-03-full/pdf-inspection.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result))
print(json.dumps([record for record in records if record['table'] in [1,2,3,5,6,33,77,78,79]],ensure_ascii=False))
