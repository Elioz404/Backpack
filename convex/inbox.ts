import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { agentmail } from "./lib/agentmail";
import { requireMembership } from "./model/households";

/**
 * The household's address.
 *
 * One inbox per household, created on demand. Parents set their school mail to
 * forward here and stop reading it themselves; the board reads it instead.
 *
 * One inbox rather than one per child or per school, because AgentMail's free
 * tier allows three in total. Threads and labels already separate
 * conversations, so nothing is lost by it — and a single address is the one a
 * parent can actually remember to forward to.
 */

/** Read the inbox without creating one. */
export const current = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.union(
    v.null(),
    v.object({
      inboxId: v.union(v.string(), v.null()),
      inboxAddress: v.union(v.string(), v.null()),
      name: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const household = await ctx.db.get(args.householdId);
    if (household === null) return null;
    return {
      inboxId: household.inboxId ?? null,
      inboxAddress: household.inboxAddress ?? null,
      name: household.name,
    };
  },
});

export const attachInbox = internalMutation({
  args: {
    householdId: v.id("households"),
    inboxId: v.string(),
    inboxAddress: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.householdId, {
      inboxId: args.inboxId,
      inboxAddress: args.inboxAddress,
    });
    return null;
  },
});

export const authorize = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);
    return null;
  },
});

/**
 * Give this household an address, or return the one it already has.
 *
 * Idempotent: calling it twice does not create a second inbox, which matters
 * because inboxes are a metered resource and an orphaned one cannot be
 * reclaimed by the app.
 */
export const ensure = action({
  args: { householdId: v.id("households") },
  returns: v.object({ address: v.string() }),
  handler: async (ctx, args): Promise<{ address: string }> => {
    // Actions have no database, so the membership check is a query of its own
    // rather than an inline read.
    await ctx.runQuery(internal.inbox.authorize, {
      householdId: args.householdId,
    });

    const existing = await ctx.runQuery(internal.inbox.current, {
      householdId: args.householdId,
    });
    if (existing === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "household" });
    }
    if (existing.inboxAddress !== null) {
      return { address: existing.inboxAddress };
    }

    const inbox = await agentmail.createInbox(ctx, {
      displayName: `${existing.name} — Backpack`,
    });

    const inboxId = readField(inbox, "inbox_id");
    const address = readField(inbox, "address") ?? inboxId;

    if (inboxId === null || address === null) {
      throw new ConvexError({
        code: "UPSTREAM",
        message: "AgentMail returned an inbox without an id or address",
      });
    }

    await ctx.runMutation(internal.inbox.attachInbox, {
      householdId: args.householdId,
      inboxId,
      inboxAddress: address,
    });

    return { address };
  },
});

/** The client returns the AgentMail payload as-is, so read it defensively. */
function readField(payload: unknown, key: string): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : null;
}
