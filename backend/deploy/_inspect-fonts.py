from pathlib import Path
import re
from collections import Counter

root = Path(r"D:\work\lg-vicp\backend\deploy\_samples\docx-unzip\out\word")
xml = (root / "document.xml").read_text(encoding="utf-8")
fonts = Counter(re.findall(r'w:(?:eastAsia|ascii|hAnsi)="([^"]+)"', xml))
print("top fonts", fonts.most_common(25))
print("sectPr", xml.count("<w:sectPr"))
print("sect types", Counter(re.findall(r'<w:type w:val="([^"]+)"', xml)))
styles = (root / "styles.xml").read_text(encoding="utf-8") if (root / "styles.xml").exists() else ""
print("styles fonts", Counter(re.findall(r'w:(?:eastAsia|ascii|hAnsi)="([^"]+)"', styles)).most_common(15))
