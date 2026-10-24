import { asc, desc, sql } from "drizzle-orm";
import { aiMessages } from "../../db/schema.js";

/** 同事务问答共享createdAt；角色先后表达轮次关系，UUID仅作最终稳定排序。逆序读取必须完全对称。 */
export function messageChronology(direction: "ASC" | "DESC") {
  const order = direction === "ASC" ? asc : desc;
  const roleOrder = sql<number>`case ${aiMessages.role} when 'SYSTEM' then 0 when 'USER' then 1 when 'ASSISTANT' then 2 else 3 end`;
  return [order(aiMessages.createdAt), order(roleOrder), order(aiMessages.finishedAt), order(aiMessages.id)];
}
