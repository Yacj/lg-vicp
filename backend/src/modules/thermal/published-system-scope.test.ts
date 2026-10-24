import { expect, it } from "vitest";
import { publishedSystemApplicationPart } from "./published-system-scope.js";
it("发布类别精确归一，不从名称或相似词猜部位", () => {
  expect(publishedSystemApplicationPart("外墙外保温")).toBe("EXTERNAL_WALL");
  expect(publishedSystemApplicationPart("屋面")).toBe("ROOF");
  for (const text of [undefined, "其他", "VICP复合保温板外墙", "可能是外墙", "屋面外墙两用"]) expect(publishedSystemApplicationPart(text)).toBeUndefined();
});
