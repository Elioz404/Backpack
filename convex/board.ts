import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { vObligationKind, vObligationStatus } from "./schema";
import * as Activity from "./model/activity";
import { requireMembership } from "./model/households";
import { openBoard } from "./model/obligations";

/**
 * The board: what the family owes, who has it, and where each line came from.
 *
 * One live query drives the whole screen. When the pipeline adds a card, when
 * one parent claims it and when the other marks it done, every subscriber sees
 * it without anything asking again.
 */

const vBoardCard = v.object({
  _id: v.id("obligations"),
  title: v.string(),
  detail: v.union(v.string(), v.null()),
  kind: vObligationKind,
  status: vObligationStatus,
  dueAt: v.union(v.number(), v.null()),
  dueIsAllDay: v.boolean(),
  amountCents: v.union(v.number(), v.null()),
  currency: v.union(v.string(), v.null()),
  confidence: v.number(),
  quote: v.string(),
  children: v.array(
    v.object({
      _id: v.id("children"),
      name: v.string(),
      colorKey: v.string(),
    }),
  ),
  claimedBy: v.union(
    v.null(),
    v.object({ userId: v.id("users"), displayName: v.string() }),
  ),
  source: v.object({
    kind: v.union(v.literal("page"), v.literal("email")),
    title: v.string(),
    url: v.union(v.string(), v.null()),
    fromAddress: v.union(v.string(), v.null()),
    capturedAt: v.number(),
  }),
});

export const cards = query({
  args: { householdId: v.id("households") },
  returns: v.array(vBoardCard),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    const obligations = await openBoard(ctx, args.householdId);

    // The board is one household's open items, so these lookups are bounded by
    // what is on screen rather than by table size.
    const childCache = new Map<string, Doc<"children">>();
    const userCache = new Map<string, Doc<"users">>();

    const cards = [];
    for (const obligation of obligations) {
      const source = await ctx.db.get(obligation.sourceId);
      if (source === null) continue;

      const children = [];
      for (const childId of obligation.childIds) {
        let child = childCache.get(childId);
        if (child === undefined) {
          const loaded = await ctx.db.get(childId);
          if (loaded === null) continue;
          child = loaded;
          childCache.set(childId, child);
        }
        children.push({
          _id: child._id,
          name: child.name,
          colorKey: child.colorKey,
        });
      }

      let claimedBy = null;
      if (obligation.claimedBy !== undefined) {
        let user = userCache.get(obligation.claimedBy);
        if (user === undefined) {
          const loaded = await ctx.db.get(obligation.claimedBy);
          if (loaded !== null) {
            user = loaded;
            userCache.set(obligation.claimedBy, user);
          }
        }
        if (user !== undefined) {
          claimedBy = { userId: user._id, displayName: user.displayName };
        }
      }

      cards.push({
        _id: obligation._id,
        title: obligation.title,
        detail: obligation.detail ?? null,
        kind: obligation.kind,
        status: obligation.status,
        dueAt: obligation.dueAt ?? null,
        dueIsAllDay: obligation.dueIsAllDay,
        amountCents: obligation.amountCents ?? null,
        currency: obligation.currency ?? null,
        confidence: obligation.confidence,
        quote: obligation.quote,
        children,
        claimedBy,
        source: {
          kind: source.kind,
          title: source.title,
          url: source.url ?? null,
          fromAddress: source.fromAddress ?? null,
          capturedAt: source.capturedAt,
        },
      });
    }
    return cards;
  },
});

/** The household's recent history, newest first. */
export const feed = query({
  args: { householdId: v.id("households"), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("activity"),
      at: v.number(),
      kind: v.string(),
      message: v.string(),
      actor: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    const entries = await Activity.recent(
      ctx,
      args.householdId,
      Math.min(args.limit ?? 25, 100),
    );

    return await Promise.all(
      entries.map(async (entry) => {
        const actor =
          entry.actorId === undefined ? null : await ctx.db.get(entry.actorId);
        return {
          _id: entry._id,
          at: entry._creationTime,
          kind: entry.kind,
          message: entry.message,
          actor: actor?.displayName ?? null,
        };
      }),
    );
  },
});

/** Load an obligation and prove the caller may act on it. */
async function requireCard(
  ctx: Parameters<typeof requireMembership>[0],
  householdId: Doc<"households">["_id"],
  obligationId: Doc<"obligations">["_id"],
) {
  const membership = await requireMembership(ctx, householdId);
  const obligation = await ctx.db.get(obligationId);
  if (obligation === null || obligation.householdId !== householdId) {
    throw new ConvexError({ code: "NOT_FOUND", entity: "obligation" });
  }
  return { membership, obligation };
}

/**
 * Take an item.
 *
 * The point of the whole product: the other parent's screen updates the moment
 * this commits, so nobody does the same errand twice. Taking one that someone
 * else already has is refused rather than silently reassigned.
 */
export const claim = mutation({
  args: {
    householdId: v.id("households"),
    obligationId: v.id("obligations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { membership, obligation } = await requireCard(
      ctx,
      args.householdId,
      args.obligationId,
    );

    if (
      obligation.claimedBy !== undefined &&
      obligation.claimedBy !== membership.userId
    ) {
      throw new ConvexError({ code: "ALREADY_CLAIMED" });
    }

    await ctx.db.patch(args.obligationId, {
      status: "claimed",
      claimedBy: membership.userId,
      claimedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await Activity.record(ctx, {
      householdId: args.householdId,
      kind: "obligation_claimed",
      message: obligation.title,
      actorId: membership.userId,
      obligationId: args.obligationId,
    });
    return null;
  },
});

export const release = mutation({
  args: {
    householdId: v.id("households"),
    obligationId: v.id("obligations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { membership, obligation } = await requireCard(
      ctx,
      args.householdId,
      args.obligationId,
    );

    await ctx.db.patch(args.obligationId, {
      status: "open",
      claimedBy: undefined,
      claimedAt: undefined,
      updatedAt: Date.now(),
    });

    await Activity.record(ctx, {
      householdId: args.householdId,
      kind: "obligation_released",
      message: obligation.title,
      actorId: membership.userId,
      obligationId: args.obligationId,
    });
    return null;
  },
});

export const complete = mutation({
  args: {
    householdId: v.id("households"),
    obligationId: v.id("obligations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { membership, obligation } = await requireCard(
      ctx,
      args.householdId,
      args.obligationId,
    );

    await ctx.db.patch(args.obligationId, {
      status: "done",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await Activity.record(ctx, {
      householdId: args.householdId,
      kind: "obligation_done",
      message: obligation.title,
      actorId: membership.userId,
      obligationId: args.obligationId,
    });
    return null;
  },
});

/**
 * Take something off the board without doing it — the extractor read a page
 * too eagerly, or it does not apply to this family. Dismissed rows are never
 * re-created by a later sighting, so this also teaches the merge to stop
 * offering it.
 */
export const dismiss = mutation({
  args: {
    householdId: v.id("households"),
    obligationId: v.id("obligations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { membership, obligation } = await requireCard(
      ctx,
      args.householdId,
      args.obligationId,
    );

    await ctx.db.patch(args.obligationId, {
      status: "dismissed",
      updatedAt: Date.now(),
    });

    await Activity.record(ctx, {
      householdId: args.householdId,
      kind: "obligation_dismissed",
      message: obligation.title,
      actorId: membership.userId,
      obligationId: args.obligationId,
    });
    return null;
  },
});
