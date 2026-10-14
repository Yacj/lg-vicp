# PM2报告运行环境部署（2026-10-14）

范围仅PM2发布链；Dockerfile、数据库schema、前端与生产.env未改。前半阶段仅修改脚本；用户随后明确授权通过pnpm发布线上，并要求不运行测试，按下述发布记录执行。

## 行为

发布顺序：本地构建→上传锁文件/部署脚本→安装Node依赖→报告运行环境/中文PDF自检→既有数据库步骤（--skip-db可跳过）→PM2重载→API健康检查。

默认只检查。已有浏览器可输出中文PDF则复用，不重复下载或安装。缺失/失败时中止，恢复原dist，不执行后续数据库步骤、不重载PM2。只有显式--install-report-runtime或DEPLOY_REPORT_RUNTIME_INSTALL=1才安装系统依赖。

安装白名单：Linux Debian12/13、Ubuntu22.04/24.04（x64/arm64），及Alibaba Cloud Linux3（x64），root。线上已只读确认alinux3/x86_64/glibc2.32，RPM字体已安装；Alibaba分支只安装RPM检查缺少的运行库，沿用现有DNF仓库，不使用APT、不添加EPEL。其他系统（包括CentOS7）可复用经自检的现有浏览器，但不能自动安装。显式PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH错误会拒绝，不悄悄换浏览器。

自动安装使用锁文件对应playwright-core CLI安装Chromium，不调用npx下载最新包。字体为fonts-noto-cjk/fontconfig；浏览器缓存放.cache/report-browsers，PDF自检通过后路径原子保存到.cache/report-runtime.json。PM2 Worker复用同一解析规则：显式服务器.env→显式进程路径→已核验记录。不写入或覆盖生产.env。

## 使用方式（本轮未执行这些发布命令）

日常纯代码发布：`pnpm run deploy --skip-db`（pnpm11存在同名内置deploy命令，必须用run调用仓库脚本）。

首次缺报告依赖：`pnpm run deploy --skip-db --install-report-runtime`。

--skip-db保留原有含义：跳过备份/迁移/seed；它不跳过报告环境检查。--install-report-runtime不隐式修改数据库选项。普通pnpm deploy原有迁移行为未改变。

本地deploy/.env.deploy可填写（不打包上传）：

| 配置 | 默认/含义 |
| --- | --- |
| DEPLOY_NPM_REGISTRY | https://registry.npmmirror.com，仅本次进程，不覆盖全局npm/pnpm配置 |
| DEPLOY_REPORT_RUNTIME_INSTALL | 0；显式安装开关 |
| DEPLOY_REPORT_CHROMIUM_DOWNLOAD_HOST | 留空默认https://cdn.npmmirror.com/binaries/playwright |
| DEPLOY_REPORT_DOWNLOAD_HOST | 同上，附属文件下载 |
| DEPLOY_REPORT_APT_SOURCE_FILE | 可选服务器上已存在的APT源列表绝对路径；通过临时APT_CONFIG仅本次安装使用，不改/etc/apt |

Node/浏览器镜像必须HTTPS，不能带用户名密码、查询参数/token。只传部署选项白名单，不转发本地业务.env。系统包源沿用服务器已有源；如需国内APT镜像，管理员应预先准备对应系统版本的源列表，再填APT_SOURCE_FILE。脚本不自动覆盖系统仓库。镜像失败即中止，不偷偷切换未知下载站，也不关闭TLS/签名校验。

## 真实证据与限制

本轮HEAD检查了锁文件Chromium151.0.7922.34的linux64归档：国内Playwright镜像builds/cft/...地址HTTP200，registry/-/binary/playwright同路径200；扁平Chrome镜像拼builds/cft/...返回404。默认源因此选择保留CLI目录结构的Playwright镜像。仅本机HEAD，不代表已下载完整归档、arm64归档可达或生产网络可达。

真实本地自检脚本调用现有dist/workers/report-pdf.js；不加载app/config/env，不连接DB/Redis/OSS。本机Edge输出1页A4/86179字节中文PDF，脚本与Poppler均退出0，视觉检查中文/页眉页脚正常；不代表Linux安装或业务UAT。

测试：tests/report-runtime.test.ts覆盖复用、默认拒绝、安装后再自检、下载失败、OS/权限、无效显式路径、镜像输入、缓存优先级。临时目录+全命令桩实际运行remote-apply.sh验证自检失败后没有执行迁移/seed/PM2，.env不变并恢复dist。定向最终14通过、0失败、0跳过，退出0。

| 本轮检查 | 实际结果 |
| --- | --- |
| `pnpm test --maxWorkers=4` | 退出0，198文件通过/1文件原有跳过；2249通过、0失败、1原有跳过，总2250；175.90秒 |
| 镜像路径修正后 `pnpm exec vitest run tests/report-runtime.test.ts --maxWorkers=2` | 退出0，14通过、0失败、0跳过 |
| `pnpm lint` | 退出0，语义AST与TypeScript通过 |
| `pnpm build` | 退出0，仅本地构建 |
| `pnpm db:check` | 退出0，仅静态迁移检查 |
| 部署JS `node --check` / Shell `bash -n` | 均退出0 |
| 本地真实PDF smoke / Poppler | 均退出0，1页A4，中文视觉检查通过 |

上表是部署前验证；本次实际线上发布未运行测试套件。真实Worker/OSS业务报告闭环仍未执行。

## 线上发布记录

用户明确授权：通过pnpm提交线上，检查/安装必要包，不走测试。

1. `pnpm deploy --skip-db --install-report-runtime`退出1：pnpm11内置deploy命令不接收这些参数，未发布。
2. 改用`pnpm run deploy --skip-db --install-report-runtime`，首轮退出1：服务器实际alinux3不在原安装白名单，脚本恢复dist，未执行数据库步骤、未重载PM2。
3. 只读确认服务器为Alibaba Cloud Linux3.2104 U13.2/x86_64/glibc2.32，fontconfig与Noto中文字体已装，缺Chromium。补齐针对该系统的RPM检测/DNF安装分支，沿用原仓库，不添加软件源或升级系统。本轮按用户要求不运行测试套件。
4. 再次`pnpm run deploy --skip-db --install-report-runtime`退出0：本地构建、上传、锁文件依赖安装成功；检测并补装atk、at-spi2-atk、libXcomposite、libXdamage、gtk3；从国内镜像下载锁文件匹配Chromium。远端中文字体/真实PDF运行自检通过。
5. 日志确认跳过数据库备份/迁移/seed，保留生产.env；lg-vicp-api及lg-vicp-worker重载后online，API健康检查通过，部署完成。

这是实际部署与运行依赖验证，不是正式Snapshot→Worker→OSS业务UAT。没有在生产库创建测试会话/快照或业务报告。

## 修改文件

- deploy/deploy.local.mjs：打包新增检查脚本、安装开关及白名单参数传递。
- deploy/remote-apply.sh：进程级国内npm源、数据库步骤之前PDF自检门禁。
- deploy/report-runtime.mjs：可复用检查、显式安装、临时APT配置、缓存与稳定错误码。
- deploy/report-runtime-smoke.mjs：复用现有PDF函数的无业务IO自检。
- deploy/report-runtime-config.cjs、ecosystem.config.cjs：共享浏览器路径优先级，Worker加载核验路径。
- deploy/.env.deploy.example：配置示例；未修改真实配置文件。
- tests/report-runtime.test.ts及本说明、README、AGENTS、Cursor架构规则、skill架构reference。
