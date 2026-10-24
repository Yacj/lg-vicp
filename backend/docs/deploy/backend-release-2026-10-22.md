# 2026-10-22 后端修复版发布及人工验收入口

**DEPLOYED。** 用户确认发布后端并要求提供完整流程测试对话，已执行 `pnpm --config.verify-deps-before-run=false run deploy --skip-db`。这是修复版上线供人工测试，不能等同于原35问全部通过或正式READY；前次业务验收仍为25 PASS / 6 PARTIAL / 4 FAIL。

## 发布核验

- 发布目标为既有 `8.153.150.87:/www/wwwroot/lgapi.zblack.cn`，API与Worker均online，已换新PID。
- 发布前671个后端源文件与本次受测工作树逐项核对：无语义差异，82项仅BOM/换行等格式差异。此前3094项测试通过，1 expected fail、1 skipped；本次没有重复执行单元测试或业务UAT。
- 发布脚本正常重新构建，上传408个dist文件；发布后逐文件SHA256与本地一致。
- 既有服务器`.env`内容哈希、修改时间及站点`dist/.htaccess`均与发布前一致；不上传本地业务配置或凭据。
- `--skip-db`明确跳过数据库备份/迁移/seed；未改生产模型、规则、模板新版本、业务资料或历史快照。
- 发布脚本自带Chromium/中文字体/真实PDF运行环境检查通过；API/Worker均online，内网与公网live/ready均HTTP200且success=true。健康检查不代表真实业务人工验收已完成。
- 本次只发布后端，App/H5界面与生产报告模板新版本没有发布。此前C端按钮、候选恢复和PDF阅读器修复不会随后端自动上线；若当前界面缺入口，需核对并同步前端版本。

## 回滚

发布前保留后端回滚包（不含`.env`）：

`/www/wwwroot/lgapi.zblack.cn/.bak/pre-human-uat-2026-10-22T01-53-37-130Z.tgz`

脚本另保留`.bak/dist`。当前没有执行回滚。

## 人工测试

[完整单方案流程测试对话](../ai/manual-full-flow-test-2026-10-22.md)使用当前有效VICP-OVERALL / 25mm参考行，覆盖查询、恢复、选择、Final、确认、Snapshot、PDF生成和预览。35mm分层冲突仍只读展示，不能把它当作第二个正式候选完成双方案验收。文件下载修复与传输测试继续排除。

## 发布证据

- [受测源码一致性](evidence/2026-10-22-backend-release/source-preflight.json)
- [发布日志](evidence/2026-10-22-backend-release/deploy.log)
- [发布前状态及回滚包](evidence/2026-10-22-backend-release/before.json)
- [发布后状态及线上文件哈希](evidence/2026-10-22-backend-release/after.json)
- [公网健康检查](evidence/2026-10-22-backend-release/public-health.json)
- [发布摘要](evidence/2026-10-22-backend-release/release-summary.json)
