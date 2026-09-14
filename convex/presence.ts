import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireMembership } from "./model/households";

/**
 * Who else is on this board right now.
 *
 * The point of a shared board is that two parents are looking at the same
 * thing; presence is what makes that visible, so the second person knows the
 * first is already on it before they both do the same errand.
 *
 * The room is the household id, and joining one is gated on membership — a
 * room id is not a capability.
 */
const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: {
    householdId: v.id("households"),
    sessionId: v.string(),
    interval: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMembership(ctx, args.householdId);
    return await presence.heartbeat(
      ctx,
      args.householdId,
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
