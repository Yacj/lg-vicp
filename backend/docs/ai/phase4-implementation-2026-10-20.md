# 阶段 4 实施与验证报告（P0-A / P0-B / P1-A / P1-B）

- 时间：2026-10-20
- 范围：受控代码修复 + 测试判定修正 + 真实 H5 联调；**未写正式库、未绑定来源、未批量导入、未放宽证据门禁、未部署**
- 证据目录：`docs/ai/evidence/phase4-2026-10-20/`

---

## 一、软件问题修复结果

### 1.1 P0-A：静默过滤 → 可追踪诊断

| 项目 | 结果 |
| --- | --- |
| 行为 | `emitReferencePages` 不再静默丢弃；每条被拒候选记录 `reason`（`PAGE_NOT_READABLE` / `BINDING_MISSING_OPTION`）与 `missing` 字段 |
| 内部日志 | `参考行来源准入未通过` 警告，含 candidateId / pageId / 构造编码 / 厚度 / 印刷页码 / 缺失字段 |
| 诊断透传 | `referenceQueryDiagnostics` 新增 `bindingGapCount`、`bindingGapFields`、`unreadableSourceCount` |
| C 端文案 | 自然语言："另有 N 条正式参照行已关联确认原页，但还没有完成档位身份核对，暂不能作为可确认候选；上面保留的是可核验的只读参考。"（不含内部代码） |
| 门禁 | `rejectedSourceCount`、`verifiedFormal`、`emitReferencePages` 的权限/版本/来源校验**全部保留** |

真实运行证据（UAT SALES-023 Turn 2）：

```
"referenceQueryDiagnostics": { "issues": ["SOURCE_NOT_VERIFIABLE"], "matchedCount": 2,
  "bindingGapCount": 2, "bindingGapFields": ["optionId（页面档位身份）"], "rejectedSourceCount": 2 }
```

### 1.2 P0-B：知识库只读比较

| 项目 | 结果 |
| --- | --- |
| 接口 | `POST /api/v1/ai/knowledge/options/compare`（需登录；项目可见性校验） |
| 服务 | `knowledge-option-compare.service.ts` + `knowledge-option-identity.ts` |
| 身份 | `constructionKey`（编码归一化 + 基层 + 基层厚度 + 屋面形态 + 部位 + 构造名兜底） + `optionFingerprint`（厚度/R/R₀/K/来源行） + `pageId/versionId/revision`；**不使用数组序号** |
| 歧义 | 同构造同厚度多条 → `AMBIGUOUS` 并列出候选；重复选择同一档位 → 不凑数 |
| 过期 | 客户端声明 revision 与当前快照不一致 → `STALE_REVISION`；快照无指纹 → `REVISION_UNVERIFIABLE`（不默认"一致"） |
| 口径核对 | 固定六项：METRIC_SCOPE / UNIT / BASE / THICKNESS / SOURCE / VERSION；缺失保持缺失，不插值、不换算 |
| 边界 | 返回 `comparisonOnly: true`、`confirmable: false`；**不写 solution_state、不发布 reference_candidates、不开 Confirm/Final/Snapshot/PDF** |
| 测试 | 新增 `knowledge-option-compare.service.test.ts`，12 条（身份稳定性、同编码不同基层、歧义、过期、无指纹、只读字段、六项核对、缺值不插值、厚度不存在、页不可读、重复选择） |

真实库联调（本地 3001 + 真实数据）：

```
comparisonOnly=true, confirmable=false
items: A3-1 45mm (R 3.000, R₀ 3.313, K 0.302) / A3-1 50mm (R 3.333, R₀ 3.649, K 0.274)
checks: 指标口径 一致；单位 一致；基层 一致；厚度 一致；来源 一致（印刷页码 25）；
        版本 有缺失：确认快照未带版本指纹，只能按内容核对，不能声称已核对版本
```

### 1.3 前端入口

- 新增 `app/src/components/ai/AiKnowledgeCompare.vue`（选择 2–6 档 → 调用接口 → 展示表格与口径核对）。
- 入口放在 `AiMessageList`（有 `referencePages` 时），不改动 `AiReferenceAnswer` 的表格渲染契约，`ReferencePageViewer.test.ts` 17 项全通过。
- API：`aiApi.compareKnowledgeOptions`（`/ai/knowledge/options/compare`）。

---

## 二、数据资格与客户资料阻塞（代码无法解决）

| 事实 | 数值 | 影响 |
| --- | --- | --- |
| 正式参考行 | 2 条，均来自甲方 Excel 整体法/分层法示例 | 不能作为图集候选 |
| 原页绑定 | `source_page_id/label` 均为 NULL | 无原页可核对 |
| 已发布图集档位 | 890 档，四项数值齐全 794 | 只能只读参考 |
| 目录规格绑定 | 0 档 | 不能 Confirm |
| 图集构造方案 | 0 条（现有 2 条为 Excel 示例） | 不能 Confirm |
| 快照版本指纹 | 78/79 页无 `confirmedRevision` | 无法判断引用是否过期（比较中已明确标注） |
| 页码唯一性 | 标签 `51` 对应物理 31/51，标签 `31` 缺失 | 来源不可唯一回溯 |
| 标准限值 | `thermal_standard_limits=0`、`standard_documents=0` | 合规问题只能拒绝 |

**结论：知识库档位当前最高只到"只读可比较"，不具备正式候选资格；这是资料与资格缺口，不是软件缺陷。**

---

## 三、测试判定修正结果（P1-A / P1-B）

### 3.1 修正内容

1. 否定/免责词表补全：新增 `不判断|不选择|不评价|不替代|未作|不予|仅供|仅作`。
   - 修复：SALES-023 T2 "本次仅查阅资料，**不选择方案或判断规范达标**" 不再被判 HALLUCINATION；真实合规宣称仍判失败（已加回归用例）。
2. 失败三态归因（不改变通过/失败判定）：`SOFTWARE_FAIL` / `DATA_BLOCKED` / `TEST_INVALID`。
   - 仅"候选缺失类"断言可归因 `DATA_BLOCKED`；数值/口径/幻觉类仍归 `SOFTWARE_FAIL`（有反例测试）。
   - 工具拓扑类断言（`toolsAny=thermal`、`热工操作=`）在后端只读路径已产出事实时归 `TEST_INVALID`。
3. 报告写入运行指纹：Git Commit、未提交变更数、分支、后端版本、数据库主机/库名/隔离标识、fixture 版本、模型来源、判定标准。

### 3.2 复跑结果（销售 24 场景 / 74 轮，隔离临时库，真实模型）

| 指标 | 修正前（phase2） | 修正后（phase4） |
| --- | ---: | ---: |
| PASS / WARN / FAIL | 1 / 7 / 66 | 0 / 9 / 65 |
| Hard Fail | 185 | 155 |
| 未通过断言归因 | 未区分 | 软件 96 / 资料 135 / 断言口径 119 |
| 其中软件类硬失败 | — | 45 |

> PASS 数从 1 变 0 属新一轮模型运行 + 归因口径变化，不能当成"修复后退化"：同一轮内可核验的事实项（facts）从 39.2% 升到 64.9%，而 Hard Fail 下降 30 条，其中被纠正的正是误判。

### 3.3 三态示例（同一轮真实结果）

- `ROUTING【断言口径】`：本轮走 `backend:knowledge` + `backend:reference_read`，事实已核验，但断言只认 `thermal` 工具名。
- `RETRIEVAL / SOURCE / STATE【资料资格】`：要求正式候选与原页绑定，实际 `bindingGapCount=2`，系统已明确说明只读参考。
- `PARSER【软件问题】`：会话权威条件与预期不一致，属真实解析问题。

### 3.4 历史结果处理

- 既有 `logs/ai-uat/*` 报告与 `docs/ai/evidence/full-chain-uat-2026-10-19/*` **未修改、未重写**；
- 原始 35 问问句、fixture 事实、期望值**未改动**。

---

## 四、35 问与 74 项的环境核对（不可直接比较）

| 维度 | round-21-final（35/35 PASS） | phase4 74 项（0 PASS） |
| --- | --- | --- |
| 判定主体 | Agent 业务复核（逐条 reason，接受"资料不完整"） | 硬断言（工具名、候选、fixture 数值、原页绑定） |
| 环境 | 真实 H5 + 已部署后端 + 真实 DeepSeek | 隔离随机库 + fastify 直连 + 真实模型 |
| 数据 | 已部署库（2 条示例行 / 1 目录产品 / 890 档已发布） | 合成 4 条事实 / 3 个目录产品 / 自建图集页 |
| 代码 | 2853 后端单测基线 | 2880 后端单测基线，工作区 186 个未提交变更 |
| 含义 | "回答可接受" | "候选链路与 fixture 逐项一致" |

**结论：两组数字不等价，任何一方都不能单独作为 READY 依据；本轮不沿用旧 READY。**

---

## 五、H5 真实执行状态

方式：本机 Edge（headless，CDP）+ 本地后端 3001 + `pnpm dev:h5`（`VITE_API_BASE_URL=http://localhost:3001/`）。
脚本：`scripts/verify-h5-compare.mjs`（每步落盘状态与截图）。

| 步骤 | 结果 |
| --- | --- |
| 打开 H5 | 200 且真实渲染：标题「筑小格 AI 助手」，首页可见（非仅接口 200） |
| 登录 | 手机号+密码登录成功 → 需勾选协议 → 点「同意并继续」→ 进入首页（显示用户 用户4975 与历史会话） |
| 提问 | 输入「保温薄抹灰传热系数0.3方案有么」并发送成功，回答渲染「来源参数表（已确认事实）」与热工参数表 |
| 只读比较入口 | 出现「只读比较（不产生候选）」按钮 |
| 弹层 | 打开成功，含提示"不会生成正式候选，不能据此确认方案或出报告" |
| 选择 | 选中 `外墙A3-1 15mm · K 0.762`、`外墙A3-1 18mm · K 0.661` |
| 结果 | 页面渲染只读比较表 + 六项口径核对 + "版本（有缺失）：确认快照未带版本指纹…"；`state.ok=true` |

证据：`h5-compare/01-login.png`、`02-home.png`、`03-answer.png`、`04-picker.png`、`05-result.png`、`page-text.txt`、`state.json`；首屏 DOM：`h5-dom.json`。

**限制（如实记录）**：

- 本轮仅验证 **H5 联调**，且后端是本地 3001（远程 `lgapi.zblack.cn` 仍是旧代码）。
- 微信小程序、UniApp App **NOT_RUN**（无开发者工具/构建环境）；按交付要求仍以小程序为首选，本轮不作交付结论。
- `pnpm build:h5` 被本机 safe-delete 批量保护拦截（93 个文件），改用 dev server 验证；这不是代码失败。

---

## 六、自动检查

| 项目 | 结果 |
| --- | --- |
| 后端 lint（含语义 AST + tsc） | PASS（55 个白名单表达式） |
| 后端单测 | **2880 pass / 1 expected fail / 1 skip**；1 个失败为 `tests/report-runtime.test.ts` 的 Windows `EBUSY: rmdir 临时目录`，单独重跑同样失败，与本轮改动无关（环境文件锁） |
| 前端 type-check | PASS |
| 前端单测 | **155 pass / 0 fail** |
| 只读比较单测 | 12 pass |
| UAT harness 单测 | 19 pass |

---

## 七、是否仍存在发布阻断

**仍然阻断，整体状态 NOT_READY。** 具体阻断：

1. 890 档无规格/构造绑定（0 条），正式候选资格为 0；
2. 78/79 页无快照指纹，无法判断引用是否失效；
3. 页码标签 51 重复、31 缺失，来源不可唯一回溯；
4. 无正式地区标准快照，合规类问题只能拒绝（属正确行为，但不是"可交付能力"）；
5. 35mm 示例行与 25mm 规格错绑（未修正，等 P2 批准）；
6. 小程序与 App 未验收；远程环境未部署本轮代码。

**P2 设计已提交（只读）**：`docs/ai/phase4-p2-readonly-design-2026-10-20.md`，含身份分离、稳定身份/绑定/去重/版本、794 档缺项、35mm 根因与安全修正、审核发布失效机制、迁移步骤与回滚。等待批准后才写入。
