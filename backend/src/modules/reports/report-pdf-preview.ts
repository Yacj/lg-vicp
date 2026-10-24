import { createHash } from "node:crypto";
import { BusinessError, NotFoundError, TooManyRequestsError } from "../../shared/errors.js";
import { renderPdfPagesInWorker } from "../../workers/pdf-page-renderer.js";

let activePreviews = 0;
/** 仅渲染已获授权的实际PDF字节；不读产品、模型、最新规则或报告正文重建页面。 */
export async function renderReportPdfPreview(loadPdf: () => Promise<Buffer>, pageNumber: number) {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new NotFoundError("报告页码不存在");
  if (activePreviews >= 2) throw new TooManyRequestsError("正在加载报告页面，请稍后重试");
  activePreviews++;
  try {
    const data = await loadPdf();
    if (data.length > 40 * 1024 * 1024) throw new BusinessError("这份PDF较大，请下载后查看");
    const pdfSha256 = createHash("sha256").update(data).digest("hex");
    let png: Buffer | undefined;
    const result = await renderPdfPagesInWorker(data, {
      dpi: 120, timeoutMs: 30_000, format: "png", shouldSkip: page => page !== pageNumber,
      onPageRendered: async page => { png = page.data; }
    });
    if (pageNumber > result.totalPages) throw new NotFoundError("报告页码不存在");
    if (!png || result.failed.length) throw new BusinessError("这页暂时无法显示，请重试或下载PDF查看");
    return { pageNumber, pageCount: result.totalPages, imageDataUrl: `data:image/png;base64,${png.toString("base64")}`, pdfSha256 };
  } finally { activePreviews--; }
}
