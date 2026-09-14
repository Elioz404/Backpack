import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isValidTimeZone } from "./lib/time";
import { requireUserId } from "./model/auth";
import {
  createHousehold,
  householdsForUser,
  requireMembership,
  requireOwnership,
} from "./model/households";

/**
 * Households: creating one, joining one, and reading the shell the rest of the
 * app hangs off.
 */

export const mine = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("households"),
      name: v.string(),
      timeZone: v.string(),
      inboxAddress: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const households = await householdsForUser(ctx, userId);
    return households.map((household) => ({
      _id: household._id,
      name: household.name,
      timeZone: household.timeZone,
      inboxAddress: household.inboxAddress ?? null,
    }));
  },
});

export const get = query({
  args: { householdId: v.id("households") },
  returns: v.object({
    _id: v.id("households"),
    name: v.string(),
    timeZone: v.string(),
    inboxAddress: v.union(v.string(), v.null()),
    role: v.union(v.literal("owner"), v.literal("parent")),
    members: v.array(
      v.object({
        userId: v.id("users"),
        displayName: v.string(),
        role: v.union(v.literal("owner"), v.literal("parent")),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { household, role } = await requireMembership(ctx, args.householdId);

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .collect();

    const members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        return {
          userId: membership.userId,
          displayName: user?.displayName ?? "Someone",
          role: membership.role,
        };
      }),
    );

    return {
      _id: household._id,
      name: household.name,
      timeZone: household.timeZone,
      inboxAddress: household.inboxAddress ?? null,
      role,
      members,
    };
  },
});

export const create = mutation({
  args: { name: v.string(), timeZone: v.string() },
  returns: v.id("households"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const name = args.name.trim();
    if (name === "") {
      throw new ConvexError({ code: "INVALID", field: "name" });
    }
    // Deadlines are local dates, so an unusable zone would silently move every
    // due time. Rejected at the door rather than defaulted.
    if (!isValidTimeZone(args.timeZone)) {
      throw new ConvexError({ code: "INVALID", field: "timeZone" });
    }

    return await createHousehold(ctx, { name, timeZone: args.timeZone, userId });
  },
});

/**
 * Add someone who already has an account to this household.
 *
 * Invitation by username rather than by email link: the second parent is
 * usually standing right there, and a link that has to survive a mail round
 * trip is a worse experience than typing a name. Idempotent, so inviting
 * someone twice is not an error.
 */
export const addMember = mutation({
  args: { householdId: v.id("households"), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwnership(ctx, args.householdId);

    const invitee = await ctx.db.get(args.userId);
    if (invitee === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "user" });
    }

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_and_household", (q) =>
        q.eq("userId", args.userId).eq("householdId", args.householdId),
      )
      .unique();

    if (existing !== null) return null;

    await ctx.db.insert("memberships", {
      householdId: args.householdId,
      userId: args.userId,
      role: "parent",
      joinedAt: Date.now(),
    });
    return null;
  },
});
