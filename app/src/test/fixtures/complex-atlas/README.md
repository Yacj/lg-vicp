这些文件仅用于测试，不进入业务 store 或正式知识库。

- `page-*.json` 的页面及完整 RenderModel 来自 Backend 阶段 3 的 `docs/ai/evidence/complex-atlas-phase3/page-*-20mm.b-http.json`。
- `matches` 来自同目录 `transport-report.json` 对应页、20mm 的 `cases[].rows`，组装为 C 端来源协议供前端测试；不是另一次真实认证接口响应。
- 原始事实是人工源图基线 `MANUAL_SOURCE_BASELINE`，不是 Vision 输出或数据库中的人工确认记录。三页共 6 构造、38 档；屋面没有印刷构造编号，防水等级字形待核，产品整体热阻为 null。
- 保留阶段 3 已披露的第 90 页正置 LC7.5 及后续砂浆的源层序标签问题，前端不擅自改事实。数值测试通过不代表全部源层标签正确。
- 原图直接复用 Admin 阶段 2 留存的逐字节 PNG；验收服务通过本地 HTTP 提供原件，不重画图片。
