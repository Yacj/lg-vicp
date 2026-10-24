import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, reactive } from 'vue'
import { useReportPdfPages, type ReportPdfPage } from './useReportPdfPages'

const page = (n=1,hash='a'): ReportPdfPage => ({pageNumber:n,pageCount:3,imageDataUrl:'data:image/png;base64,cG5n',pdfSha256:hash})
const settle = async()=>{await nextTick();await Promise.resolve();await nextTick()}
test('关闭、换报告或切换账号时，迟到的页面不能恢复旧内容',async()=>{
 const context=reactive({visible:true,reportId:'a',userId:'u' as string|null}),scope=effectScope();
 const pending:Array<(p:ReportPdfPage)=>void>=[];
 const reader=scope.run(()=>useReportPdfPages(()=>context,()=>new Promise(resolve=>pending.push(resolve))))!;
 context.reportId='b';await settle();pending[1](page(1,'new'));await settle();pending[0](page(1,'old'));await settle();
 assert.equal(reader.page.value?.pdfSha256,'new');
 context.userId='other';await settle();context.visible=false;await settle();pending[2](page());await settle();
 assert.equal(reader.page.value,null);assert.equal(reader.loading.value,false);scope.stop();
});
test('跨页文件指纹变化拒绝混页；失败页重试保持请求页号',async()=>{
 const context=reactive({visible:true,reportId:'a',userId:'u'}),scope=effectScope(),calls:number[]=[];
 const reader=scope.run(()=>useReportPdfPages(()=>context,async(_id,n)=>{calls.push(n);return page(n,n===2?'changed':'a')}))!;
 await settle();await reader.loadPage(2);assert.match(reader.error.value,/文件已更新/);assert.equal(reader.requestedPage.value,2);
 await reader.loadPage(reader.requestedPage.value);assert.deepEqual(calls,[1,2,2]);assert.equal(reader.page.value?.pageNumber,1);scope.stop();
});
test('无账号不读页面；错误响应不能显示为PDF，退出作用域释放内容',async()=>{
 const context=reactive({visible:true,reportId:'a',userId:null as string|null}),scope=effectScope();let reads=0;
 const reader=scope.run(()=>useReportPdfPages(()=>context,async()=>{reads++;return {...page(),imageDataUrl:'https://wrong-file'}}))!;
 await settle();assert.equal(reads,0);context.userId='u';await settle();assert.match(reader.error.value,/无法显示/);assert.equal(reader.page.value,null);
 scope.stop();assert.equal(reader.page.value,null);
});
