import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { firecrawl } from "../lib/firecrawl";
import { extractionPool } from "../lib/pools";
import * as Activity from "../model/activity";
import * as Sources from "../model/sources";

/**
 * From a finished crawl to pages on the board.
 *
 * Firecrawl's component owns the crawl and its pages; this is the seam where
 * they become the household's sources. The completion callback only updates
 * the crawl row — reading a hundred pages and hashing each one is not
 * transaction work — and hands the reading itself to an action.
 */

/** How many stored pages are pulled from the component per round trip. */
const PAGE_BATCH = 25;

/**
 * The mutation Firecrawl calls when a crawl reaches a terminal state. Runs
 * exactly once per crawl, whatever the outcome.
 */
export const onCrawlComplete = internalMutation({
  args: {
    crawlId: v.string(),
    jobId: v.optional(v.string()),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    pageCount: v.number(),
    unstored: v.optional(v.number()),
    error: v.optional(v.string()),
    context: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Resolved through the context we handed Firecrawl at `startCrawl`, not
    // through the crawl id: the run row exists before the id does, so this is
    // the only identifier guaranteed to be resolvable whenever this fires.
    const crawlRunId = ctx.db.normalizeId(
      "crawlRuns",
      typeof args.context?.crawlRunId === "string" ? args.context.crawlRunId : "",
    );
    const run = crawlRunId === null ? null : await ctx.db.get(crawlRunId);

    // A crawl this app did not start, or whose run row is gone.
    if (run === null) return null;

    await ctx.db.patch(run._id, {
      status: args.status,
      crawlId: args.crawlId,
      jobId: args.jobId ?? run.jobId,
      pageCount: args.pageCount,
      unstoredCount: args.unstored,
      finishedAt: Date.now(),
      error: args.error,
    });

    await Activity.record(ctx, {
      householdId: run.householdId,
      kind: "crawl_finished",
      message:
        args.status === "completed"
          ? `Read ${args.pageCount} page${args.pageCount === 1 ? "" : "s"} from the school site`
          : `Crawl ${args.status}${args.error ? `: ${args.error}` : ""}`,
    });

    if (args.status !== "completed" || args.pageCount === 0) return null;

    await ctx.scheduler.runAfter(0, internal.pipelines.crawlIngest.ingestPages, {
      crawlRunId: run._id,
      cursor: null,
    });
    return null;
  },
});

/**
 * Take in one batch of crawled pages, then reschedule itself for the next.
 *
 * Self-rescheduling rather than looping to the end so that a large crawl never
 * runs into an action's time limit, and so each batch's writes commit as they
 * are read — the board fills in while the rest is still being taken in.
 */
export const ingestPages = internalAction({
  args: {
    crawlRunId: v.id("crawlRuns"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.pipelines.crawlIngest.loadRun, {
      crawlRunId: args.crawlRunId,
    });
    if (run === null) return null;

    const page = await ctx.runQuery(
      internal.pipelines.crawlIngest.pagesOf,
      { crawlId: run.crawlId, cursor: args.cursor },
    );

    for (const crawled of page.page) {
      const body = crawled.markdown ?? crawled.summary;
      if (body === undefined || body === "") continue;

      const { text, hash } = await Sources.prepare(body);

      await ctx.runMutation(internal.pipelines.crawlIngest.recordPage, {
        crawlRunId: args.crawlRunId,
        householdId: run.householdId,
        url: crawled.url,
        title: crawled.metadata?.title ?? crawled.url,
        text,
        hash,
      });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.pipelines.crawlIngest.ingestPages,
        { crawlRunId: args.crawlRunId, cursor: page.continueCursor },
      );
    }
    return null;
  },
});

export const loadRun = internalQuery({
  args: { crawlRunId: v.id("crawlRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.crawlRunId);
    // The completion callback stamps the crawl id before scheduling ingestion,
    // so an absent one here means there is nothing to read yet.
    return run === null || run.crawlId === undefined
      ? null
      : { crawlId: run.crawlId, householdId: run.householdId };
  },
});

/**
 * One page of the component's stored pages.
 *
 * Wrapped in a query rather than called straight from the action because the
 * component's read methods take a query context, and an action's `runQuery`
 * has a wider signature that does not satisfy it.
 */
export const pagesOf = internalQuery({
  args: { crawlId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    return await firecrawl.listPages(ctx, {
      crawlId: args.crawlId,
      paginationOpts: { numItems: PAGE_BATCH, cursor: args.cursor },
    });
  },
});

/**
 * Store one page and queue it for reading.
 *
 * The enqueue happens in the same transaction as the insert, so a source can
 * never exist without a job to read it, and a rolled-back insert takes its job
 * with it.
 */
export const recordPage = internalMutation({
  args: {
    crawlRunId: v.id("crawlRuns"),
    householdId: v.id("households"),
    url: v.string(),
    title: v.string(),
    text: v.string(),
    hash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await Sources.ingest(ctx, {
      householdId: args.householdId,
      kind: "page",
      title: args.title,
      url: args.url,
      crawlRunId: args.crawlRunId,
      text: args.text,
      hash: args.hash,
    });

    if (result.status !== "ingested") return null;

    await extractionPool.enqueueAction(
      ctx,
      internal.pipelines.extract.extractSource,
      { sourceId: result.sourceId },
    );
    return null;
  },
});
