import { expect, it } from "vitest";
import { legacyConfirmedPagePart } from "./legacy-confirmed-page-scope.js";
it.each(["建筑外墙热工计算参考选用表", "建筑外墙热工计算参考选用表（III型VICP薄抹灰外保温系统）", "建筑外墙热工计算参考选用表(I型)", "建筑 外墙 热工计算参考选用表", "建筑屋面热工计算参考选用表（II型VICP屋面系统）"])("SM-LEGACY-PAGE-SCOPE-01明确正式表名%s", title => {
  expect(legacyConfirmedPagePart(title)).toBe(title.includes("屋面") ? "ROOF" : "EXTERNAL_WALL");
});
it.each(["外墙材料介绍", "不是建筑外墙热工计算参考选用表", "引用：建筑外墙热工计算参考选用表", "建筑外墙热工计算参考选用表与屋面表比较", "III型VICP外保温系统", "", undefined])("不从无正式表名%s猜部位", title => {
  expect(legacyConfirmedPagePart(title)).toBeUndefined();
});
