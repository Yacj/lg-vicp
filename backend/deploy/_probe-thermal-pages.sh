#!/bin/bash
set -euo pipefail
WORKDIR=$(mktemp -d /tmp/vicp-thermal-XXXXXX)
cp /tmp/thermal-calc.docx "$WORKDIR/input.docx"
echo "WORKDIR=$WORKDIR"
START=$(date +%s%3N)
export HOME="$WORKDIR"
soffice --headless --nologo --nofirststartwizard --norestore \
  -env:UserInstallation=file://$WORKDIR/lo-profile \
  --convert-to pdf --outdir "$WORKDIR" "$WORKDIR/input.docx"
END=$(date +%s%3N)
echo "convert_ms=$((END-START))"
ls -la "$WORKDIR"
PDF="$WORKDIR/input.pdf"
# page count + page sizes via unpdf
cd /www/wwwroot/lgapi.zblack.cn
node --input-type=module <<EOF
import { readFile } from "node:fs/promises";
import { installPdfRuntimeCompat } from "./dist/shared/runtime-compat.js";
installPdfRuntimeCompat();
const { getDocumentProxy } = await import("unpdf");
const data = new Uint8Array(await readFile("$PDF"));
const pdf = await getDocumentProxy(data);
console.log("numPages", pdf.numPages);
for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
  const page = await pdf.getPage(i);
  const v = page.getViewport({ scale: 1 });
  console.log("page", i, "w", Math.round(v.width), "h", Math.round(v.height));
  page.cleanup();
}
if (pdf.numPages > 8) {
  const page = await pdf.getPage(pdf.numPages);
  const v = page.getViewport({ scale: 1 });
  console.log("page", pdf.numPages, "w", Math.round(v.width), "h", Math.round(v.height));
  page.cleanup();
}
EOF

# render first 3 pages and time
START2=$(date +%s%3N)
cat > /www/wwwroot/lgapi.zblack.cn/_probe-worker-render.mjs <<'MJS'
import { readFile, writeFile } from "node:fs/promises";
import { renderPdfPagesInWorker } from "./dist/workers/pdf-page-renderer.js";
const pdfPath = process.argv[2];
const outDir = process.argv[3];
const maxPages = Number(process.argv[4] || 3);
const data = await readFile(pdfPath);
let done = 0;
const outcome = await renderPdfPagesInWorker(data, {
  dpi: 130,
  format: "png",
  shouldSkip: (n) => n > maxPages,
  onPageRendered: async ({ pageNumber, data: image }) => {
    await writeFile(`${outDir}/p${pageNumber}.png`, image);
    console.log("rendered", pageNumber, "bytes", image.byteLength);
    done += 1;
  }
});
console.log("outcome", JSON.stringify(outcome), "done", done);
MJS
node /www/wwwroot/lgapi.zblack.cn/_probe-worker-render.mjs "$PDF" "$WORKDIR" 4
END2=$(date +%s%3N)
echo "render_first4_ms=$((END2-START2))"
ls -la "$WORKDIR"/p*.png
echo "OUT=$WORKDIR"
