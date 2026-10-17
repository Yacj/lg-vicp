import "dotenv/config";
import { desc, eq, and } from "drizzle-orm";
import { createUatEnvironment } from "../tests/uat/environment.js";
import { sendTurn } from "../tests/uat/sse.js";
import { aiMessages } from "../src/db/schema.js";

const env = await createUatEnvironment();
try {
  const user = await env.createUser("SALES", "diag-clarify2");
  const created = await fetch(`${env.baseUrl}/api/v1/ai/conversations`, { method: "POST",
    headers: { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ clientApp: "pc_ai", scene: "general_chat" }) }).then(r => r.json() as Promise<any>);
  const conversationId = created.data.conversation.id;
  for (const text of ["有保温0.3的材料么", "导热系数"]) {
    await sendTurn(env.baseUrl, user.token, conversationId, text, () => {});
    const [row] = await env.db.select({ metadata: aiMessages.metadata, content: aiMessages.content }).from(aiMessages)
      .where(and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.role, "ASSISTANT"), eq(aiMessages.status, "COMPLETED")))
      .orderBy(desc(aiMessages.createdAt)).limit(1);
    const md = (row?.metadata ?? {}) as any;
    const d = md.backendDecision ?? {};
    console.log(JSON.stringify({ text, domainIntent: d.domainIntent, requestedEffect: d.requestedEffect, relation: d.relation,
      policyReason: d.policyReason, parserSource: d.parserSource, semanticConfidence: d.semanticConfidence,
      queryContextMessageId: d.queryContextMessageId ?? null, unresolved: d.unresolved,
      pageQuery: d.pageQuery ? d.pageQuery.constraints?.length : null, answer: String(row?.content ?? "").slice(0, 90) }));
  }
} finally {
  await env.cleanup();
  console.log("cleaned");
}
