import { defineApp } from "convex/server";
import { v } from "convex/values";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import authCore from "@convex-dev/auth/core/convex.config.js";
import authUsername from "@convex-dev/auth/username/convex.config.js";
import authPassword from "@convex-dev/auth/providers/password/convex.config.js";
import authAnonymous from "@convex-dev/auth/providers/anonymous/convex.config.js";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import workpool from "@convex-dev/workpool/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import presence from "@convex-dev/presence/convex.config";

/**
 * Component wiring for Backpack.
 *
 * Static hosting owns the root so the SPA is served from `convex.site`.
 *
 * The app-level `httpPrefix` moves *our* routes — the ones declared in
 * `convex/http.ts` — under `/api`. It does not apply to components: each one's
 * own `httpPrefix` is rooted at the deployment root. Verified against the
 * running deployment, because the two nest differently and guessing produces a
 * webhook URL that 404s in production only:
 *
 *   /                            the SPA
 *   /api/agentmail/webhook       convex/http.ts
 *   /firecrawl/webhook           the Firecrawl component
 *   /auth/.well-known/jwks.json  the Convex Auth component
 *
 * Secrets are declared once here and passed into the components that need
 * them, so no component reads a raw `process.env` and no key ever travels
 * through function arguments.
 */
const app = defineApp({
  httpPrefix: "/api",
  env: {
    AUTH_PRIVATE_KEY: v.string(),
    AUTH_JWKS: v.string(),
    FIRECRAWL_API_KEY: v.string(),
    FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()),
    // Declared here so our own functions read them through the generated,
    // typed `env` rather than a raw `process.env` lookup.
    AGENTMAIL_API_KEY: v.string(),
    AGENTMAIL_WEBHOOK_SECRET: v.optional(v.string()),
    OPENAI_API_KEY: v.string(),
    OPENAI_MODEL: v.optional(v.string()),
    OPENAI_BASE_URL: v.optional(v.string()),
    OPENAI_BUDGET_CENTS: v.optional(v.string()),
    // Names the one household whose board anyone may read. See convex/demo.ts.
    DEMO_HOUSEHOLD_ID: v.optional(v.string()),
  },
});

// The SPA. Owns `/`; see the note above about route nesting.
app.use(staticHosting, { httpPrefix: "/" });

// Auth: households are private, so every read is gated on a signed-in member.
app.use(authCore, {
  httpPrefix: "/auth",
  env: {
    AUTH_PRIVATE_KEY: app.env.AUTH_PRIVATE_KEY,
    AUTH_JWKS: app.env.AUTH_JWKS,
  },
});
app.use(authUsername);
app.use(authPassword);
// Lets someone try the real product without inventing a password first. See
// the note in convex/auth.ts.
app.use(authAnonymous);

// Firecrawl: durable crawls of a school site, with progress the UI subscribes to.
app.use(firecrawl, {
  httpPrefix: "/firecrawl/",
  env: {
    FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY,
    FIRECRAWL_WEBHOOK_SECRET: app.env.FIRECRAWL_WEBHOOK_SECRET,
  },
});

// AgentMail has no component here on purpose. `@agentmail/convex@0.1.0` reads
// its API key from `process.env` inside its own isolate, where deployment
// variables are not visible, and declares no typed env to pass one in — so
// every call fails with "AGENTMAIL_API_KEY is not set" even when it is. It is
// reached over its REST API instead, from `convex/lib/agentmail.ts`.

// A crawl can land a hundred pages at once; each one costs an OpenAI call.
// The pool bounds that fan-out instead of scheduling a hundred actions.
app.use(workpool, { name: "extractionPool" });

// Crawls spend Firecrawl credits and extractions spend OpenAI budget, both on
// the user's own keys. Every entry point that spends is limited per household.
app.use(rateLimiter);

// Two parents on the same board: who is looking, and who is already on it.
app.use(presence);

export default app;
