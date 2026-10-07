import type { ReferenceLookupCandidate } from "../../../src/modules/ai/conversation-task.js";

// 手工核验的测试真值；不调用 Parser、Matcher 或计算 Service 生成预期结果。
export const REFERENCE_FACTS = [
  { schemeCode: "A1-3", specClass: "I", thicknessMm: 18, productThermalResistance: 2.880, totalThermalResistance: 3.297, kValue: 0.303, sourcePageLabel: "22" },
  { schemeCode: "A1-4", specClass: "I", thicknessMm: 20, productThermalResistance: 3.200, totalThermalResistance: 3.390, kValue: 0.295, sourcePageLabel: "23" },
  { schemeCode: "A1-3", specClass: "I", thicknessMm: 25, productThermalResistance: 4.000, totalThermalResistance: 4.417, kValue: 0.226, sourcePageLabel: "22" },
  { schemeCode: "B1-1", specClass: "II", thicknessMm: 18, productThermalResistance: 2.500, totalThermalResistance: 2.917, kValue: 0.343, sourcePageLabel: "24" }
] as const satisfies readonly Partial<ReferenceLookupCandidate>[];

export const A13 = REFERENCE_FACTS[0];
export const A14 = REFERENCE_FACTS[1];
export const FIXTURE_VERSION = "vicp-business-uat-1";
export const FIXTURE_TEXT = `销售与设计院 UAT 测试图集（合成验收资料，禁止用于实际工程）。
I型 VICP薄抹灰外保温系统：A1-3，18mm，产品层热阻2.880 m²·K/W，总热阻3.297 m²·K/W，传热系数K=0.303 W/(m²·K)，印刷页22。
A1-4，20mm，产品层热阻3.200，总热阻3.390，K=0.295，印刷页23。
A1-3，25mm，产品层热阻4.000，总热阻4.417，K=0.226，印刷页22。
II型 VICP薄抹灰外保温系统：B1-1，18mm，产品层热阻2.500，总热阻2.917，K=0.343，印刷页24。
I型产品当量导热系数λ=0.005 W/(m·K)，修正系数α=1.25。产品层R=δ/(λ×α)。A1-3基层为240mm灰砂砖，λ=0.9。Ri=0.11、Re=0.04 m²·K/W。
图集参考值与按厚度重新计算的系统计算值分别标注。该测试资料没有任何地区法规合规依据；上海或其他地区项目需要真实发布标准与适用条件，不能宣称达标。
VICP的低导热系数有助于减少达到同一热阻所需的厚度，不能据此推断全部构造的防火等级或成本。
岩棉测试产品λ=0.040 W/(m·K)、α=1.0，厚度50mm；仅支持同热工条件比较，未提供防火/造价证据。`;
