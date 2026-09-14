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

/**
 * How long a page may sit `pending` before something is assumed to have gone
 * wrong with its job. A twelve page crawl finishes inside two minutes, so
 * anything still waiting after five is not waiting, it is stranded.
 */
const STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * What the board should say about pages it has taken in but not yet turned
 * into cards.
 *
 * Two different situations, and conflating them was a real fault: a page that
 * is being read right now is `pending`, and so is a page whose job died.
 * Counting both as "not read yet" meant every normal crawl announced twelve
 * failures while it was working perfectly, under a button offering to retry
 * work that was already running — which re-queued it and paid for the same
 * pages twice.
 */
export const health = query({
  args: { householdId: v.id("households") },
  returns: v.object({
    /** In flight. Nothing to do but wait. */
    reading: v.number(),
    /** Failed, or waiting so long that its job is gone. Worth a retry. */
    stuck: v.number(),
    /**
     * Nothing on this board came from a real page or a real message yet — it
     * is still only the sample a new household starts with.
     */
    sampleOnly: v.boolean(),
    lastError: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    const sources = await ctx.db
      .query("sources")
      .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
      .take(MAX_REPORTED);

    const cutoff = Date.now() - STUCK_AFTER_MS;
    let reading = 0;
    let stuck = 0;
    let real = 0;
    let lastError: string | null = null;

    for (const source of sources) {
      if (source.seeded !== true) real += 1;
      // `done` is finished and `skipped` is a decision, not a failure: a page
      // with nothing on it worth doing was read correctly.
      if (source.extraction === "done" || source.extraction === "skipped") {
        continue;
      }
      if (source.extraction === "failed") {
        stuck += 1;
        lastError ??= source.extractionError ?? null;
      } else if (source._creationTime < cutoff) {
        stuck += 1;
      } else {
        reading += 1;
      }
    }

    return {
      reading,
      stuck,
      sampleOnly: sources.length > 0 && real === 0,
      lastError,
    };
  },
});

/**
 * Queue the pages that are stranded — and only those.
 *
 * It used to re-queue everything that was not `done`, which included the
 * pages currently being read. Setting a `pending` row back to `pending` does
 * not cancel the job already carrying it, so each of those pages was read,
 * and paid for, twice. Same rule as the panel that offers this: a page whose
 * job is still alive is left alone.
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

    const cutoff = Date.now() - STUCK_AFTER_MS;
    let queued = 0;
    for (const source of sources) {
      const stranded =
        source.extraction === "failed" ||
        (source.extraction === "pending" && source._creationTime < cutoff);
      if (!stranded) continue;

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
