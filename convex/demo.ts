import { v } from "convex/values";
import { env } from "./_generated/server";
import { query } from "./_generated/server";
import * as Activity from "./model/activity";
import { openBoard } from "./model/obligations";
import { vBoardCard } from "./board";

/**
 * A worked example anyone can open, without an account.
 *
 * Every other read in this app is gated on household membership, and rightly
 * so. But a first-time visitor cannot judge a shared family board from a
 * sign-up form, and the honest paths to seeing one — crawl a school site, or
 * forward it some mail — both take minutes and spend somebody's quota.
 *
 * So exactly one household, named by `DEMO_HOUSEHOLD_ID` on the deployment, is
 * readable by anyone. Three things keep that from being a hole in the tenant
 * boundary:
 *
 * - It serves that one id and no other. There is no argument to pass, so no
 *   caller can point these queries at a different household.
 * - It is read-only. Nothing here writes, so a visitor cannot change what the
 *   next visitor sees.
 * - The board it exposes is openly fictional, and the sender address on every
 *   email source is redacted: those are working inboxes, and a public page
 *   should not hand out a deliverable target.
 */

/** Resolve the configured demo household, if this deployment has one. */
function demoHouseholdId(): string | undefined {
  const configured = env.DEMO_HOUSEHOLD_ID;
  return configured === undefined || configured === "" ? undefined : configured;
}

export const board = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      householdName: v.string(),
      cards: v.array(vBoardCard),
    }),
  ),
  handler: async (ctx) => {
    const configured = demoHouseholdId();
    if (configured === undefined) return null;

    const householdId = ctx.db.normalizeId("households", configured);
    if (householdId === null) return null;

    const household = await ctx.db.get(householdId);
    if (household === null) return null;

    const obligations = await openBoard(ctx, householdId);

    const cards = [];
    for (const obligation of obligations) {
      const source = await ctx.db.get(obligation.sourceId);
      if (source === null) continue;

      const children = [];
      for (const childId of obligation.childIds) {
        const child = await ctx.db.get(childId);
        if (child !== null) {
          children.push({
            _id: child._id,
            name: child.name,
            colorKey: child.colorKey,
          });
        }
      }

      const claimant =
        obligation.claimedBy === undefined
          ? null
          : await ctx.db.get(obligation.claimedBy);

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
        claimedBy:
          claimant === null
            ? null
            : { userId: claimant._id, displayName: claimant.displayName },
        source: {
          kind: source.kind,
          title: source.title,
          url: source.url ?? null,
          // Redacted. This page is public, and the real address is a working
          // inbox — publishing it hands anyone who reads the example a
          // deliverable target. The provenance a visitor needs is that it came
          // from mail rather than from the site, and the notice's own subject
          // line, both of which survive.
          fromAddress: source.kind === "email" ? "the school office" : null,
          capturedAt: source.capturedAt,
        },
      });
    }

    return { householdName: household.name, cards };
  },
});

export const feed = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("activity"),
      at: v.number(),
      kind: v.string(),
      message: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const configured = demoHouseholdId();
    if (configured === undefined) return [];

    const householdId = ctx.db.normalizeId("households", configured);
    if (householdId === null) return [];

    const entries = await Activity.recent(ctx, householdId, 12);
    return entries.map((entry) => ({
      _id: entry._id,
      at: entry._creationTime,
      kind: entry.kind,
      message: entry.message,
    }));
  },
});
