# 原表头修复验证

客户知识库和数据库均只读；不运行生产迁移或发布操作。完整结果见 `docs/ai/table-header-repair-2026-10-19.md`。

1. `python scripts/audit-source-table-headers.py` 提取原DOCX表头，校验79表及源文件SHA。
2. `pnpm exec tsx scripts/read-header-audit-images.mts` GET原图（首次未匹配清单及人工核对清单）。人工核对表头并保留图像SHA、版本、标题对应记录；该清单只证明表头，不批准数字或识别标题。
3. `pnpm exec tsx scripts/audit-source-table-headers.mts` 只读核对当前发布版本，生成严格内容指纹表及外墙/屋面/板材测试夹具；页数改变或仍有未核验页就失败。原确认JSON不写回。
4. Backend执行db:check/lint/test/build；App执行test、修改文件eslint、type-check、build:h5。不能以测试夹具通过替代真实业务UAT。
5. 可选重现H5显示核验：创建App影子副本，依赖沿用本机安装；只在影子副本中把 `scripts/table-header-h5-fixture.vue` 复制为 `src/pages/reference-table/index.vue`。将当前5个实现/夹具文件复制到影子副本，核对SHA，loopback 8881启动H5。运行 `node scripts/check-source-header-h5.mjs`。测试使用Edge、实际uni H5组件和原快照Fixture，通过实际运行时直接挂载；只允许本机8881网络请求，不调用模型或API。该脚本不证明正式路由或业务确认链通过。结束关闭浏览器及本轮H5进程，恢复影子副本参考页；不要递归删除共享依赖链接。

显示核验脚本不修改产品路由或源库。影子Fixture不进入产品构建。开发端口仅本机使用，真实35问另建独立环境执行并存新证据。
