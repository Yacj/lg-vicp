# VICP B 端剩余问题修复报告

- 日期：2026-10-06
- 范围：`admin-web`（B 端管理后台）
- 依据：Backend 2026-10-06 协议（只读比对 `../backend/`，未修改后端代码）

---

## 一、修改摘要

### P0-1 识别校验接入 Scheme / ProductSpec 人工映射

- `PageRecognitionSystem` 补 `schemeId`，`PageRecognitionOption` 补 `productSpecId` / `catalogProductId`；
  识别草稿的 `copyResult()`、保存草稿与确认提交 payload 均**不再过滤**这三个字段。
- 关键协议结论：后端业务错误以 **HTTP 200 + `success:false`** 返回，字符串业务码
  （如 `PAGE_RECOGNITION_MAPPING_AMBIGUOUS`）**不进入** `error.code`，业务明细在 `error.details`。
  因此改为读取 `details.mappingStatus` / `details.schemeCandidates` / `details.productSpecCandidates`。
- AMBIGUOUS：把候选绑定到当前 system / option 下拉，用户可人工选择正式方案与产品规格。
- NOT_FOUND 与确认返回的 `thermal.mappingIssues`：明确提示「页面已确认，但部分热工数据未同步」，
  不再静默当成功。

### P0-2 完整使用 `versionEditable` / `thermalSetEditable`

- 新增 `useKnowledgeVersionEditable()`：同时判断**权限**与**后端状态**，`versionEditable` 优先，
  缺省回退 `status === 'DRAFT'`。
- 三个 Tab（页面图库、识别校验、测试）统一使用同一 composable。
- PUBLISHED 真只读；`thermalSetEditable === false` 时明确区分「页面确认」与「同步正式热工数据」，
  并给出「请创建新的热工参考版本后再同步」的提示。

### P0-3 AI 高级设置移除旧 tools / agent 协议

- 移除 `supportsTools` / `supportsAgent` / `default_agent` / `capabilities.tools` 的读取与提交；
  不再向 `default_agent` 发 PATCH（后端模型接口本就不接受 `code` / `capabilities`）。
- 模型配置 UI 保留：服务商 / 模型标识 / 显示名 / 说明 / 启用 / 默认 / 图片输入 / 推理强度 / 准入检测。
- 高级设置页改为「模型概览 / 运行限制 / 专业工具」，全部业务化文案。

### P1

| 编号 | 内容 | 状态 |
| --- | --- | --- |
| P1-1 | ReferencePage 双 R 对齐（优先 `productThermalResistance` / `totalThermalResistance` / `kValue`，`rValue` 仅兼容） | 完成 |
| P1-2 | Knowledge Test 补 `test-inspect` 调试层（折叠「高级调试信息」），`answer === null` 非错误 | 完成 |
| P1-3 | 识别状态区分：未识别 / 排队中 / 识别中 / 待确认 / 已确认 / 识别失败 | 完成 |
| P1-4 | 识别批量进度（统计 + 进度条） | 完成 |
| P1-5 | 原始页面核对：左列表 / 中原图 / 右表单 + 全屏查看（缩放、拖动，关闭后保留编辑） | 完成 |
| P1-6 | 客户文案产品化 | 完成 |
| P1-7 | 热工计算页产品化（地区编码→地区；结果主视图为业务字段，JSON 收进「技术详情」） | 完成 |
| P1-8 | 产品对比结果以表格呈现，不再主展示 JSON，保留「暂无可靠资料」，不自动评分/排名 | 完成 |
| P1-9 | 报告详情热工区改表格 + 「技术数据」折叠 | 完成 |
| P1-10 | 标准规范来源配置 → **方案 A**：实现业务化栏目地址 / 提取规则 UI | 完成 |
| P1-11 | AI 运行记录对普通运营开放（技术配置继续隐藏） | 完成 |

### P2

- 产品管理删除恒为「—」的假「产品分类」列，并移除死代码 `catalogProductCategoryLabel()`。
- 工作台项目可见范围：卡片改用 `formatProjectVisibilityScope()`（公开 / 部门 / 私有）；
  项目总数副标题改用新增的 `formatProjectStatisticsScope()`，支持 `公开 X · 部门 Y · 私有 Z`。
- 工程治理：确认 `SKILL.md` 实际位于 `.skills/vicp-admin-ui/`，把 AGENTS.md、README.md、
  两条 `.cursor/rules` 中失效的 `skills/...` 引用更正为 `.skills/...`。

---

## 二、Backend 协议对接说明

| 前端行为 | 后端契约 |
| --- | --- |
| 识别映射失败提示 | 读 `error.details.mappingStatus` / `schemeCandidates` / `productSpecCandidates`；`error.code` 为 HTTP 语义码，**不含**字符串业务码 |
| 确认识别 | `confirmPageRecognition` 返回 `{ recognitionStatus:'CONFIRMED', chunkCount, thermal:{ upserted, warnings, skipped, mappingIssues }, recognition }` |
| 版本/热工集可编辑 | 识别接口返回 `versionEditable` / `thermalSetEditable`（`thermalSetEditable` 可为 `null`） |
| 检索调试 | `POST /knowledge/versions/:id/test-inspect`，返回 `answer: null` + `sources` / `referencePages` / `matchedReferenceRows` / `retrievedChunks` |
| AI 模型写入 | 仅 `providerId,name,displayName,modelId,description,supportsVision,reasoningLevel,enabled,isDefault` |
| 标准来源 | `catalogUrls[{label,url,listSelector?,itemLinkSelector?,paginationMode:'url'\|'scroll'\|'none',pageParam?,pageLimit?}]`、`extractRules[{field,pattern,flags?}]`；更新为 `input.x ?? existing.x` |
| 项目统计 | `{ total, public, private, department }` |
| 热工计算记录 | `result.productResistanceRounded / totalResistanceRounded / kValueRounded / compliant / limitKValue` |

**标准来源配置（P1-10）为什么选方案 A**：后端抓取服务在 `catalogUrls` 为空时直接失败并返回
「来源未配置栏目 URL」。原 UI 无法编辑该字段，意味着**新建的来源永远抓不到数据**，属功能缺口而非文案问题。

---

## 三、UI / 文案变化

- 术语统一：`物理第 N 页` → `文件第 N 页`；`图集页次` → `资料页码`；`Chunks/Sources` → `命中文段/引用来源`；
  `Provider` → `服务商`；`Model ID` → `模型标识`；`API Base URL` → `接口地址`；`Conversation` → `会话`。
- 去除「后端」表述：`API Key 仅用于系统发起 AI 请求…`、`生成任务由系统异步执行…`、
  `分类下存在文档时将无法删除`、`系统会标记最接近目标 K 值的方案`。
- 隐藏不可用入口：AppHeader 的「个人信息 / 账号设置 / 修改密码（暂未开放）」已移除。
- 删除占位文案：「栏目 URL 与提取规则的高级配置暂未开放编辑，后续批次补齐」→ 已实现；
  「报告生成入口（候选确认后）后续开放」→ 已删除。
- 侧边栏：`/ai-config/advanced` 后端下发标题为「Agent设置」，由 `SIDEBAR_TITLE_OVERRIDES`
  统一覆盖为「高级设置」，避免旧术语泄漏。

---

## 四、测试与构建结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm typecheck` | ✅ 通过 | `vue-tsc --noEmit` 退出码 0 |
| `pnpm test` | ✅ 通过 | 92 个测试文件 / 653 个用例全部通过 |
| `pnpm build` | ⚠️ 环境受限 | `vue-tsc` 通过、Vite 已成功转换 5166 个模块；随后在 `prepare-out-dir` 清理旧 `dist/assets`（2667 个文件）时被运行环境的批量删除保护拦截（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），**非代码问题** |
| `pnpm build`（等价验证） | ✅ 通过 | `npx vite build --outDir <全新目录>` → `✓ built in 17.02s`，产物含 `index.html` / `assets` |
| `pnpm lint` | ❌ 存量问题 | 全仓约 1993 errors / 487 warnings，集中在 `perfectionist/sort-imports`、`style/eol-last`，大量出现在**未改动**文件；本次仅修复了自己引入的违规 |

---

## 五、剩余问题

1. **`pnpm build` 需在非受限环境执行**：`dist/` 已存在 2600+ 文件，清理时会触发环境的批量删除保护。
   可在正常终端直接运行 `pnpm build`，或先手动清空 `dist/` 后重试。
2. **`pnpm lint` 存量债务**：全仓约 1993 errors，与本次任务无关，建议单独排期统一 `eslint --fix`。
3. **仓库存在陈旧 git 锁**：`E:/code/lg/.git/index.lock`（0 字节）会阻塞 `git mv` / 索引写操作，需手动确认后清理。
4. **`.skills/` 目录无法重命名**：被进程句柄占用，故改为修正文档引用（保持目录名不变）。
5. **`dist/` 未重新生成**：因上述删除保护，仓库内 `dist/` 仍是旧产物。
6. **耗时字段**：`test-inspect` 响应未提供耗时，调试面板未展示该项。
