import { and, eq, isNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Database } from "../../db/client.js";
import { departments, userDepartments, users } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { assertDepartmentMemberRole } from "../users/user-admin.policy.js";

export type DepartmentMemberItem = {
  userId: string;
  displayName: string;
  phone: string | null;
  role: typeof users.$inferSelect["role"];
  status: typeof users.$inferSelect["status"];
  isPrimary: boolean;
  joinedAt: Date;
};

export async function listDepartmentMembers(db: Database, departmentId: string): Promise<DepartmentMemberItem[]> {
  const [department] = await db.select({ id: departments.id }).from(departments)
    .where(and(eq(departments.id, departmentId), isNull(departments.deletedAt))).limit(1);
  if (!department) throw new NotFoundError("部门不存在");

  const rows = await db.select({
    userId: users.id,
    displayName: users.displayName,
    phone: users.phone,
    role: users.role,
    status: users.status,
    isPrimary: userDepartments.isPrimary,
    joinedAt: userDepartments.createdAt
  }).from(userDepartments)
    .innerJoin(users, eq(users.id, userDepartments.userId))
    .where(and(eq(userDepartments.departmentId, departmentId), isNull(users.deletedAt)));

  return rows;
}

export async function addDepartmentMember(input: {
  db: Database;
  request: FastifyRequest;
  actor: AuthUser;
  departmentId: string;
  userId: string;
  isPrimary?: boolean;
}) {
  const [department] = await input.db.select({ id: departments.id }).from(departments)
    .where(and(eq(departments.id, input.departmentId), isNull(departments.deletedAt))).limit(1);
  if (!department) throw new NotFoundError("部门不存在");

  const [user] = await input.db.select({
    id: users.id,
    role: users.role
  }).from(users).where(and(eq(users.id, input.userId), isNull(users.deletedAt))).limit(1);
  if (!user) throw new NotFoundError("用户不存在");
  assertDepartmentMemberRole(user.role);

  const [existing] = await input.db.select({ userId: userDepartments.userId })
    .from(userDepartments)
    .where(and(eq(userDepartments.userId, user.id), eq(userDepartments.departmentId, input.departmentId)))
    .limit(1);
  if (existing) throw new ConflictError("该用户已在此部门中");

  const current = await input.db.select({
    departmentId: userDepartments.departmentId,
    isPrimary: userDepartments.isPrimary
  }).from(userDepartments).where(eq(userDepartments.userId, user.id));
  const makePrimary = input.isPrimary === true || current.length === 0;

  await input.db.transaction(async (tx) => {
    if (makePrimary) {
      await tx.update(userDepartments).set({ isPrimary: false }).where(eq(userDepartments.userId, user.id));
    }
    await tx.insert(userDepartments).values({
      userId: user.id,
      departmentId: input.departmentId,
      isPrimary: makePrimary
    });
    await writeAuditLog({
      db: tx,
      request: input.request,
      actor: input.actor,
      action: AUDIT_ACTIONS.USER_DEPARTMENT_CHANGED,
      targetType: "department",
      targetId: input.departmentId,
      afterJson: { userId: user.id, departmentId: input.departmentId, isPrimary: makePrimary, op: "add_member" }
    });
  });

  return { userId: user.id, departmentId: input.departmentId, isPrimary: makePrimary };
}

export async function removeDepartmentMember(input: {
  db: Database;
  request: FastifyRequest;
  actor: AuthUser;
  departmentId: string;
  userId: string;
}) {
  const [membership] = await input.db.select({
    userId: userDepartments.userId,
    isPrimary: userDepartments.isPrimary
  }).from(userDepartments)
    .where(and(eq(userDepartments.userId, input.userId), eq(userDepartments.departmentId, input.departmentId)))
    .limit(1);
  if (!membership) throw new NotFoundError("该用户不属于此部门");

  await input.db.transaction(async (tx) => {
    await tx.delete(userDepartments).where(and(
      eq(userDepartments.userId, input.userId),
      eq(userDepartments.departmentId, input.departmentId)
    ));
    if (membership.isPrimary) {
      const [next] = await tx.select({ departmentId: userDepartments.departmentId })
        .from(userDepartments)
        .where(eq(userDepartments.userId, input.userId))
        .limit(1);
      if (next) {
        await tx.update(userDepartments).set({ isPrimary: true }).where(and(
          eq(userDepartments.userId, input.userId),
          eq(userDepartments.departmentId, next.departmentId)
        ));
      }
    }
    await writeAuditLog({
      db: tx,
      request: input.request,
      actor: input.actor,
      action: AUDIT_ACTIONS.USER_DEPARTMENT_CHANGED,
      targetType: "department",
      targetId: input.departmentId,
      beforeJson: { userId: input.userId, departmentId: input.departmentId, op: "remove_member" }
    });
  });
}
