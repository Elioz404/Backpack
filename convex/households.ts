import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import * as Example from "./model/example";
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
 * Everything a first visit needs, in one call: a household, and a board with
 * something on it.
 *
 * Separate from `create` because the two are asked by different people for
 * different reasons. A family creating a household names it and means it; a
 * visitor trying the product wants to be looking at a board, and every
 * question asked before that is a question they did not come to answer.
 *
 * Idempotent: someone who already has a household gets that one back rather
 * than a second.
 */
export const startTrial = mutation({
  args: { timeZone: v.string() },
  returns: v.id("households"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const existing = await householdsForUser(ctx, userId);
    const already = existing[0];
    if (already !== undefined) return already._id;

    const householdId = await createHousehold(ctx, {
      name: "Your household",
      // A board of local dates shown in somebody else's zone is a board of
      // wrong dates, so the caller's own zone is used when it is usable.
      timeZone: isValidTimeZone(args.timeZone) ? args.timeZone : "UTC",
      userId,
    });

    const household = await ctx.db.get(householdId);
    if (household !== null) await Example.fill(ctx, household);

    return householdId;
  },
});

/**
 * Fill this household with the worked example.
 *
 * A new board is empty, and the honest ways to fill it — crawl a school site,
 * forward it some mail — take minutes and spend a quota. This puts a real,
 * private board in front of someone within seconds of signing up, with their
 * own address and every control live, which the public read-only example
 * cannot do.
 *
 * Writes only into the caller's own household, so nothing is shared.
 */
export const fillWithExample = mutation({
  args: { householdId: v.id("households") },
  returns: v.object({ obligations: v.number(), children: v.number() }),
  handler: async (ctx, args) => {
    const { household } = await requireMembership(ctx, args.householdId);
    return await Example.fill(ctx, household);
  },
});

/**
 * Add the other parent to this household, by the username they signed up with.
 *
 * By username rather than by an emailed link: the second parent is usually
 * standing right there, and a link that has to survive a mail round trip is a
 * worse experience than typing a name. It also means the whole point of the
 * product — two people on one board — needs no mail to be deliverable before
 * it works.
 *
 * Idempotent, so inviting someone twice is not an error, and it refuses
 * politely rather than revealing whether a username exists on this
 * deployment... except that it cannot: the inviter has to be told when they
 * have typed the name wrong, or they will sit waiting for someone who was
 * never added. Names are not secrets here.
 */
export const addMember = mutation({
  args: { householdId: v.id("households"), username: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwnership(ctx, args.householdId);

    const username = args.username.trim();
    if (username === "") {
      throw new ConvexError({ code: "INVALID", field: "username" });
    }

    const inviteeId: string | null = await ctx.runQuery(
      components.authUsername.public.getUserIdByUsername,
      { username },
    );
    const userId =
      inviteeId === null ? null : ctx.db.normalizeId("users", inviteeId);

    if (userId === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "user" });
    }

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_and_household", (q) =>
        q.eq("userId", userId).eq("householdId", args.householdId),
      )
      .unique();

    if (existing !== null) return null;

    await ctx.db.insert("memberships", {
      householdId: args.householdId,
      userId,
      role: "parent",
      joinedAt: Date.now(),
    });
    return null;
  },
});
