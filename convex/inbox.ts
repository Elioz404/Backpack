import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { AgentMailError, createInbox } from "./lib/agentmail";
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
 * Doubly idempotent, because inboxes are metered and an orphaned one cannot be
 * reclaimed by the app: the household row is checked first, and the create
 * call carries the household id as AgentMail's `client_id`, so even a retry
 * that races past that check returns the same inbox instead of a second one.
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

    let inbox;
    try {
      inbox = await createInbox({
        displayName: `${existing.name} — Backpack`,
        clientId: args.householdId,
      });
    } catch (error) {
      if (error instanceof AgentMailError) {
        throw new ConvexError({
          code: "UPSTREAM",
          // AgentMail's own code, so the UI can tell "out of inboxes" from
          // "bad key" instead of showing one shrug for both.
          upstream: error.code ?? String(error.status),
          message: error.message,
        });
      }
      throw error;
    }

    await ctx.runMutation(internal.inbox.attachInbox, {
      householdId: args.householdId,
      inboxId: inbox.inbox_id,
      inboxAddress: inbox.email,
    });

    return { address: inbox.email };
  },
});
