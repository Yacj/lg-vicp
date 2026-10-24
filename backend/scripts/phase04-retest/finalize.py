"""汇总独立复测证据；人工判定与自动采集分开保留。"""
from pathlib import Path
import hashlib
import json
import subprocess
from datetime import datetime, timezone, timedelta

ROOT = Path('D:/work/lg-vicp')
BACKEND = ROOT / 'backend'
OUT = BACKEND / 'docs/ai/evidence/phase04-retest-2026-10-19'
RUN = OUT / 'h5-run-02'
PACKAGE = Path('C:/Users/admin/xwechat_files/zhai579670_8a65/msg/file/2026-10/小格AI阶段03修复交接包-v3/03-AI修复交接')
def load(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def save(path, data): Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

matrix = load(RUN / 'matrix.json')
original = load(PACKAGE / 'evidence/reviewed-results.json')
frozen = load(PACKAGE / 'baseline/frozen-scenarios.json')
extras = load(RUN / 'extras.json')
runtime = load(RUN / 'runtime-audit.json')
cleanup = load(OUT / 'cleanup-proof.json')
local_cleanup = load(OUT / 'local-cleanup.json')
assert len(matrix['cases']) == 10
assert sum(len(case['turns']) for case in matrix['cases']) == 35
for case, spec in zip(matrix['cases'], frozen['cases']):
    assert case['id'] == spec['id']
    assert [turn['userMessage'] for turn in case['turns']] == spec['prompts']
    for turn in case['turns']:
        assert turn['submittedBody']['content'] == turn['userMessage']
        assert turn['status'] == 'EXECUTED_REVIEW_REQUIRED'
        assert turn['httpStatus'] == 200 and 'text/event-stream' in turn['contentType']
assert runtime['counts'] == dict(conversations=11, solutionStates=0, snapshots=0, reports=0, calculations=0)
assert cleanup['passed'] and not local_cleanup['listeners'] and local_cleanup['privateLoginRemoved']

# 分数次序固定：自然、简洁、帮助性、上下文、可读性；不参与硬失败抵消。
reviews = {
 'S1': ('PARTIAL', [3,4,2,4,4], 'VICP身份和通俗续问成立；两轮回答逐字重复，首轮额外提示未请求的完整系列，介绍仍较空泛。'),
 'S2': ('FAIL', [1,3,1,1,3], 'λ=.3追问被PARAMETER_EVIDENCE_INVALID拒绝；第三轮丢失有效数值上下文，未形成查询/范围解释。'),
 'S3': ('FAIL', [3,2,3,4,3], 'K=.3与III型收窄成立；仍将资料标注5/6等称为印刷页码，原资料15/190异常保留待治理。'),
 'S4': ('FAIL', [2,4,1,1,4], '两轮停在澄清，未自然说明可比较维度和所需证据；未编造竞品参数。'),
 'S5': ('FAIL', [2,3,1,1,3], '200mm正式Excel例仍停澄清，比较/选择/Final未成立，无可用确认及PDF入口。'),
 'R1': ('FAIL', [3,2,2,2,3], '四基层45mm数值与两页原引用正确恢复；T2比较却称无候选，且印刷页码仍错。'),
 'R2': ('FAIL', [3,2,3,4,3], '两构造20mm均命中R=3.569/K=.280且可打开原页；R列解释未完全闭合，33/53页码冲突仍在。'),
 'R3': ('FAIL', [2,2,2,1,3], '分层计算及芯材15→20mm任务未闭合；未实际计算。末轮仅给通用关系式，未核验VICP-CALC-1/α口径。'),
 'R4': ('PASS', [4,3,4,4,4], '无正式标准时明确未核验，不伪造限值、条号和生效时间，并给出需核对的资料；真实达标判定另列NOT_RUN。'),
 'R5': ('FAIL', [2,3,1,1,3], 'T1诊断命中2行但回答只展开整体法；T2身份零命中，后续Final/Confirm/PDF断链。'),
}
before = {case['caseId']: case for case in original['cases']}
reviewed = []
for case in matrix['cases']:
    status, scores, finding = reviews[case['id']]
    reviewed.append(dict(caseId=case['id'], originalStatus=before[case['id']]['status'], retestStatus=status, finding=finding,
        experience=dict(zip(['natural','concise','helpful','context','readable'], scores)),
        evidence=[f"h5-run-02/{case['id']}-final.png",f"h5-run-02/{case['id']}-T1.backend.json", 'h5-run-02/matrix.json'],
        downstream=case.get('chain', {})))
summary = {status: sum(item['retestStatus'] == status for item in reviewed) for status in ['PASS','PARTIAL','FAIL','NOT_RUN']}
assert summary == dict(PASS=1, PARTIAL=1, FAIL=8, NOT_RUN=0)
permissions = extras['permissions']
assert sum(p['kind'] in ['B_OWN_LIST','PC_OWN_LIST'] and p['success'] is True for p in permissions) == 2
assert sum(p['kind'] in ['OTHER_USER_CONVERSATION','CROSS_CLIENT_CONVERSATION'] and p['success'] is False and p['errorCode'] == 404 for p in permissions) == 22
upstream = load(RUN / 'upstream-requests.json')
semantic = [json.loads(line) for line in (RUN / 'semantic.ndjson').read_text(encoding='utf-8').splitlines() if line.strip()]

issues = [
 dict(id='F01', category='ENGINEERING_SOURCE', priority='P0', cases=['S3','R1','R2'], problem='资料页签5/6/33被称为印刷页码；原图实为25/26/53。'),
 dict(id='F02', category='ENGINEERING_SOURCE', priority='P0', cases=['S3','R1'], problem='T03原值15/190与T06 A3-3 λ=.0012的资料疑点仍待资料负责人治理；原值一致，不认定AI交换或擅改。'),
 dict(id='C01', category='CONVERSATION_TASK', priority='P0', cases=['S2'], problem='证据拼接不一致导致有效λ澄清失败；误报单位并丢后续数值目标。'),
 dict(id='C02', category='CONVERSATION_TASK', priority='P1', cases=['S2','S4','S5'], problem='通用澄清掩盖真实缺项；优势/比较没有提供可用帮助。'),
 dict(id='C03', category='CONVERSATION_TASK', priority='P0', cases=['R1'], problem='只读确认页的四条结果无法继续比较，后端称无可定位候选。'),
 dict(id='C04', category='CONVERSATION_TASK', priority='P0', cases=['S5','R5'], problem='正式查询→选择→Final未闭合，用户主动Confirm/PDF入口不可达。'),
 dict(id='C05', category='CONVERSATION_TASK', priority='P0', cases=['R3'], problem='缺计算任务/层身份续问合同；真实计算及冻结规则来源未核验。'),
 dict(id='C06', category='CONVERSATION_TASK', priority='P0', cases=['R5'], problem='正式双行命中后回答不完整，比较追问重新读成身份零命中；根因待进一步定位。'),
 dict(id='C07', category='CONVERSATION_TASK', priority='P1', cases=['S1'], problem='产品通俗介绍重复、空泛，带未请求系列覆盖提示。'),
]
not_run = [
 dict(id='UI-N01', capability='正式候选卡选用及Final冻结来源', reason='S5/R5前置链未形成可操作正式候选；不强造数据或以API代做UI。'),
 dict(id='UI-N02', capability='主动Confirm→Snapshot、幂等及Snapshot权限', reason='确认入口不可达，真实Snapshot=0。'),
 dict(id='UI-N03', capability='真实报告任务/Worker失败UI/PDF预览下载及文件权限', reason='报告=0；未借旧PDF或其他合成场景替代。'),
 dict(id='UI-N04', capability='原图像素区域高亮', reason='来源没有已核验坐标；界面明确提示未像素框选。表格档位高亮已单独通过。'),
]
result = dict(at=datetime.now(timezone(timedelta(hours=8))).isoformat(), verdict='FAIL', release='BLOCKED', scenarioResults=summary,
    userInputAttempts=38, fixedScenarioTurns=35, extraAttempts=3, completedSseTurns=37, missingModelRejectedSubmissions=1, reruns=0,
    upstreamHttpRequests=len(upstream), upstreamStatuses={str(code):sum(x.get('status') == code for x in upstream) for code in [200,400]}, semanticProposalTraces=len(semantic),
    originalEvidenceUnchanged=True, frozenPromptSha256=matrix['frozenSha256'], cases=reviewed, issues=issues,
    issueCounts=dict(ENGINEERING_SOURCE=2,CONVERSATION_TASK=7,UI_CONFIRMED_INDEPENDENT_P0=0,UI_NOT_RUN_GROUPS=4), notRun=not_run,
    permissionChecks=dict(passed=24,ownListAccessible=2,foreignAndCrossClientDenied=22,snapshotPdf='NOT_RUN'), finalCounts=runtime['counts'],
    localChecks=dict(backendTests='2796 PASS / 1既有expected fail / 1既有skip',backendLint='PASS',backendBuild='PASS',backendMigrationCheck='PASS',appTests='150 PASS',appH5Build='PASS',appTypeCheck='FAIL: @wot-ui/ui wd-button ButtonOpenType与_ButtonOpenType不兼容'),
    cleanup='PASS', tokenUsage='NOT_FULLY_CAPTURED', experienceAverage={key:round(sum(item['experience'][key] for item in reviewed)/10,2) for key in reviewed[0]['experience']})
save(OUT / 'reviewed-results.json', result)

head = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
files = {}
for folder in [BACKEND/'src',ROOT/'app/src']:
    for file in folder.rglob('*'):
        if file.is_file() and file.suffix in ['.ts','.vue','.mjs','.json','.scss']:
            files[file.relative_to(ROOT).as_posix()] = sha(file)
save(OUT / 'code-version.json', dict(head=head,workingTree='包含阶段03未提交修复；本轮不改产品实现',sourceHashes=files))

rows = '\n'.join(f"| {item['caseId']} | {item['originalStatus']} | {item['retestStatus']} | {item['finding']} |" for item in reviewed)
scores = '\n'.join(f"| {item['caseId']} | {' | '.join(str(value) for value in item['experience'].values())} |" for item in reviewed)
issue_rows = '\n'.join(f"| {item['id']} | {item['priority']} | {','.join(item['cases'])} | {item['problem']} |" for item in issues)
text = f'''# 固定场景复测与验收（2026-10-19）

验收结论：**FAIL，不具备上线验收通过条件**。按用户确认的 `D:/lg/04_阶段3_复测与验收.md` 执行；固定10组35轮结果为 **1 PASS / 1 PARTIAL / 8 FAIL**。本地测试通过不能抵消真实业务失败。阶段03的CODE_FIXED仍不等于H5已验收。

## 环境、版本与证据边界

- Git基线 `{head}`，包含阶段03本地未提交修复；当前实现指纹见 `evidence/phase04-retest-2026-10-19/code-version.json`。本轮仅增加验收脚本、证据和文档，没有修改产品实现、公式、已发布资料或原测试问题。
- Windows、Node {runtime['node']}、pnpm 11.17.0、PostgreSQL 18；真实上游模型 **deepseek-chat**，实际模型/场景/Prompt版本及内容哈希见 `h5-run-02/runtime-audit.json`。
- 业务对话执行时间为2026-10-19香港时间10:28–10:32，补测与UI复核另存；完整时间戳以各Trace为准。Edge headless真实H5，1280×900与390×844独立浏览器上下文。原生App及线上部署环境不在本次通过范围。
- 源连接强制READ ONLY，复制当前实际资料到随机独立库；确认页metadata逐项deepEqual。161物理页、319块、2条正式热工行、1个目录产品；不是合成工程Fixture，也不是全量资料已人工审核。原用户认证凭据未复制，归属代理去个人信息，专用A/B用户仅存在隔离库。
- 隔离Redis/BullMQ前缀、loopback API/H5与OSS报告写入前缀；源图仅GET读取。源数据指纹、复制数量和清理记录见各run的 `environment.json`。没有生产迁移、发布、部署、历史Snapshot/PDF改写。
- 冻结35个问题逐字核对UI提交body，35个HTTP 200 SSE完成态及持久消息齐全；独立补测3次输入，其中缺模型1次被业务错误拒绝，因此总计38次输入尝试、37次完成SSE、37 USER/37 ASSISTANT。没有业务问题重跑或改问法。原10组首轮与本轮证据分别保存。
- 捕获上游HTTP请求 **{len(upstream)}** 次（59次200、4次400，含兼容回退、标题、表达和有限复核），Domain提案 **{len(semantic)}** 条。不是38次输入对应38次模型调用。各请求Token/费用未完整采集，不推算。

## 原始与复测对照

原记录为0 PASS / 2 PARTIAL / 8 FAIL，保持原件不覆盖。S1介绍目标部分改善；S2本轮比原记录退化，不能用以后偶然成功覆盖。R4的PASS仅指缺标准时正确解释与不编造，真实工程达标判定仍NOT_RUN。

| 场景 | 原始 | 本轮 | 完成态观察 |
| --- | --- | --- | --- |
{rows}

S5与R5均发送全部7轮，但“查询→选择→Final→UI Confirm→Snapshot→UI PDF”完整链均 **FAIL**。第6轮后页面没有可用“确认生成方案”，第7轮也无可用PDF入口，两个主动UI操作均NOT_RUN，没有用API或旧PDF补做。最终11会话，SolutionState/Snapshot/Report/Calculation均0。不存在可用于测试冻结、幂等和产物权限的真实Snapshot/PDF。

## 工程事实、对话和UI分别统计

独立验收项：工程事实/来源2项；对话与任务7项（P0五项、P1两项）。UI未确认独立的P0显示实现故障，但4组关键能力未验，不能据此写UI全部通过。统计为验收项，可涉及同一场景，不声称已定位9个独立代码根因。

| 问题 | 级别 | 场景 | 证据与影响 |
| --- | --- | --- | --- |
{issue_rows}

其中C01已定位到 `src/modules/ai/product-parameter-query.ts:20`：验证scope为“原问+换行+本轮”，而真实提案evidence为无换行拼接“有保温0.3的材料吗？导热系数。”；`scope.includes(query.evidence)`失败，返回了单位提示。两次真实提案均为LAMBDA、EXACT .3、标准单位，不能描述为用户单位错误。第三轮已不再有原数值pending。对应 `semantic.ndjson`、S2-T2/S2-T3原始SSE和backend证据全部保留。

R5-T1的真实有限复核将两正式编码核验通过，诊断matchedCount=2，最终正文只展开整体25mm；T2为REFINE_QUERY但identityCount=0。后续如何丢失对象仍须定位，不以猜测放宽权限、置信度或来源门槛。R3末轮仅通用公式关系说明，未证明冻结版本/修正系数，不能计作真实计算通过。源T03的15/190和T06的.0012按原资料保留，不再沿用旧报告“AI交换原值”的错误归因。

## UI与补测结果

已实际执行并有完成态证据：R1两来源组回读、原图25/26打开与原图全屏；R2原图53打开与全屏；两页各2个45mm表格档位高亮、“下一处”、取消/恢复高亮；390px全屏表格根宽/正文宽均390，无整页横向溢出；历史恢复与刷新读取。表格本身保留横向滚动，窄屏不能同时读完所有列，不将它描述为所有列同时可见。

关键截图：`h5-run-02/R1-table-page5-complete.png`、`R1-table-page6-next.png`、`R1-table-page6-390-complete.png`、`R1-source-loaded.png`、`R1-source-page6.png`、`R2-source-original.png`、`R2-source-fullscreen-390.png`。高亮数值、切换和宽度证据见 `table-audit-complete.json`。源图页签仍错，操作成功不抵消F01。

| 能力 | 判定 | 实证边界 |
| --- | --- | --- |
| VICP正式简称 | PASS | 产品介绍与通俗续问可绑定唯一当前目录项；介绍措辞另为PARTIAL |
| VLCP拼写提示 | PASS | EX-VLCP友好确认，不自动返回VICP产品事实 |
| 换话题 | PASS（有限样本） | EX-TOPIC显式换到VICP介绍，未沿用上轮错误名称；不外推所有工程任务切换 |
| 缺模型不伪造计算 | PASS（安全项） | 隔离模型enabled=false后返回“模型已停用”，无新assistant计算事实、无计算/快照/报告；开关恢复并只读重验 |
| 断网与恢复 | PASS（有限样本） | 历史页离线真实报“连接服务器超时，点击屏幕重试”；恢复网络点击后读取11条历史；未测发送中的断网重连 |
| 会话权限 | PASS | 22次跨用户/跨客户端404拒绝，2次对应本人列表成功，非以500冒充权限拒绝 |
| 正式候选卡选用/Final | NOT_RUN | S5/R5前置候选及正式选择链未成立 |
| Confirm/Snapshot冻结、幂等及权限 | NOT_RUN | 确认入口不可达，Snapshot=0 |
| 报告任务失败UI/PDF预览下载及产物权限 | NOT_RUN | Report=0，无PDF证据路径；不拿其他旧场景PDF替代 |
| 原图像素区域高亮 | NOT_RUN | 无已核验坐标，界面明示未像素框选；表格档位高亮已另验 |

## 体验评分

人工基于本轮完整回答、完成态截图与DOM逐场景评分，1–5分，越高越好；不能抵消硬性FAIL。

| 场景 | 自然 | 简洁 | 帮助性 | 上下文 | 可读性 |
| --- | --- | --- | --- | --- | --- |
{scores}

平均：自然2.5、简洁2.8、帮助性2.0、上下文2.3、可读性3.3。主要问题是澄清目标空泛、只读结果与比较/正式操作断链、对无资料问题未提供足够下一步帮助。

## 工程检查与交付限制

- Backend：2796 passed / 1既有expected fail / 1既有skip；lint（含语义AST与TypeScript）、db:check、build均通过。保留产品组5.0/芯层4.8口径的既有expected fail，不改VICP-CALC-1。
- App：150测试通过，H5生产构建通过；`pnpm type-check` **FAIL**，`node_modules/@wot-ui/ui/components/wd-button/wd-button.vue(21,6)`的 `ButtonOpenType | undefined` 与 `_ButtonOpenType | undefined` 不兼容。没有为验收通过而改依赖/忽略类型。
- 原交接包313文件、10场景35轮再次验核通过，见 `package-recheck.txt`。本轮全部判定见 `reviewed-results.json`，输入/SSE/后端状态见 `h5-run-02/matrix.json`及每轮文件；运行时版本见 `runtime-audit.json`。
- 首次浏览器工具两次初始化均报kernel assets路径不存在，改用本机Edge。run-01为采集器/环境预检：未发业务模型问题；旧观察器报告字段不存在与后续登录500保留，环境已清理。该预检不能冒充35轮产品FAIL或业务重跑。run-02两次extras导入预检未发问题；缺模型旧采集器误关联上一条旧回答、恢复断言Result原型差异均已修正且保留中间记录，未重发问题。导航中间态空白截图保留，表格完整态另存复核，不能将空白中间帧当完成态。

清理已独立核验：两个本轮随机库均不存在、Redis两个专用前缀0键、OSS两个专用前缀0对象；API/H5端口停止，专用密码文件删除，浏览器独立上下文关闭，视口已恢复。证据见 `cleanup-proof.json` 与 `local-cleanup.json`。临时前端影子副本/依赖链接保留为本机缓存，无测试凭据；没有递归删除共享依赖。

上线阻断项仍为F01/F02及C01/C03/C04/C05/C06，另需解决App类型检查失败。应先修复和治理再另轮复测；本轮无完整UAT通过、无提交、无部署。
'''
(BACKEND / 'docs/ai/phase04-retest-2026-10-19.md').write_text(text, encoding='utf-8')

entry = '2026-10-19 阶段04固定场景真实H5复测：10组35轮原问逐字执行，1 PASS/1 PARTIAL/8 FAIL，总验收FAIL；另有VLCP/换话题/缺模型3次输入补测，22次越权拒绝及2次本人列表成功。R1多页原引用和R2屋面命中改善，但S2证据换行拼接拒绝、R1比较、S5/R5正式闭环和R3计算续问未通过；页码/原值资料疑点保留。Snapshot/报告/计算均0，Confirm/PDF及其幂等/权限NOT_RUN；后端2796和App150测试/H5构建通过，App依赖按钮类型检查失败。只操作独立随机库/队列/OSS前缀，已独立核验清理；无产品实现改动、生产迁移或部署。见docs/ai/phase04-retest-2026-10-19.md。'
for target in [BACKEND/'AGENTS.md', BACKEND/'README.md', BACKEND/'.cursor/rules/30-ai-and-reports.mdc', BACKEND/'.agents/skills/lg-backend/references/ai-and-reports.md']:
    content = target.read_text(encoding='utf-8-sig')
    if entry not in content:
        # 前置Frontmatter保持其语法有效。
        if content.startswith('---\n'):
            end = content.find('\n---', 4) + 4
            content = content[:end] + '\n\n' + entry + '\n' + content[end:]
        else:
            first = content.find('\n')
            content = content[:first+1] + '\n' + entry + '\n' + content[first+1:]
        target.write_text(content, encoding='utf-8')

manifest = {}
for file in sorted(OUT.rglob('*')):
    if file.is_file() and file.name != 'evidence-manifest.json':
        manifest[file.relative_to(OUT).as_posix()] = {'bytes':file.stat().st_size, 'sha256':sha(file)}
save(OUT/'evidence-manifest.json', dict(createdAt=result['at'], files=manifest, reportSha256=sha(BACKEND/'docs/ai/phase04-retest-2026-10-19.md')))
print(json.dumps(dict(verdict='FAIL', scenarioResults=summary, evidenceFiles=len(manifest), report='docs/ai/phase04-retest-2026-10-19.md'), ensure_ascii=False))
