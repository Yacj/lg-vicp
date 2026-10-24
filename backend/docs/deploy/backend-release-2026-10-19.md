# 2026-10-19 后端生产发布

结论：**DEPLOYED**。按用户“pnpm发布后端到线上，不走测试，直接发布”的追加授权，执行 `pnpm run deploy --skip-db`。API/Worker于香港时间 **2026-10-19 21:34:37** 重载 online；内外网live/ready均HTTP200且success=true。

本次仅后端发布到 `8.153.150.87:/www/wwwroot/lgapi.zblack.cn`，未发布App/H5或生产模板新版本。先前UAT报告是部署前的验收记录，本次没有重跑单元测试、UAT或人工业务测试。正常构建及发布脚本自带的PDF运行环境检查、服务健康检查保留。

## 发布结果

- 本地重新构建并通过SSH上传发布物，服务器依锁文件安装依赖，PM2 API及Worker均已换新PID。
- 390个本地dist文件与线上逐一SHA256一致。线上额外的`dist/.htaccess`为原有站点文件，其SHA256与发布前一致，未删除或改写。
- `.env`内容SHA256和修改时间与发布前一致，没有上传本地`.env`或凭据。
- `--skip-db`明确跳过数据库备份、migration和seed。没有改写生产业务数据、发布规则、模型配置、历史快照或报告模板记录。
- 已有Chromium/中文字体/PDF运行环境检查通过，复用现有环境；未安装或切换正式模型。
- 内网与公网`/health/live`、`/health/ready`均正常，Redis、PostgreSQL、对象存储依赖就绪。健康检查不代表新增一次业务UAT。

## 回滚与证据

发布前完整后端回滚包（不含`.env`）：

`/www/wwwroot/lgapi.zblack.cn/.bak/pre-full-chain-2026-10-19T13-33-57-931Z.tgz`

发布脚本另保留`.bak/dist`。当前未执行回滚。

- [发布日志](evidence/2026-10-19-backend-release/deploy.log)
- [发布前状态及哈希](evidence/2026-10-19-backend-release/before.json)
- [发布后状态及哈希](evidence/2026-10-19-backend-release/after.json)
- [公网健康检查](evidence/2026-10-19-backend-release/public-health.json)
- [结构化发布摘要](evidence/2026-10-19-backend-release/release-summary.json)

## 后续范围

本次未执行线上人工业务测试。App/H5前端修复及已确认的三个报告模板新版本尚待各自发布；Backend发布不会自动发布它们。生产模板仍按原有权限和版本审核流程处理，历史模板/报告不回填。
