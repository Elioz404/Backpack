import { Presence } from "@convex-dev/presence";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./model/auth";

/**
 * Who else is on this board right now.
 *
 * The point of a shared board is that two parents are looking at the same
 * thing; presence is what makes that visible, so the second person knows the
 * first is already on it before they both do the same errand.
 */
const presence = new Presence(components.presence);

/**
 * The argument names are fixed by `usePresence`, which is why the room arrives
 * as a `roomId` string rather than an `Id<"households">`.
 *
 * The client's `userId` argument is accepted and then **ignored**: identity
 * comes from the session, not from the caller, or anyone could appear on
 * anyone's board as anyone. The room is likewise checked — a room id is not a
 * capability.
 */
export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  returns: v.object({ roomToken: v.string(), sessionToken: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const householdId = ctx.db.normalizeId("households", args.roomId);
    if (householdId === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "household" });
    }

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_and_household", (q) =>
        q.eq("userId", userId).eq("householdId", householdId),
      )
      .unique();

    if (membership === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "household" });
    }

    return await presence.heartbeat(
      ctx,
      householdId,
      userId,
      args.sessionId,
      args.interval,
    );
  },
});

export const list = query({
  args: { roomToken: v.string() },
  handler: async (ctx, args) => {
    // Deliberately no per-user read: every subscriber to a room shares one
    // cache entry, which is the whole reason this component scales.
    return await presence.list(ctx, args.roomToken);
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    // Called over HTTP from `sendBeacon` as the tab closes, where there is no
    // authenticated context left to check. The token is the authorisation.
    return await presence.disconnect(ctx, args.sessionToken);
  },
});
