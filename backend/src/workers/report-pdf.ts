import { chromium } from "playwright-core";
import { AppError } from "../shared/errors.js";
import { escapeHtml } from "../modules/reports/report-template-render.js";

export type ReportPdfOptions = { executablePath?: string; image?: boolean; checkChineseFonts?: boolean; headerText?: string; footerText?: string; onStage?: (stage: string) => void };
const pdfError = (code: string, message: string) => new AppError(code, message, 500, { errorCode: code });
async function boundedPdf<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([operation, new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(pdfError("REPORT_PDF_RENDER_TIMEOUT", "报告PDF渲染超时，请按原快照重试。")), 60_000);
  })]); } finally { clearTimeout(timer!); }
}

/** 现有Chromium导出路径；网络全部拦截，正式报告仅需PDF。 */
export async function renderReportPdf(html: string, options: ReportPdfOptions) {
  if (!options.executablePath) throw pdfError("REPORT_CHROMIUM_NOT_CONFIGURED", "未配置 Chromium 可执行路径，无法生成 PDF。");
  options.onStage?.("CHROMIUM_LAUNCH");
  const browser = await chromium.launch({ executablePath: options.executablePath, headless: true })
    .catch(() => { throw pdfError("REPORT_CHROMIUM_LAUNCH_FAILED", "Chromium 启动失败，请检查路径、运行权限及系统依赖。"); });
  try {
    options.onStage?.("HTML_LOAD");
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1240, height: 1754 } });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    if (options.checkChineseFonts) {
      options.onStage?.("FONT_CHECK");
      // document.fonts.check会接受系统回退，额外比较两种基准字体以确认已安装中文字体。
      const font = await page.evaluate(`(() => {
        const canvas = document.createElement('canvas'); const c = canvas.getContext('2d');
        const sample = '蓝格建筑节能方案测试Mwm123';
        const width = family => { c.font = '16px ' + family; return c.measureText(sample).width; };
        return ['Microsoft YaHei','Noto Sans CJK SC','Noto Sans SC','SimSun','WenQuanYi Zen Hei'].find(family =>
          ['monospace','serif'].some(base => width('"' + family + '",' + base) !== width(base))) || null;
      })()`);
      if (!font) throw pdfError("REPORT_CHINESE_FONT_UNAVAILABLE", "未检测到可用中文字体，请安装微软雅黑、思源黑体或宋体后重试。");
      // JavaScript禁用的页面不等待DOM事件/Promise；仅通过同步CDP评估设置已核验系统字体。
      await page.evaluate(`document.body.style.fontFamily = ${JSON.stringify(`"${font}",sans-serif`)}`);
    }
    options.onStage?.("PDF_PRINT");
    const pdf = await boundedPdf(page.pdf({ format: "A4", printBackground: true, displayHeaderFooter: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
      headerTemplate: `<div style="width:100%;font-size:8px;padding:0 16mm;color:#64748b">${escapeHtml(options.headerText ?? "蓝格智配 · 工程方案")}</div>`,
      footerTemplate: `<div style="width:100%;font-size:8px;padding:0 16mm;color:#64748b">${escapeHtml(options.footerText ?? "方案事实冻结 · 需经专业审核")} <span style="float:right">第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</span></div>` }));
    const image = options.image ? await page.screenshot({ fullPage: true, type: "png" }) : undefined;
    return { pdf, image };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw pdfError("REPORT_PDF_RENDER_FAILED", "报告 PDF 渲染失败，请检查模板内容与浏览器运行状态。");
  } finally {
    options.onStage?.("CHROMIUM_CLOSE");
    await browser.close();
  }
}
