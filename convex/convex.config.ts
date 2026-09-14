import { defineApp } from "convex/server";
import { v } from "convex/values";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import authCore from "@convex-dev/auth/core/convex.config.js";
import authUsername from "@convex-dev/auth/username/convex.config.js";
import authPassword from "@convex-dev/auth/providers/password/convex.config.js";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import agentmail from "@agentmail/convex/convex.config";
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
    // typed `env` rather than a raw `process.env` lookup. The AgentMail
    // component reads its two directly off the deployment as well.
    AGENTMAIL_API_KEY: v.string(),
    AGENTMAIL_WEBHOOK_SECRET: v.optional(v.string()),
    OPENAI_API_KEY: v.string(),
    OPENAI_MODEL: v.optional(v.string()),
    OPENAI_BASE_URL: v.optional(v.string()),
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

// Firecrawl: durable crawls of a school site, with progress the UI subscribes to.
app.use(firecrawl, {
  httpPrefix: "/firecrawl/",
  env: {
    FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY,
    FIRECRAWL_WEBHOOK_SECRET: app.env.FIRECRAWL_WEBHOOK_SECRET,
  },
});

// AgentMail: the household inbox that school mail is forwarded into, and the
// address questions to the school office are sent from. Unlike Firecrawl, this
// component declares no typed env of its own at 0.1.0 and reads
// AGENTMAIL_API_KEY and AGENTMAIL_WEBHOOK_SECRET off the deployment directly,
// so there is nothing to pass in here.
app.use(agentmail);

// A crawl can land a hundred pages at once; each one costs an OpenAI call.
// The pool bounds that fan-out instead of scheduling a hundred actions.
app.use(workpool, { name: "extractionPool" });

// Crawls spend Firecrawl credits and extractions spend OpenAI budget, both on
// the user's own keys. Every entry point that spends is limited per household.
app.use(rateLimiter);

// Two parents on the same board: who is looking, and who is already on it.
app.use(presence);

export default app;
