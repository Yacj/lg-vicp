from pathlib import Path
import hashlib, json, sys
import pypdfium2 as pdfium
from pypdf import PdfReader
root = Path(sys.argv[1])
pdf = root / 'real-h5-preview.pdf'
reader = PdfReader(pdf)
text = '\n\n'.join(page.extract_text() or '' for page in reader.pages)
(root / 'pdf-text.txt').write_text(text, encoding='utf-8')
document = pdfium.PdfDocument(str(pdf))
for index in range(len(document)):
    document[index].render(scale=1.5).to_pil().save(root / f'pdf-page-{index+1}.png')
profile = sys.argv[2] if len(sys.argv) > 2 else 'published'
terms = (['VICP-LAYERED', 'Sheet1', 'VICP-CALC-1', '6.906822098', '0.1447843865', '6.4', '计算层厚度']
         if profile == 'calculated' else ['VICP-OVERALL', 'Sheet1', '4.3068', '0.2322', '已发布热工参考行值']
         if profile == 'published-single' else ['VICP-OVERALL', 'VICP-LAYERED', 'Sheet1', '4.3068', '5.3068', '0.2322', '0.1884', '已发布热工参考行值'])
checks = {term: term in text for term in terms}
checks['NO_INTERNAL_DISCLAIMER_PLACEHOLDER'] = '免责声明正式措辞待甲方确认' not in text
checks['APPROVED_DISCLAIMER'] = '工程结论应由专业人员复核' in text
if profile == 'calculated': checks['NO_CORE_AS_BOARD_THICKNESS'] = '板厚 mm：20' not in text
if profile == 'published-single': checks['NO_OTHER_SCHEME'] = 'VICP-LAYERED' not in text
result = {'profile': profile, 'pages': len(document), 'sha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'textChecks': checks, 'textFactsPassed': all(checks.values()), 'visualReview': 'PENDING', 'scope': '真实H5生成且实际签名下载的PDF；仍须逐页视觉核验'}
(root / 'pdf-inspection.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
