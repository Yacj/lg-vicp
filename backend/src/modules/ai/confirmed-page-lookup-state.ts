import { z } from "zod";
import { thermalQueryStateSchema } from "../thermal/thermal-query-state.js";

export const confirmedPageLookupSchema = z.object({
  query: thermalQueryStateSchema, createdAt: z.string(), conversationId: z.string(), userId: z.string(),
  projectId: z.string().nullable(), clientApp: z.string()
});
export type ConfirmedPageLookup = z.infer<typeof confirmedPageLookupSchema>;
export function currentConfirmedPageLookup(value: unknown, conversation: { id: string; userId: string; projectId: string | null; clientApp: string }, now = Date.now()) {
  const parsed = confirmedPageLookupSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const row = parsed.data, age = now - Date.parse(row.createdAt);
  return Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000 && row.conversationId === conversation.id
    && row.userId === conversation.userId && row.projectId === conversation.projectId && row.clientApp === conversation.clientApp ? row : undefined;
}
