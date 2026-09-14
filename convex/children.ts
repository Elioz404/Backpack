import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { childrenOf, requireMembership } from "./model/households";

/**
 * The children a household is tracking.
 *
 * They matter to the pipeline as much as to the UI: the extractor is given
 * their names so it can tell which child a notice is about, and a card tagged
 * to a child is one the other parent can act on without asking.
 */

/**
 * A fixed palette rather than a free colour field, so the board stays legible
 * and two children never end up indistinguishable. Assigned round-robin.
 */
const COLOR_KEYS = ["amber", "sky", "violet", "emerald", "rose", "slate"] as const;

export const list = query({
  args: { householdId: v.id("households") },
  returns: v.array(
    v.object({
      _id: v.id("children"),
      name: v.string(),
      grade: v.union(v.string(), v.null()),
      colorKey: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);
    const children = await childrenOf(ctx, args.householdId);
    return children.map((child) => ({
      _id: child._id,
      name: child.name,
      grade: child.grade ?? null,
      colorKey: child.colorKey,
    }));
  },
});

export const add = mutation({
  args: {
    householdId: v.id("households"),
    name: v.string(),
    grade: v.optional(v.string()),
  },
  returns: v.id("children"),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    const name = args.name.trim();
    if (name === "") {
      throw new ConvexError({ code: "INVALID", field: "name" });
    }

    const existing = await childrenOf(ctx, args.householdId);
    if (
      existing.some(
        (child) => child.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new ConvexError({ code: "DUPLICATE", field: "name" });
    }

    return await ctx.db.insert("children", {
      householdId: args.householdId,
      name,
      grade: args.grade?.trim() === "" ? undefined : args.grade?.trim(),
      colorKey: COLOR_KEYS[existing.length % COLOR_KEYS.length],
    });
  },
});

export const remove = mutation({
  args: { householdId: v.id("households"), childId: v.id("children") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    const child = await ctx.db.get(args.childId);
    if (child === null || child.householdId !== args.householdId) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "child" });
    }

    await ctx.db.delete(args.childId);
    return null;
  },
});
