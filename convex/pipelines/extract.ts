import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import {
  extractObligations,
  vExtractedItem,
  type ExtractedItem,
} from "../lib/openai/extraction";
import { todayInZone } from "../lib/time";
import * as Activity from "../model/activity";
import * as Budget from "../model/budget";
import { childrenOf, schoolsOf } from "../model/households";
import * as Obligations from "../model/obligations";
import * as Sources from "../model/sources";

/**
 * Reading one source.
 *
 * The unit of work for the extraction pool: exactly one source, one model
 * call, one transaction to fold the result into the board. Keeping it to one
 * source is what makes it safely retryable — a page is identified by its
 * content hash and its obligations by their fingerprint, so running this twice
 * produces the same board as running it once.
 */

/** Everything the model needs about a source, read in one transaction. */
export const contextFor = internalQuery({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const source = await Sources.load(ctx, args.sourceId);
    if (source === null) return null;

    const household = await ctx.db.get(source.householdId);
    if (household === null) return null;

    const [children, schools, board] = await Promise.all([
      childrenOf(ctx, household._id),
      schoolsOf(ctx, household._id),
      Obligations.openBoard(ctx, household._id),
    ]);

    return {
      source: {
        kind: source.kind,
        title: source.title,
        url: source.url,
        text: source.text,
      },
      timeZone: household.timeZone,
      childNames: children.map((child) => child.name),
      schoolNames: schools.map((school) => school.name),
      openBoard: board.map((row) => ({
        title: row.title,
        kind: row.kind,
        dueDate:
          row.dueAt === undefined
            ? undefined
            : new Date(row.dueAt).toISOString().slice(0, 10),
      })),
    };
  },
});

export const applyExtraction = internalMutation({
  args: {
    sourceId: v.id("sources"),
    items: v.array(vExtractedItem),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const source = await Sources.load(ctx, args.sourceId);
    if (source === null) return null;

    const household = await ctx.db.get(source.householdId);
    if (household === null) return null;

    const children = await childrenOf(ctx, household._id);

    for (const item of args.items) {
      await Obligations.mergeExtracted(ctx, {
        household,
        sourceId: args.sourceId,
        item: item as ExtractedItem,
        children,
      });
    }

    await Sources.markExtraction(ctx, args.sourceId, "done");
    return null;
  },
});

/** Refuse before spending, not after. */
export const mayExtract = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => await Budget.maySpend(ctx),
});

export const recordSpend = internalMutation({
  args: {
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await Budget.record(ctx, args.model, {
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
    });
    return null;
  },
});

export const failExtraction = internalMutation({
  args: { sourceId: v.id("sources"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await Sources.markExtraction(ctx, args.sourceId, "failed", args.error);
    return null;
  },
});

/**
 * The job the extraction pool runs.
 *
 * On failure it records the reason on the source and rethrows, so the pool's
 * retry sees a failure and the family sees which page could not be read rather
 * than a silent gap in the board.
 */
export const extractSource = internalAction({
  args: { sourceId: v.id("sources") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.pipelines.extract.contextFor, {
      sourceId: args.sourceId,
    });
    if (context === null) return null;

    if (!(await ctx.runQuery(internal.pipelines.extract.mayExtract, {}))) {
      await ctx.runMutation(internal.pipelines.extract.failExtraction, {
        sourceId: args.sourceId,
        error:
          "This deployment has reached its OpenAI budget. Raise " +
          "OPENAI_BUDGET_CENTS to read more pages.",
      });
      // Not rethrown: the pool retrying a budget refusal would just spend the
      // retry slots. The page stays unread and the board says so.
      return null;
    }

    try {
      const result = await extractObligations({
        sourceKind: context.source.kind,
        sourceTitle: context.source.title,
        sourceUrl: context.source.url,
        text: context.source.text,
        childNames: context.childNames,
        schoolNames: context.schoolNames,
        today: todayInZone(context.timeZone, Date.now()),
        timeZone: context.timeZone,
        openBoard: context.openBoard,
      });

      await ctx.runMutation(internal.pipelines.extract.recordSpend, {
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });

      await ctx.runMutation(internal.pipelines.extract.applyExtraction, {
        sourceId: args.sourceId,
        items: result.items,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.pipelines.extract.failExtraction, {
        sourceId: args.sourceId,
        error: message,
      });
      throw error;
    }
    return null;
  },
});

/**
 * Note in the household feed that a source was taken in. Separate from the
 * extraction itself so the board shows the page arriving immediately, before
 * the model has had its say.
 */
export const noteIngested = internalMutation({
  args: {
    householdId: v.id("households"),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await Activity.record(ctx, {
      householdId: args.householdId,
      kind: "source_ingested",
      message: args.message,
    });
    return null;
  },
});
