import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import * as Example from "./model/example";

/**
 * A worked example, for a demo or a fresh deployment.
 *
 * Internal on purpose: there is no path to this from the browser, only
 * `npx convex run seed:demo '{"householdId":"..."}'`. The content is openly
 * fictional — an invented school, invented children — because seeding a board
 * with data that looks real is how a demo ends up lying.
 *
 * Idempotent: it keys the obligations on the same fingerprint the extractor
 * would produce, so running it twice leaves one board, not two.
 */

export const demo = internalMutation({
  args: { householdId: v.string() },
  returns: v.object({ obligations: v.number(), children: v.number() }),
  handler: async (ctx, args) => {
    const householdId = ctx.db.normalizeId("households", args.householdId);
    if (householdId === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "household" });
    }
    const household = await ctx.db.get(householdId);
    if (household === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "household" });
    }
    return await Example.fill(ctx, household);
  },
});

export const forgetSource = internalMutation({
  args: { sourceId: v.id("sources") },
  returns: v.object({ obligations: v.number(), activity: v.number() }),
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (source === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "source" });
    }

    const obligations = await ctx.db
      .query("obligations")
      .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
      .collect();

    const removedIds = new Set(obligations.map((row) => row._id));
    for (const row of obligations) await ctx.db.delete(row._id);

    // History that names a removed obligation, plus the "new mail" line the
    // source itself wrote, which is matched by title because activity rows do
    // not carry a source id.
    const history = await ctx.db
      .query("activity")
      .withIndex("by_household", (q) => q.eq("householdId", source.householdId))
      .collect();

    let activityRemoved = 0;
    for (const entry of history) {
      const namesRemoved =
        entry.obligationId !== undefined && removedIds.has(entry.obligationId);
      const namesSource = entry.message.includes(source.title);
      if (namesRemoved || namesSource) {
        await ctx.db.delete(entry._id);
        activityRemoved += 1;
      }
    }

    await ctx.db.delete(args.sourceId);
    return { obligations: obligations.length, activity: activityRemoved };
  },
});
