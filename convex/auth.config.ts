import type { AuthConfig } from "convex/server";

/**
 * Which token issuers this deployment trusts.
 *
 * Convex Auth signs access tokens with `AUTH_PRIVATE_KEY` and serves the
 * matching public key from the mounted auth component. This file is what makes
 * those tokens *accepted*: without it every authenticated request is rejected
 * with "No auth provider found matching the given token", which a user meets
 * immediately after an otherwise successful sign-up.
 *
 * `customJwt` rather than the OIDC-style shape because the issuer and the key
 * set are at different places. The token's `iss` is the deployment's site
 * origin, but the component mounts its routes under `/auth`, so the key set is
 * at `/auth/.well-known/jwks.json` and not at the origin's `.well-known`. An
 * OIDC provider would derive the second from the first and look in the wrong
 * place; this states both.
 *
 * `applicationID` is the token's `aud` claim, which Convex Auth sets to
 * "convex".
 */
export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "convex",
      issuer: process.env.CONVEX_SITE_URL!,
      jwks: `${process.env.CONVEX_SITE_URL}/auth/.well-known/jwks.json`,
      algorithm: "RS256",
    },
  ],
} satisfies AuthConfig;
