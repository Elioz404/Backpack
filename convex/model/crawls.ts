import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import * as Activity from "./activity";

/**
 * Opening a crawl run.
 *
 * Shared by the two callers that start one — a parent pressing the button, and
 * the weekly cron — so the row, the history entry and the crawl parameters are
 * produced exactly once in one place. Authorization and rate limiting are
 * deliberately *not* here: they belong to the user-initiated path, and
 * applying them to a scheduled sweep would be wrong.
 */

export type CrawlPlan = {
  crawlRunId: Id<"crawlRuns">;
  siteUrl: string;
  crawlLimit: number;
  excludePaths: string[];
  includePaths: string[];
};

export async function beginRun(
  ctx: MutationCtx,
  input: {
    householdId: Id<"households">;
    schoolId: Id<"schools">;
    startedBy: Id<"users">;
    reason: string;
  },
): Promise<CrawlPlan> {
  const school = await ctx.db.get(input.schoolId);
  if (school === null || school.householdId !== input.householdId) {
    throw new ConvexError({ code: "NOT_FOUND", entity: "school" });
  }

  const crawlRunId = await ctx.db.insert("crawlRuns", {
    householdId: input.householdId,
    schoolId: input.schoolId,
    status: "running",
    startedBy: input.startedBy,
    startedAt: Date.now(),
  });

  await Activity.record(ctx, {
    householdId: input.householdId,
    kind: "crawl_started",
    message: `${input.reason} ${school.name}`,
    actorId: input.startedBy,
  });

  return {
    crawlRunId,
    siteUrl: school.siteUrl,
    crawlLimit: school.crawlLimit,
    excludePaths: school.excludePaths ?? [],
    includePaths: school.includePaths ?? [],
  };
}
