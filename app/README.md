接口环境（2026-10-24）：Vite 从 App 根目录读取 `.env.development`、`.env.staging` 和 `.env.production`，当前统一使用 `https://lgapi.zblack.cn`。H5 开发通过同源 `/api` 代理转发到该线上地址；生产 H5、小程序及 App 使用绝对地址，未配置时也默认线上地址。修改环境变量后须重启开发服务或重新构建。

复杂图集表格（2026-10-17）：沿用后端来源列头、原层号和分组；简图说明可展开，完整表保留全部档位，产品整体R无值时不固定增列。B/App使用同一确认事实，旧资料不在客户端纠正。验证范围及不足见[三端修复记录](../backend/docs/ai/atlas-source-layout-and-a3-2026-10-17.md)。

<p align="center">
  <img alt="logo" src="https://starter.wot-ui.cn/logo.svg" width="200">
</p>

<h1 align="center">
Wot Starter
</h1>

<p align="center">基于<a href="https://github.com/uni-helper/vitesse-uni-app">vitesse-uni-app</a>的深度整合 Wot UI 组件库，现代化的 uni-app 快速起手项目</p>

<p align="center">
  <a href="https://starter.wot-ui.cn/demo/#/">📱 在线预览</a>
  <a href="https://starter.wot-ui.cn/">📖 在线文档</a>
</p>

## 特性

- ⚡️ [Vue 3](https://github.com/vuejs/core), [Vite](https://github.com/vitejs/vite), [pnpm](https://pnpm.io/), [esbuild](https://github.com/evanw/esbuild) - 就是快！

- 🗂 [基于文件的路由](./src/pages)

- 📦 [组件自动化加载](./src/components)

- 📑 [布局系统](./src/layouts)

- 🐂 [Wot UI V2](https://github.com/wot-ui/wot-ui) - 一个轻量、美观、AI友好的 uni-app 组件库

- 🚦 [@wot-ui/router](https://github.com/wot-ui/my-uni) - 适用于uni-app&vue3的轻量级路由库

- 🔄 [Uni Mini CI](https://github.com/Moonofweisheng/uni-mini-ci) - 一个小程序端持续集成的插件

- 🌐 [Alova](https://alova.js.org/zh-CN/) - 极致高效的请求工具集

- 🆒 [Uni Ku](https://uni-ku.js.org/) - 非常酷的 uni-app 插件库

- 📊 [Uni Echarts](https://uni-echarts.xiaohe.ink/) - 适用于 uni-app 的 Apache ECharts 组件

- 🎨 [UnoCSS](https://github.com/unocss/unocss) - 高性能且极具灵活性的即时原子化 CSS 引擎

- 😃 [各种图标集为你所用](https://github.com/antfu/unocss/tree/main/packages/preset-icons)

- 🔥 使用 [新的 `<script setup>` 语法](https://github.com/vuejs/rfcs/pull/227)

- 📥 [API 自动加载](https://github.com/antfu/unplugin-auto-import) - 直接使用 Composition API 无需引入

- 🦾 [TypeScript](https://www.typescriptlang.org/) & [ESLint](https://eslint.org/) - 保证代码质量


## 快速上手

详细说明见 [快速上手](https://starter.wot-ui.cn/guide/installation.html)。

### Windows 构建依赖

`package.json` 中的 `pnpm.overrides.unconfig = 7.3.2` 是 Windows 构建兼容性配置。UnoCSS 66.0.0 默认依赖的 unconfig 7.0.0 在支持原生 TypeScript 的 Node 下会直接导入盘符路径，导致 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（`Received protocol 'd:'`）。固定版本使用 Jiti 加载配置，避免这一错误。更新依赖时保留该配置和对应锁文件；安装使用 `pnpm install --frozen-lockfile`，验证使用 `pnpm build`。

## 更新日志

详细日志见 [更新日志](https://starter.wot-ui.cn/guide/changelog.html)。

## 社区

[加群沟通](https://wot-ui.cn/guide/join-group.html)

## 周边生态

| 项目                                                                                                        | 描述                                                 |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [wot-ui-intellisense](https://github.com/wot-ui/wot-ui-intellisense)                  | wot-ui vscode 代码提示插件     |
| [awesome-uni-app](https://github.com/uni-helper/awesome-uni-app)                                            | 多端统一开发框架 uni-app 优秀开发资源汇总            |
| [create-uni](https://github.com/uni-helper/create-uni)                                                      | 快速创建 uni-app 项目                                |
| [wot-starter-retail](https://github.com/Moonofweisheng/wot-starter-retail)                                  | 基于 wot-ui 的 uni-app 零售行业模板          |
| [uni-mini-ci](https://github.com/Moonofweisheng/uni-mini-ci)                                                | 一个 uni-app 小程序端构建后支持 CI（持续集成）的插件 |
| [@wot-ui/router](https://github.com/wot-ui/my-uni)                                        | 一个基于 vue3 和 Typescript 的轻量级 uni-app 路由库  |
| [uni-ku-root](https://github.com/uni-ku/root)                                                               | 一个模拟 App.vue 原有能力的根组件插件                  |
| [uni-echarts](https://uni-echarts.xiaohe.ink/)                                                             | 适用于 uni-app 的 Apache ECharts 组件                  |

## 贡献者们

感谢以下所有给 Wot Starter 贡献过代码的 [开发者](https://github.com/wot-ui/wot-starter/graphs/contributors)。

<a href="https://github.com/wot-ui/wot-starter/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=wot-ui/wot-starter" />
</a>

## 捐赠本项目

开发一个好的模板是一项耗时的工作，尤其是要多端适配。为此 Wot Starter 的开发者经常肝到深夜 ……

如果您认为 Wot Starter 帮助到了您的开发工作，您可以捐赠 Wot Starter 的研发工作，捐赠无门槛，哪怕是一杯可乐也好。

捐赠后您的昵称、留言等将会展示在[捐赠榜单](https://wot-ui.cn/reward/donor.html)中。


### 爱发电捐赠

<a href="https://afdian.com/a/weisheng233">https://afdian.com/a/weisheng233</a>

### 扫码捐赠

<p>
<img src="https://wot-ui.cn/weixinQrcode.jpg" width="200" height="200" style="margin-right:30px"/>
<img src="https://wot-ui.cn/alipayQrcode.jpg" width="200" height="200" />
</p>

## 鸣谢

- [uni-helper](https://github.com/uni-helper) - 感谢 uni-helper 团队为 uni-app 开发体验优化做出的贡献。
- [vitesse-uni-app](https://github.com/uni-helper/vitesse-uni-app) - 感谢 vitesse-uni-app 提供的快速起手项目。
- [uni-ku](https://uni-ku.js.org/) - 感谢 uni-ku 团队为 uni-app 插件生态做出的贡献。


## 开源协议

本项目基于 [MIT](https://zh.wikipedia.org/wiki/MIT%E8%A8%B1%E5%8F%AF%E8%AD%89) 协议，请自由地享受和参与开源。


[![Star History Chart](https://api.star-history.com/svg?repos=wot-ui/wot-starter&type=Date)](https://star-history.com/#wot-ui/wot-starter&Date)

2026-10-21 对话与PDF收口：计算的独立纯目标核验同样覆盖QUERY_CONTEXT_INVALID，发现选择/读取/比较目标后仅使用剩余一次窄目标复核，重走完整Policy与身份Parser；不复用错误计算ID或输入，预算/证据/权限不放宽。多产品参数按同一来源成行，筛选值与比较符显示来自Backend，缺参数/无命中简短说明，完整诊断保留。H5报告预览与下载复用相同归属/项目/发布/工件校验，每页从实际冻结PDF渲染，文件SHA绑定跨页，关闭/换报告/换用户使迟到响应失效；系统阅读器保留于原生端。交互渲染限2并发、40MB、30秒和页码1–500，批处理默认预算不变；不写报告正文或Snapshot。已确认免责声明只在隔离验收库按新版本工作流验证，生产模板不直接改写。完整真实UAT和剩余资料阻塞见backend文档docs/ai/dialogue-release-closure-2026-10-21.md。


2026-10-22 报告身份修复：报告详情、Snapshot展示和PDF预览统一使用本页面onLoad的报告ID，同路径更换query不能沿用全局旧路由。缺少ID不回退旧报告；原用户隔离、隐藏清理、异步Revision与PDF hash保护不变。真实H5验收同时打开设计师/销售两份报告，核对各自Snapshot与全部PDF页；文件下载按用户要求排除。见Backend的docs/ai/natural-role-repair-2026-10-22.md。

2026-10-23 用户确认：保留作参考默认仅留在当前对话，不进入正式备选、Snapshot或PDF。SET_FINAL与聊天资料分别绑定；模型只提交资料人类名称和原话证据，Backend按当前有权来源、版本/Revision和内容指纹绑定，并在模型返回后再核验。资料失效或有多个指代则整次操作不执行；明确要求正式备选仍执行原门禁，不能降格后声称完成。正式Confirm与报告仍只消费正式有效候选冻结数据。H5报告详情同路径只改query时也同步真实地址，清空旧资源并重新授权，不复用旧PDF。

2026-10-23 查询合同V2：真实H5边界补测发现V1方案B将严格小于/大于执行为包含边界。新AI查询由Backend设置queryContractVersion=2，LT/GT严格排除等值，MAX_LIMIT/MIN_LIMIT及旧记录语义不变；板厚范围以显式开边界元数据随查询追溯。封闭数学比较/否定词法只核验既有数值字段，不新增开放意图路由，不让模型选择旧版本放宽条件。正式查询零命中仍保存本人同端同项目24h最新requestQuery；沿用当前构造只绑定当前来源身份，不以旧候选查询覆盖最新条件。公开公式、数据、权限、Revision、Confirm与历史Snapshot不变，无生产迁移/部署。版本影响、独立边界及回归证据见docs/thermal/query-contract-v2-2026-10-23.md及docs/ai/natural-role-repair-2026-10-22.md。

2026-10-23 自然追问收口：正式命中与零命中都保存有效requestQuery；板厚REPLACE清除被替换边界，追加仍校验冲突。来源复核读取Backend已验证历史字段，新合格复核仅撤销该门禁旧诊断，不降置信度或清除其他缺项。pageQuery.readFields只决定查询输出列，不能单独把重新查询改为比较旧集合；需要独立referenceReadFields证据。目录简称与知识库名称概览分别保留；未知名称类别沿用Backend字段角色，表达层不得另猜。候选历史与当前查询匹配情况经现有SSE及历史恢复同步，H5明确标注，不改变正式资格和操作授权。最终证据和数据限制见docs/ai/natural-role-repair-2026-10-22.md；下载排除，无生产部署。

AI 对话处理过程（2026-10-24）：实际SSE阶段与资料名称默认在生成时展开、完成后折叠，可在当前会话中查看；停止/失败如实结束步骤。仅展示查询处理摘要，不需开启深度思考。测试与范围见 ../backend/docs/ai/processing-progress-2026-10-24.md；本轮未发布。


思考过程展示更新（2026-10-24）：入口移至AI回答上方，改为“思考中／已思考（xx秒）”；首段正式回答到达后冻结计时，完成自动折叠。展开以简短段落概括实际查询和资料书名，不再逐项列页码。停止/失败保留真实状态。验证记录：../backend/docs/ai/evidence/thinking-presentation-2026-10-24/README.md。本轮未发布。
