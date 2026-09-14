import type { Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { vActivityKind } from "../schema";

/**
 * The household's history, and the reason the board feels alive: every change
 * the pipeline or a parent makes lands here, and the feed is a live query, so
 * the other parent's screen narrates itself.
 */

type ActivityKind = Infer<typeof vActivityKind>;

export async function record(
  ctx: MutationCtx,
  entry: {
    householdId: Id<"households">;
    kind: ActivityKind;
    message: string;
    actorId?: Id<"users">;
    obligationId?: Id<"obligations">;
  },
): Promise<void> {
  await ctx.db.insert("activity", {
    householdId: entry.householdId,
    kind: entry.kind,
    message: entry.message,
    actorId: entry.actorId,
    obligationId: entry.obligationId,
  });
}

/**
 * The most recent entries, newest first.
 *
 * Bounded by `limit` rather than collected: `activity` grows without end, and
 * the feed only ever shows the top of it.
 */
export async function recent(
  ctx: QueryCtx,
  householdId: Id<"households">,
  limit: number,
) {
  return await ctx.db
    .query("activity")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .order("desc")
    .take(limit);
}
