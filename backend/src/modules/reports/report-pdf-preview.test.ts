import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({render:vi.fn()}));
vi.mock("../../workers/pdf-page-renderer.js",()=>({renderPdfPagesInWorker:m.render}));
import { renderReportPdfPreview } from "./report-pdf-preview.js";
beforeEach(()=>vi.resetAllMocks());
it("原PDF哈希在转移字节前冻结，只渲染请求的一页并保留总页数",async()=>{
 const bytes=Buffer.from("a frozen PDF"),hash=createHash("sha256").update(bytes).digest("hex");
 m.render.mockImplementation(async(_bytes,options)=>{
  expect(options.shouldSkip(1)).toBe(true);expect(options.shouldSkip(2)).toBe(false);expect(options.timeoutMs).toBe(30_000);
  await options.onPageRendered({pageNumber:2,data:Buffer.from("png")});return{totalPages:4,rendered:[2],failed:[]};
 });
 expect(await renderReportPdfPreview(async()=>bytes,2)).toEqual({pageNumber:2,pageCount:4,imageDataUrl:"data:image/png;base64,cG5n",pdfSha256:hash});
});
it("不存在的页或渲染失败不能伪装成空白成功页面",async()=>{
 m.render.mockResolvedValueOnce({totalPages:2,rendered:[],failed:[]});
 await expect(renderReportPdfPreview(async()=>Buffer.from("pdf"),3)).rejects.toMatchObject({statusCode:404});
 m.render.mockResolvedValueOnce({totalPages:2,rendered:[],failed:[{pageNumber:1,message:"render failed"}]});
 await expect(renderReportPdfPreview(async()=>Buffer.from("pdf"),1)).rejects.toThrow("暂时无法显示");
});
it("并发渲染达到上限时不启动额外Worker，完成后释放槽位",async()=>{
 const resolve:Array<()=>void>=[];
 m.render.mockImplementation((_b,options)=>new Promise(r=>resolve.push(async()=>{await options.onPageRendered({pageNumber:1,data:Buffer.from("png")});r({totalPages:1,rendered:[1],failed:[]});})));
 const one=renderReportPdfPreview(async()=>Buffer.from("1"),1),two=renderReportPdfPreview(async()=>Buffer.from("2"),1);
 await expect(renderReportPdfPreview(async()=>Buffer.from("3"),1)).rejects.toMatchObject({statusCode:429});
 for(const done of resolve)done();await Promise.all([one,two]);expect(m.render).toHaveBeenCalledTimes(2);
});
