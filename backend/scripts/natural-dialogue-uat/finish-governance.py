from pathlib import Path
root=Path(__file__).resolve().parents[2]
paths=['AGENTS.md','README.md','.cursor/rules/30-ai-and-reports.mdc','.agents/skills/lg-backend/references/ai-and-reports.md']
old='当前真实验收进行中，无生产部署/迁移/资料或历史快照改写。'
new='冻结代码真实复测已完成：原35问23 PASS/7 PARTIAL/5 FAIL，结论NOT_READY。参数定义与介绍改写分开，空动作按真实方案状态回答；原始条件、来源及候选门禁保持。35mm/25mm绑定冲突、正式模板占位、咨询长清单/定性关联词和知识索引污染仍有未解决事项，不因单方案PDF或自动测试通过而恢复READY。详见本轮报告与逐轮证据；无生产部署/迁移/资料或历史快照改写。'
for relative in paths:
 p=root/relative
 text=p.read_text(encoding='utf-8-sig')
 assert text.count(old)==1,relative
 p.write_text(text.replace(old,new),encoding='utf-8')
print('Updated only the four dated governance sections')
