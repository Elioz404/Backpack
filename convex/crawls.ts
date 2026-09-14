import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { firecrawl } from "./lib/firecrawl";
import { rateLimiter } from "./lib/limits";
import * as CrawlModel from "./model/crawls";
import { requireMembership } from "./model/households";

/**
 * Reading a school's website.
 *
 * The crawl is durable: it outlives the action that started it, its pages land
 * in the component's own tables, and the board subscribes to its progress. So
 * this module is mostly bookkeeping — who started what, and against which
 * school — with the work itself owned by Firecrawl's component and picked up
 * by `pipelines/crawlIngest` when it finishes.
 */

/**
 * Claim the right to crawl, and record the intent, before anything is spent.
 *
 * The run row exists first so that a crawl can never be in flight without
 * something in the household's history saying so, and so the completion
 * callback has a row to resolve against.
 */
export const beginRun = internalMutation({
  args: { householdId: v.id("households"), schoolId: v.id("schools") },
  // Declared rather than inferred: `start` below calls this through the
  // generated `internal` API from the same module, and without a stated
  // return type that is a circular inference (TS7022).
  returns: v.object({
    crawlRunId: v.id("crawlRuns"),
    siteUrl: v.string(),
    crawlLimit: v.number(),
    excludePaths: v.array(v.string()),
    includePaths: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const { userId } = await requireMembership(ctx, args.householdId);

    // Throws when the household is out of allowance, so nothing below runs
    // and no credit is spent.
    await rateLimiter.limit(ctx, "startCrawl", {
      key: args.householdId,
      throws: true,
    });
    // And again for the deployment as a whole. A household's allowance means
    // nothing when anyone can have a new household for the asking.
    await rateLimiter.limit(ctx, "crawlsOverall", { throws: true });

    return await CrawlModel.beginRun(ctx, {
      householdId: args.householdId,
      schoolId: args.schoolId,
      startedBy: userId,
      reason: "Reading",
    });
  },
});

export const attachCrawl = internalMutation({
  args: {
    crawlRunId: v.id("crawlRuns"),
    crawlId: v.string(),
    jobId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.crawlRunId, {
      crawlId: args.crawlId,
      jobId: args.jobId,
    });
    return null;
  },
});

export const failRun = internalMutation({
  args: { crawlRunId: v.id("crawlRuns"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.crawlRunId, {
      status: "failed",
      error: args.error,
      finishedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Start reading a school site. Returns as soon as Firecrawl accepts the job;
 * everything after that is the crawl's own progress, which the caller watches
 * through `progress` below.
 */
export const start = action({
  args: { householdId: v.id("households"), schoolId: v.id("schools") },
  returns: v.object({ crawlRunId: v.id("crawlRuns") }),
  // The explicit return type is what lets this action call `beginRun` from its
  // own module: without it, typing `start` requires typing the module that
  // contains `start` (TS7022).
  handler: async (ctx, args): Promise<{ crawlRunId: Id<"crawlRuns"> }> => {
    const run = await ctx.runMutation(internal.crawls.beginRun, {
      householdId: args.householdId,
      schoolId: args.schoolId,
    });

    try {
      const { crawlId, jobId } = await firecrawl.startCrawl(ctx, {
        url: run.siteUrl,
        options: {
          limit: run.crawlLimit,
          ...(run.includePaths.length > 0
            ? { includePaths: run.includePaths }
            : {}),
          ...(run.excludePaths.length > 0
            ? { excludePaths: run.excludePaths }
            : {}),
          scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
        },
        onComplete: internal.pipelines.crawlIngest.onCrawlComplete,
        // Carried back untouched, and the only identifier that is certain to
        // resolve when the callback fires.
        context: { crawlRunId: run.crawlRunId },
      });

      await ctx.runMutation(internal.crawls.attachCrawl, {
        crawlRunId: run.crawlRunId,
        crawlId,
        jobId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.crawls.failRun, {
        crawlRunId: run.crawlRunId,
        error: message,
      });
      throw error;
    }

    return { crawlRunId: run.crawlRunId };
  },
});

/**
 * Live crawl progress for a household.
 *
 * Reads the component's own crawl row, so `completed` and `total` advance as
 * Firecrawl delivers pages — this is a subscription, not a poll, and it is
 * what makes the progress bar move on both parents' screens at once.
 */
export const progress = query({
  args: { householdId: v.id("households") },
  returns: v.union(
    v.null(),
    v.object({
      crawlRunId: v.id("crawlRuns"),
      status: v.string(),
      completed: v.number(),
      total: v.number(),
      creditsUsed: v.union(v.number(), v.null()),
      error: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    const latest = await ctx.db
      .query("crawlRuns")
      .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
      .order("desc")
      .first();

    if (latest === null) return null;

    // Before Firecrawl has answered there is a run but no crawl to read.
    if (latest.crawlId === undefined) {
      return {
        crawlRunId: latest._id,
        status: latest.status,
        completed: 0,
        total: 0,
        creditsUsed: null,
        error: latest.error ?? null,
      };
    }

    const crawl = await firecrawl.getCrawl(ctx, latest.crawlId);
    return {
      crawlRunId: latest._id,
      status: crawl?.status ?? latest.status,
      completed: crawl?.completed ?? latest.pageCount ?? 0,
      total: crawl?.total ?? latest.pageCount ?? 0,
      creditsUsed: crawl?.creditsUsed ?? null,
      error: crawl?.error ?? latest.error ?? null,
    };
  },
});
