import { getAuthUserId } from "@convex-dev/auth/core";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";

/**
 * Identity, in one place.
 *
 * Every public function starts by calling one of these rather than reading
 * `ctx.auth` itself, so there is a single definition of what "signed in" means
 * and no endpoint can forget to check.
 */

type AuthCtx = Parameters<typeof getAuthUserId>[0];

/** The signed-in user, or `null` for an anonymous caller. */
export async function currentUserId(
  ctx: AuthCtx,
): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  return userId as Id<"users"> | null;
}

/**
 * The signed-in user, or a thrown error.
 *
 * `ConvexError` rather than a bare `Error` so the client can tell "you are
 * signed out" apart from "something broke" and route to the sign-in screen
 * instead of showing a crash.
 */
export async function requireUserId(ctx: AuthCtx): Promise<Id<"users">> {
  const userId = await currentUserId(ctx);
  if (userId === null) {
    throw new ConvexError({ code: "UNAUTHENTICATED" });
  }
  return userId;
}
