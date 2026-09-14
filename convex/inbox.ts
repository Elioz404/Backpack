import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { AgentMailError, createInbox, subAddress } from "./lib/agentmail";
import { requireMembership } from "./model/households";

/**
 * The household's address.
 *
 * Every household gets one, and they all share a single AgentMail inbox: the
 * address is a sub-address of it, `<inbox>+<householdId>@`, and the webhook
 * reads the tag back off the envelope to decide whose mail it is.
 *
 * One inbox, not one per household, because inboxes are metered — the free
 * tier allows three in total — and sub-addresses are not. It is also the
 * better shape regardless of the meter: a household is a tenant, not a
 * mailbox, and this way the deployment needs exactly one mailbox forever.
 *
 * Households created before this still own an inbox each, and still work:
 * their address has no tag, and inbound routing falls back to the inbox id.
 */

/**
 * Fixed, so a race between two households asking at once cannot create two
 * inboxes — AgentMail returns the existing one for a repeated client id.
 */
const SHARED_INBOX_CLIENT_ID = "backpack-shared-inbox";

export const current = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.union(
    v.null(),
    v.object({
      inboxAddress: v.union(v.string(), v.null()),
      name: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const household = await ctx.db.get(args.householdId);
    if (household === null) return null;
    return {
      inboxAddress: household.inboxAddress ?? null,
      name: household.name,
    };
  },
});

/** The deployment's one mailbox, if it has been created yet. */
export const sharedMailbox = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ inboxId: v.string(), address: v.string() }),
  ),
  handler: async (ctx) => {
    const row = await ctx.db.query("mailbox").first();
    return row === null
      ? null
      : { inboxId: row.inboxId, address: row.address };
  },
});

/**
 * Record the mailbox and hand this household its sub-address, in one
 * transaction. Re-reads the mailbox first so that two households racing to
 * create it settle on whichever row landed rather than overwriting it.
 */
export const attachAddress = internalMutation({
  args: {
    householdId: v.id("households"),
    inboxId: v.string(),
    address: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    let mailbox = await ctx.db.query("mailbox").first();
    if (mailbox === null) {
      const id = await ctx.db.insert("mailbox", {
        inboxId: args.inboxId,
        address: args.address,
        createdAt: Date.now(),
      });
      mailbox = await ctx.db.get(id);
    }
    if (mailbox === null) {
      throw new ConvexError({ code: "UPSTREAM", message: "Mailbox vanished" });
    }

    const household = await ctx.db.get(args.householdId);
    if (household === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "household" });
    }
    // Another caller may have finished first.
    if (household.inboxAddress !== undefined) return household.inboxAddress;

    const address = subAddress(mailbox.address, args.householdId);
    await ctx.db.patch(args.householdId, {
      inboxId: mailbox.inboxId,
      inboxAddress: address,
    });
    return address;
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
 * Idempotent at three levels, because an inbox is metered and an orphaned one
 * cannot be reclaimed by the app: the household row is checked first, the
 * mailbox is reused when it exists, and the create call carries a fixed
 * client id so even a race returns the same inbox rather than a second.
 */
export const ensure = action({
  args: { householdId: v.id("households") },
  returns: v.object({ address: v.string() }),
  handler: async (ctx, args): Promise<{ address: string }> => {
    // Actions have no database, so the membership check is a query of its own.
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

    const mailbox = await ctx.runQuery(internal.inbox.sharedMailbox, {});

    let inboxId = mailbox?.inboxId;
    let inboxAddress = mailbox?.address;

    if (inboxId === undefined || inboxAddress === undefined) {
      try {
        const created = await createInbox({
          displayName: "Backpack",
          clientId: SHARED_INBOX_CLIENT_ID,
        });
        inboxId = created.inbox_id;
        inboxAddress = created.email;
      } catch (error) {
        if (error instanceof AgentMailError) {
          throw new ConvexError({
            code: "UPSTREAM",
            // AgentMail's own code and its `fix` sentence, so the reader is
            // told what to do rather than guessing at the API key.
            upstream: error.code ?? String(error.status),
            message: error.message,
          });
        }
        throw error;
      }
    }

    const address = await ctx.runMutation(internal.inbox.attachAddress, {
      householdId: args.householdId,
      inboxId,
      address: inboxAddress,
    });

    return { address };
  },
});
