import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { extractionPool } from "./lib/pools";
import { requireMembership } from "./model/households";

/**
 * What has been read, and what has not.
 *
 * A page can reach the household and still not be read — the model was rate
 * limited, the account ran out of credit, the pool dropped the job. Those
 * pages are already stored, so the fix is to read them again, not to crawl the
 * site again.
 *
 * Surfacing the count matters as much as the retry: a board quietly missing a
 * third of the term's notices looks exactly like a board with nothing on it.
 */

/**
 * Counting past this adds nothing a family would act on differently, and keeps
 * the query bounded whatever the size of the crawl behind it.
 */
const MAX_REPORTED = 200;

/** How many pages are still unread, so the board can offer to try again. */
export const health = query({
  args: { householdId: v.id("households") },
  returns: v.object({
    unread: v.number(),
    failed: v.number(),
    lastError: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    // Read by household rather than by state: any state that is not `done` is
    // unread, and asking the question that way means a state added later
    // cannot quietly fall outside the count.
    const sources = await ctx.db
      .query("sources")
      .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
      .take(MAX_REPORTED);

    const unread = sources.filter((source) => source.extraction !== "done");
    const failed = unread.filter((source) => source.extraction === "failed");

    return {
      unread: unread.length,
      failed: failed.length,
      // One reason is enough to act on, and they are nearly always the same.
      lastError: failed[0]?.extractionError ?? null,
    };
  },
});

/**
 * Queue every page that has not been read yet. Safe to press twice.
 *
 * Each page is set back to `pending` before its job is queued, so pressing it
 * again while the pool is still draining does not enqueue the same page twice.
 */
export const retryUnread = mutation({
  args: { householdId: v.id("households") },
  returns: v.object({ queued: v.number() }),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    const sources = await ctx.db
      .query("sources")
      .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
      .take(MAX_REPORTED);

    let queued = 0;
    for (const source of sources) {
      if (source.extraction === "done") continue;

      await ctx.db.patch(source._id, {
        extraction: "pending",
        extractionError: undefined,
      });
      await extractionPool.enqueueAction(
        ctx,
        internal.pipelines.extract.extractSource,
        { sourceId: source._id },
      );
      queued += 1;
    }

    return { queued };
  },
});
