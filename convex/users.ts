import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { currentUserId } from "./model/auth";

/**
 * The app's user records. Convex Auth holds the credentials; this holds the
 * name that appears on a claimed card.
 */

/**
 * Mint the user row for a new password account.
 *
 * Called by Convex Auth inside the sign-up transaction, so a failure here
 * rolls the whole sign-up back and cannot leave an account without a user.
 */
export const createPasswordUser = internalMutation({
  args: {
    provider: v.literal("password"),
    providerAccountId: v.string(),
    profile: v.object({ username: v.string() }),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("users", {
      displayName: args.profile.username,
    });
  },
});

/** The signed-in user, or `null` when signed out. Drives the whole shell. */
export const me = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("users"),
      displayName: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (userId === null) return null;

    const user = await ctx.db.get(userId);
    return user === null
      ? null
      : { _id: user._id, displayName: user.displayName };
  },
});
