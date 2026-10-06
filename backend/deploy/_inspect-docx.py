from pathlib import Path
import re

xml = Path(r"D:\work\lg-vicp\backend\deploy\_samples\docx-unzip\out\word\document.xml").read_text(encoding="utf-8")
print("size", len(xml))
print("tables", xml.count("<w:tbl"))
print("rows", xml.count("<w:tr"))
print("sectPr", xml.count("<w:sectPr"))
for m in re.finditer(r"<w:pgSz[^/]*/>", xml):
    print("pgSz", m.group(0))
for m in re.finditer(r"<w:pgMar[^/]*/>", xml):
    print("pgMar", m.group(0)[:200])
print("page_br", xml.count('w:type="page"'))
print("lastRenderedPageBreak", xml.count("lastRenderedPageBreak"))
# twips to mm: /56.7 approx
for m in re.finditer(r'<w:pgSz[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"', xml):
    w, h = int(m.group(1)), int(m.group(2))
    print(f"page_mm {w/56.7:.1f}x{h/56.7:.1f} ({w}x{h} twips)")
for m in re.finditer(r'<w:pgSz[^>]*w:h="(\d+)"[^>]*w:w="(\d+)"', xml):
    h, w = int(m.group(1)), int(m.group(2))
    print(f"page_mm_alt {w/56.7:.1f}x{h/56.7:.1f}")
