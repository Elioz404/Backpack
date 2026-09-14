import { setupCore } from "@convex-dev/auth/core/setup";
import { setupAnonymous } from "@convex-dev/auth/providers/anonymous/setup";
import { setupUsernamePassword } from "@convex-dev/auth/providers/password/setup";
import { components, internal } from "./_generated/api";

/**
 * Authentication.
 *
 * A household's board is private, so every read and write is gated on a signed
 * in member. Username and password for a family: the second parent needs to be
 * signed in on their own phone within a minute of being invited, and that
 * should not depend on an OAuth consent screen or on mail being deliverable.
 *
 * And anonymous, for someone who has not decided yet. A shared family board is
 * not a thing anyone can judge from a sign-up form, and a read-only tour would
 * show the output while hiding the point, which is two people moving the same
 * list. An anonymous session is a real session: a real household, a real
 * address, every control live, and private to whoever opened it.
 *
 * Convex Auth owns credentials and sessions inside its own components; this
 * app owns the `users` table and mints the row in `users.createPasswordUser`.
 */
const core = setupCore({
  component: components.auth,
  usersTable: "users",
});

export const { signOut, refreshSession, isAuthenticated } = core;

export const { signUpWithPassword, signInWithPassword } = setupUsernamePassword(
  core,
  {
    component: components.authPasswordProvider,
    usernameComponent: components.authUsername,
  },
).attachUserCallbacks({ createUser: internal.users.createPasswordUser });

export const { signInAnonymous } = setupAnonymous(core, {
  component: components.authAnonymous,
}).attachUserCallbacks({ createUser: internal.users.createAnonymousUser });
