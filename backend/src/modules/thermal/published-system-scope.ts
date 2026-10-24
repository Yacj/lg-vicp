/** 发布目录类别的精确字段归一，不从用户词形、产品名称或型号猜部位。未知类别保持缺值。 */
export function publishedSystemApplicationPart(systemType: unknown) {
  const types: Record<string, "EXTERNAL_WALL" | "ROOF"> = { EXTERNAL_WALL: "EXTERNAL_WALL", "外墙": "EXTERNAL_WALL", "外墙外保温": "EXTERNAL_WALL", ROOF: "ROOF", "屋面": "ROOF" };
  return typeof systemType === "string" && Object.hasOwn(types, systemType) ? types[systemType] : undefined;
}
