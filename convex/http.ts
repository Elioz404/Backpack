import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { agentmail } from "./lib/agentmail";

/**
 * The app's own HTTP surface.
 *
 * Static hosting owns `/` so the SPA is served from the deployment root; the
 * app-level `httpPrefix` in `convex.config.ts` puts everything declared here
 * under `/api`. The route below is therefore reachable at
 * `https://<deployment>.convex.site/api/agentmail/webhook`, which is the URL
 * to register with AgentMail.
 *
 * Firecrawl's callback is not here: that component mounts its own route, at
 * `/api/firecrawl/webhook`.
 */
const http = httpRouter();

/**
 * Bridge one upstream typing bug.
 *
 * `@agentmail/convex@0.1.0` declares `handleWebhook(ctx: RunMutationCtx, ...)`
 * where `RunMutationCtx` is `{ runMutation: GenericMutationCtx["runMutation"] }`
 * — a *mutation* context's signature, which takes an options argument. A
 * webhook can only be served from an `httpAction`, whose `runMutation` does
 * not. The two are structurally incompatible, so the component's own
 * documented usage does not typecheck against any current Convex.
 *
 * At runtime there is nothing wrong: the component calls `ctx.runMutation`
 * with args only, which an action context does correctly. So the mismatch is
 * bridged here, once, at the single seam where it occurs, rather than by
 * patching the dependency. Remove this when AgentMail widens the parameter.
 */
type WebhookCtx = Parameters<typeof agentmail.handleWebhook>[0];

http.route({
  path: "/agentmail/webhook",
  method: "POST",
  // The component verifies the Svix signature and dedupes by event id before
  // anything reaches our pipeline, so there is no unverified path inward.
  handler: httpAction(async (ctx, request) =>
    agentmail.handleWebhook(ctx as unknown as WebhookCtx, request),
  ),
});

export default http;
