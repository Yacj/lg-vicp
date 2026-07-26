import type { AuthUser } from "../../shared/auth-user.js";
import type { FileRecord } from "../../db/schema.js";

export function canAccessSourceFile(user: AuthUser, file: Pick<FileRecord, "ownerUserId">): boolean {
  return user.role === "SUPER_ADMIN" || file.ownerUserId === user.id;
}
