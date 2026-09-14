import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireUserId } from "./auth";

/**
 * The tenant boundary.
 *
 * A household is the unit of privacy: children, schools, sources, obligations
 * and questions all belong to exactly one, and nothing is readable outside it.
 * Every public function funnels through `requireMembership` so that rule is
 * enforced in one place instead of being re-implemented per endpoint.
 */

export type Membership = {
  userId: Id<"users">;
  household: Doc<"households">;
  role: Doc<"memberships">["role"];
};

/**
 * Assert the caller belongs to this household and return the context every
 * handler needs anyway: who they are, and the household row itself (for the
 * time zone, the inbox, the name).
 *
 * A household the caller is not in is reported as `NOT_FOUND`, not
 * `FORBIDDEN`: whether a given household exists is itself private.
 */
export async function requireMembership(
  ctx: QueryCtx,
  householdId: Id<"households">,
): Promise<Membership> {
  const userId = await requireUserId(ctx);

  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_and_household", (q) =>
      q.eq("userId", userId).eq("householdId", householdId),
    )
    .unique();

  const household =
    membership === null ? null : await ctx.db.get(householdId);

  if (membership === null || household === null) {
    throw new ConvexError({ code: "NOT_FOUND", entity: "household" });
  }

  return { userId, household, role: membership.role };
}

/** Same, but only the owner passes. Used for destructive settings changes. */
export async function requireOwnership(
  ctx: QueryCtx,
  householdId: Id<"households">,
): Promise<Membership> {
  const membership = await requireMembership(ctx, householdId);
  if (membership.role !== "owner") {
    throw new ConvexError({ code: "FORBIDDEN", requires: "owner" });
  }
  return membership;
}

/**
 * Internal equivalent for pipeline code, which acts on a household without a
 * signed-in caller (a crawl callback, an inbound email, a cron). There is no
 * identity to check, so this only resolves the row.
 */
export async function loadHousehold(
  ctx: QueryCtx,
  householdId: Id<"households">,
): Promise<Doc<"households">> {
  const household = await ctx.db.get(householdId);
  if (household === null) {
    throw new ConvexError({ code: "NOT_FOUND", entity: "household" });
  }
  return household;
}

/** Every household the caller belongs to, newest membership first. */
export async function householdsForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"households">[]> {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const households = await Promise.all(
    memberships.map((membership) => ctx.db.get(membership.householdId)),
  );
  return households.filter((row): row is Doc<"households"> => row !== null);
}

/**
 * Create a household and make its creator the owner, in one transaction, so a
 * household can never exist without someone able to administer it.
 */
export async function createHousehold(
  ctx: MutationCtx,
  input: { name: string; timeZone: string; userId: Id<"users"> },
): Promise<Id<"households">> {
  const householdId = await ctx.db.insert("households", {
    name: input.name,
    createdBy: input.userId,
    timeZone: input.timeZone,
  });
  await ctx.db.insert("memberships", {
    householdId,
    userId: input.userId,
    role: "owner",
    joinedAt: Date.now(),
  });
  return householdId;
}

/** The household's children, which the extractor needs by name. */
export async function childrenOf(
  ctx: QueryCtx,
  householdId: Id<"households">,
): Promise<Doc<"children">[]> {
  return await ctx.db
    .query("children")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .collect();
}

export async function schoolsOf(
  ctx: QueryCtx,
  householdId: Id<"households">,
): Promise<Doc<"schools">[]> {
  return await ctx.db
    .query("schools")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .collect();
}
