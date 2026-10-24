# PDF 模板文案变更准备

真实生成 PDF 中的免责声明为：

> 本报告由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。（免责声明正式措辞待甲方确认）

该文字来自现有模板/冻结配置，实际证据见 `evidence/full-chain-uat-2026-10-19/round-12-calc-page/pdf-page-3.png`，默认模板文字位于 `src/modules/reports/report-template.service.ts` 的 `DEFAULT_DISCLAIMER`。它不是工程计算错误，但仍包含面向内部的待确认占位说明。

用户已确认采用（2026-10-19）：保留既有正文，仅去掉内部占位说明：

> 本报告由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。

封面现有“生成文件不等于已审核或已发布”、未做合规核验、冻结事实及需专业审核的提示继续保留。用户授权为“确认采用这句，准备模板变更”，此处记录文案确认，不代替既有发布流程。

由有权管理员按既有模板/报告设置流程发布；新报告冻结新的配置版本。历史快照与历史 PDF 保留原样，本轮不直接修改生产数据或已发布模板。正式发布前应以确认后的真实配置重验一次报告。

已准备三个模板的版本变更请求：[approved-report-template-change-2026-10-19.json](approved-report-template-change-2026-10-19.json)。每项包含正式源版本ID、版本号、原章节SHA256、新章节和变更说明。只变更免责声明章节正文。生产执行时先核对源指纹，再按new-version返回的新ID完成PATCH、validate、submit、approve、publish，不能原地改已发布版本。

隔离验证使用实际权限与版本状态机，三个模板分别派生并发布v2，普通C端账号派生版本被拒绝，v1的章节JSON保持原样。修复了原有工作流响应字段转换缺陷后，15个编辑/校验/审核/发布步骤及3次新版本派生成功。最终复测详情见 `evidence/full-chain-uat-2026-10-19/round-21-final/approved-template-change.json`；本轮三类实际PDF共9页已核验正文及冻结版本。生产变更尚未执行。
