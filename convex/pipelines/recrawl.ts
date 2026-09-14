import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { firecrawl } from "../lib/firecrawl";
import * as CrawlModel from "../model/crawls";

/**
 * The weekly sweep.
 *
 * A school site is not a one-time read: notices appear on it all term, and a
 * family that pointed Backpack at it in September should not have to remember
 * to press the button again in November.
 *
 * Re-reading is cheap because of how ingestion is keyed. A page whose text has
 * not changed hashes to a source we already have and is dropped before it ever
 * reaches the model, so a sweep over an unchanged site costs Firecrawl credits
 * and nothing else. Only what actually changed is read.
 */

/** Schools are swept a page at a time so one sweep is never one huge job. */
const SWEEP_BATCH = 20;

export const schoolsPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    return await ctx.db.query("schools").paginate(args.paginationOpts);
  },
});

/**
 * Open a run for a scheduled sweep.
 *
 * Attributed to the household's owner, because a run row records who is
 * accountable for the spend and a cron has no caller of its own.
 */
export const beginScheduledRun = internalMutation({
  args: { schoolId: v.id("schools") },
  returns: v.union(
    v.null(),
    v.object({
      crawlRunId: v.id("crawlRuns"),
      siteUrl: v.string(),
      crawlLimit: v.number(),
      excludePaths: v.array(v.string()),
      includePaths: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const school = await ctx.db.get(args.schoolId);
    if (school === null) return null;

    const household = await ctx.db.get(school.householdId);
    if (household === null) return null;

    return await CrawlModel.beginRun(ctx, {
      householdId: school.householdId,
      schoolId: args.schoolId,
      startedBy: household.createdBy,
      reason: "Weekly re-read of",
    });
  },
});

export const sweep = internalAction({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.runQuery(internal.pipelines.recrawl.schoolsPage, {
      paginationOpts: { numItems: SWEEP_BATCH, cursor: args.cursor },
    });

    for (const school of page.page) {
      const run = await ctx.runMutation(
        internal.pipelines.recrawl.beginScheduledRun,
        { schoolId: school._id },
      );
      if (run === null) continue;

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
          context: { crawlRunId: run.crawlRunId },
        });

        await ctx.runMutation(internal.crawls.attachCrawl, {
          crawlRunId: run.crawlRunId,
          crawlId,
          jobId,
        });
      } catch (error) {
        // One school being unreachable must not end the sweep for everyone
        // else, so the failure is recorded on its run and the loop goes on.
        await ctx.runMutation(internal.crawls.failRun, {
          crawlRunId: run.crawlRunId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.pipelines.recrawl.sweep, {
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});
