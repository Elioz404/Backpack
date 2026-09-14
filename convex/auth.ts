import { setupCore } from "@convex-dev/auth/core/setup";
import { setupUsernamePassword } from "@convex-dev/auth/providers/password/setup";
import { components, internal } from "./_generated/api";

/**
 * Authentication.
 *
 * A household's board is private, so every read and write is gated on a signed
 * in member. Username and password only: a family needs a second parent signed
 * in on their own phone within a minute of being invited, and that should not
 * depend on an OAuth consent screen or on mail being deliverable.
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
