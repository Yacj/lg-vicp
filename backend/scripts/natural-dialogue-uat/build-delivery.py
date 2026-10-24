"""Build the delivery index from reviewed evidence, without changing raw UAT results."""
from pathlib import Path
import json, hashlib, difflib, re

root = Path(__file__).resolve().parents[2]
ev = root / 'docs/ai/evidence/natural-dialogue-repair-2026-10-20'
final = ev / 'round-22-final'
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
review = read(final / 'business-review.json')
manifest = read(ev / 'change-manifest.json')
security = read(final / 'security-acceptance.json')
conditions = read(final / 'independent-condition-audit.json')
artifacts = read(final / 'independent-artifact-audit.json')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
patch, files = [], ['''# 本轮修改文件

按本轮开始前的工作区快照比较；其他任务原有修改保留。

| 文件 | 类型 | 增/删行 |
| --- | --- | --- |
''']
for entry in manifest:
    p = root / entry['path']
    assert sha(p) == entry['afterSha256']
    original = ev / 'baseline' / (entry['path'] + '.txt')
    before = original.read_text(encoding='utf-8-sig').splitlines(keepends=True) if entry['type'] != 'ADDED' else []
    after = p.read_text(encoding='utf-8-sig').splitlines(keepends=True)
    diff = list(difflib.unified_diff(before, after, fromfile='a/backend/'+entry['path'], tofile='b/backend/'+entry['path']))
    patch.extend(diff)
    added = sum(x.startswith('+') and not x.startswith('+++') for x in diff)
    removed = sum(x.startswith('-') and not x.startswith('---') for x in diff)
    files.append(f"| [{entry['path']}](D:/work/lg-vicp/backend/{entry['path']}) | {entry['type']} | +{added}/−{removed} |\n")
(ev / 'repair.patch').write_text(''.join(patch), encoding='utf-8')
(ev / 'modified-files.md').write_text(''.join(files), encoding='utf-8')

history = []
for directory in sorted(ev.iterdir()):
    p = directory / 'business-review.json'
    if not p.is_file(): continue
    r = read(p)
    if r.get('counts') and len(r.get('turns', [])) == 35:
        c = r['counts']; history.append(f"| [{directory.name}](evidence/natural-dialogue-repair-2026-10-20/{directory.name}/business-review.json) | {c['PASS']} | {c['PARTIAL']} | {c['FAIL']} |")

log = (ev / 'backend-tests-final-16.log').read_text(encoding='utf-8-sig')
match = re.search(r'Tests\s+(\d+) passed\s+\|\s+1 expected fail\s+\|\s+1 skipped', log)
assert match
backend_tests = int(match[1])
model_calls = [x for x in read(final/'upstream-requests.json') if x.get('model')]
models = sorted({x['model'] for x in model_calls})
assert models == ['deepseek-chat']
assert all(not (x.get('responseFormat') or {}).get('schemaPresent') for x in model_calls)
counts = review['counts']
table = ['| 回合 | 原始问题 | 判定 | 依据 |', '| --- | --- | --- | --- |']
for row in review['turns']:
    question = row['userMessage'].replace('|', '\\|').replace('\n','<br>')
    table.append(f"| [{row['key']}](evidence/natural-dialogue-repair-2026-10-20/round-22-final/{row['key']}.sse.txt) | {question} | **{row['status']}** | {row['reason']} |")

report = f'''# 小格 AI 自然对话修复与最终 UAT（2026-10-20）

**结论：NOT_READY。** 本轮代码修复已合入原工作区，未再次部署线上。原始35问全部执行，最终 **{counts['PASS']} PASS / {counts['PARTIAL']} PARTIAL / {counts['FAIL']} FAIL**；仍有资料、正式报告模板及咨询质量缺项，不能据自动测试或单方案闭环给出 READY。

## 修复范围与根因

产品咨询以当前有权、已发布知识库为主要依据，正式目录为补充；目录只有一个SKU不代表产品全集。知识库原表中的板材/材料层、正式供货规格、整构造参数分别保留身份和来源。

| 根因 | 本轮处理 |
| --- | --- |
| 模型重建请求，澄清轮丢失数值、比较符、名称或查询目标 | Backend按同会话/用户/客户端/项目和24小时有效期串联原问与补充；执行前后检查条件不扩大；服务独立重验 |
| 未知名称被删除后重查，λ只读变成全库混合列表 | 保留原名称及范围；无法可靠绑定则说明缺项，不转成无条件全库READ |
| 多套语义字段冲突，来源校验错误污染其他字段；重试未经过相同来源校验 | 字段校验隔离；原提案与修正提案统一进入来源绑定。模型只提来源显示名，Backend唯一绑定已发布来源；不改变原查询条件或降低门槛 |
| 产品追问范围、参数参照值和结果列表混在一起 | 参数焦点绑定实际展示值与来源/Revision；其他产品列表不覆盖原焦点。单值、同值、更低、修改目标和换话题分别处理 |
| 介绍、参数定义和改写表达混为一类 | 区分REPHRASE、PARAMETERS、EXPLAIN_PARAMETER、FIND_OTHERS；只读复核不能补名称、数值、ID或操作授权；解释λ不再落入只支持K/R的热工DEFINE |
| 同名对象命中一个值后携带其他未命中属性；原页多轮比较重复 | 按满足条件的属性与对应来源过滤；按文档/版本/页面/Revision/构造/档位去重，不按相同数值合并不同来源 |
| 为避免编数值而固定拼模板；自由表达又把隐藏值说成缺资料 | Backend提供对象/属性/来源事实；模型自然组织后逐对象数值核验，并核验别名、派生结论、参数存在声明及没有审核简介支持的内部构造/芯材/机制/优势推断。概览明确“本轮不展开数值”，不能声称资料缺参；失败回落仅事实回答 |

保留正式候选身份、权限、来源、Revision、计算版本、Final/Confirm、不可变Snapshot与报告授权保护。没有修改生产数据、原表疑点、历史快照或已发布计算规则；没有更换DeepSeek模型，没有添加失败原句专用正则。

动作Parser返回NONE时，生成编排直接读取真实方案状态回答，不再落入自由生成；未形成Final就明确说明前置缺失，不声称已保持待确认。

## 真实验收环境与证据

运行工作区：`C:/Users/admin/.codex/worktrees/natural-dialogue-repair/lg-vicp`；最终源码已按SHA256核对合入`D:/work/lg-vicp`。本轮开始时原工作区224份已有修改/新增文件的快照已保留；仅合入本轮清单，未回退并行任务工作。

- 实际Edge H5页面，真实HTTP/SSE，当前批准模型DeepSeek Chat；最终轮实际记录{len(model_calls)}次上游模型HTTP请求，未使用严格JSON Schema接口或Mock。
- 来源连接强制只读，复制当前资料到随机独立数据库；测试账号、Redis队列和生成报告OSS前缀隔离。测试数据没有伪造工程参数。
- 固定35问原文件SHA256：`59f1de38bfb5d48bb9fb4207e4e1b48175342f52b7fe201bc7fcecbe35342857`，原问逐字保留。
- 最终轮执行四组人工失败原问7轮、产品链5轮、参数修改/换话题5轮、原35问、补充自然追问7轮，另有单方案H5按钮流程，并在独立新会话重复7轮产品追问（共67次实际用户输入）。[附加31轮判定](evidence/natural-dialogue-repair-2026-10-20/round-22-final/extra-business-review.json)为26 PASS / 5 PARTIAL。补充样本由同一执行者审阅，**不冒充独立人工盲测**。
- [原始35问运行记录](evidence/natural-dialogue-repair-2026-10-20/round-22-final/matrix.json)、[逐轮判定](evidence/natural-dialogue-repair-2026-10-20/round-22-final/business-review.json)、[真实Semantic轨迹](evidence/natural-dialogue-repair-2026-10-20/round-22-final/semantic.ndjson)、[查询条件核验](evidence/natural-dialogue-repair-2026-10-20/round-22-final/independent-condition-audit.json)。原始执行状态保留，不把EXECUTED_REVIEW_REQUIRED改成自动PASS。

## 自动检查与真实业务链

| 检查 | 结果与边界 |
| --- | --- |
| Backend全量 | {backend_tests}通过，1个既有预期失败，1跳过；构建、类型及语义AST检查通过 |
| 既有预期失败 | 客户分层例完整产品R=5.0，当前规则只累加PRODUCT_LAYER芯材R=4.8；已标口径，不混称。正式修正须产品组/子层定义与新公式版本，未修改原规则 |
| PDF依赖跳过 | 实际图集PDF的CAD/目录回归缺少该用例依赖源文件；与本轮实际生成的报告PDF是不同检查 |
| App | 155测试通过，类型检查及H5构建通过；本轮未修改App运行代码。构建仍有原有Browserslist/图标告警 |
| 查询条件与数据 | λ执行{len(conditions['parameterExecutions'])}次、产品条件{len(conditions['productFilters'])}组，返回值越界0；S3保留III型+K=0.3+体系；冻结源码漂移0。另核对S5的Excel来源、200mm钢筋混凝土范围 |
| 分层计算 | 独立按客户公式核对15mm芯材R=4.8、总R=5.3068220978、K=0.1884366918；改20mm后芯材R=6.4、总R=6.9068220978、K=0.1447843865。固定层和表面热阻保留，未作规范达标结论 |
| 单方案真实闭环 | 以唯一合格25mm候选执行查询卡片→历史恢复→选用→Final→手动Confirm→Snapshot→真实PDF；不代替双候选比较验收 |
| 权限与冻结回归 | {len(security['checks'])}项通过，含真实存在的私有项目、其他用户/客户端/未登录访问、候选成员、旧Revision、重复确认、Snapshot会话/项目绑定和报告访问；快照数量不被负向检查改变 |
| 原页/表格 | 实际图片加载、全屏表格、高亮切换/清除与390px窄屏核验。表头继续按客户原表显示投影；缺已核验坐标时明确说明未做像素框选 |
| PDF | 实际下载{artifacts['pdf']['pages']}页PDF，Snapshot/规格/来源/K/R文字核对及逐页独立渲染；预览接口取得文件与实际浏览器下载文件SHA256一致。**下载通过；浏览器预览截图为空白，不能判直接阅读体验通过；预览PARTIAL。** 内部免责声明占位仍在，内容验收PARTIAL；无原生手机及所有浏览器PDF阅读器兼容性结论 |

[权限原始结果](evidence/natural-dialogue-repair-2026-10-20/round-22-final/security-acceptance.json)、[单方案按钮记录](evidence/natural-dialogue-repair-2026-10-20/round-22-final/single-flow.json)、[PDF入口及真实文件响应](evidence/natural-dialogue-repair-2026-10-20/round-22-final/pdf-ui-audit-02.json)、[独立公式/PDF内容核验](evidence/natural-dialogue-repair-2026-10-20/round-22-final/independent-artifact-audit.json)。浏览器下载转交时出现的ERR_ABORTED与实际下载事件及完整字节一并核对，没有将网络码单独作为业务结论。

## 原始35问逐轮判定

{chr(10).join(table)}

## 修复过程中的完整35问复测

以下仅统计真正执行完整35问且有逐轮判定的轮次。其他编号为定向、环境检查或无效中断，不称为完整UAT。round-14因工作区源码意外回退而作废，保留证据；未把它计入通过记录，恢复后重测。未确定回退来源，不归因于其他任务。

| 完整轮次 | PASS | PARTIAL | FAIL |
| --- | --- | --- | --- |
{chr(10).join(history)}

## 尚未解决及上线门槛

1. **35mm分层正式候选资料冲突。** VICP-LAYERED的35mm参考行绑定VICP-BOARD-25（25mm）。用户确认暂无正式规格/绑定修订依据，因此保留原值并排除。S5/R5要求的双候选比较及保留分层参考的完整链路未通过；不能造35mm规格或把原页材料层升级为正式候选。需要资料负责人发布可验证的新规格/绑定版本后重新执行双方案及报告验收。
2. **正式报告模板仍有内部占位。** 用户已批准正文“本报告由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。”；[版本变更准备](approved-report-template-change-2026-10-19.json)已保留，尚未改生产模板。需要按现有新版本审核/发布流程处理，再重生成并验收，历史报告保持。
3. **咨询质量与软件表达仍有PARTIAL。** S1-T2仍偏长清单，“配套”等关联词缺独立证据；部分单产品介绍/改写仍退成资料清单。这不是全部由外部数据造成，尚未达到完整客服表达要求，后续需要完善通俗概览组织、限定定性关联、以及KB原文证据的安全接入。优势/竞品比较暂无可用审核比较事实；不能把目录summary空直接当作知识库绝无介绍。当前候选不等于Final，前置失败后的说明仍可更具体。
4. **原始资料与正式口径缺项。** A2-2基层15mm/档位190mm、A3-3 λ=0.0012和部分页码/标题疑点原值保留并提示；暂无正式勘误。正式分层产品整体R口径需新计算版本治理；当前没有已发布适用标准数据，不能给规范达标结论。
5. **知识索引质量。** [只读资料审计](evidence/natural-dialogue-repair-2026-10-20/round-22-final/knowledge-scope-audit.json)显示当前全局发布范围有158个有效切片，类型为39段落/18标题/101章节，但抽读实际多为热工表文本；13个章节标题含纯数值、表格残片等污染。不能按切片类型断言没有表或没有产品，后续需审核原文证据与索引治理方案，不直接改已发布工程记录。

6. **人工最终验收未替代。** 同执行者的补充问法、Edge H5和文件检查不代表独立人工盲测、生产部署验收或原生手机全机型验证。修复代码未再次发布线上；完成资料/模板前置后应使用同一原35问及双方案链路复验。

7. **浏览器内PDF阅读未通过最终验收。** 真实H5预览按钮已打开文件地址并收到PDF字节，但本次浏览器预览截图为空白。独立PDF渲染正常不等于浏览器内阅读正常；需在有界面的真实浏览器/手机中复核后才能判断环境限制或软件问题，本轮保留PARTIAL，不归因为已解决。

浏览器还保留两条读取未暴露content-disposition的非阻断警告；实际下载事件、文件名及完整字节已核对通过，本轮没有修改该跨域头配置。

## 交付文件与资源清理

本轮{len(manifest)}份实现/测试/治理文件见[修改清单](evidence/natural-dialogue-repair-2026-10-20/modified-files.md)、[前后SHA256](evidence/natural-dialogue-repair-2026-10-20/change-manifest.json)及[基于本轮初始工作区的补丁](evidence/natural-dialogue-repair-2026-10-20/repair.patch)。新增复测脚本在`scripts/natural-dialogue-uat/`；完整原始证据保存在上述目录。未提交或推送Git，未部署、迁移、seed或改写生产资料/快照。

独立数据库、队列与本轮生成OSS对象按各轮environment.json的cleanup记录核验；汇总见[清理与合入核验](evidence/natural-dialogue-repair-2026-10-20/delivery-integrity.json)。源码工作区保留供审阅和复现。
'''
(root/'docs/ai/natural-dialogue-repair-2026-10-20.md').write_text(report, encoding='utf-8')
print(json.dumps(dict(files=len(manifest), backendTests=backend_tests, counts=counts, modelCalls=len(model_calls), status='NOT_READY')))
