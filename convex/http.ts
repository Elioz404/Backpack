import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { verifyWebhook, webhookSecret } from "./lib/agentmail";

/**
 * The app's own HTTP surface.
 *
 * Static hosting owns `/` so the SPA is served from the deployment root; the
 * app-level `httpPrefix` in `convex.config.ts` puts everything declared here
 * under `/api`. The route below is therefore reachable at
 * `https://<deployment>.convex.site/api/agentmail/webhook` — that, and not the
 * unprefixed path, is the URL to register with AgentMail.
 *
 * Firecrawl's callback is not here. That component mounts its own route, and
 * component prefixes are *not* nested under the app's, so it answers at
 * `/firecrawl/webhook` with no `/api`. The component registers it itself.
 */
const http = httpRouter();

/** Event types that carry a message a household should see. */
const INBOUND_EVENTS = new Set([
  "message.received",
  "message.received.unauthenticated",
]);

http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = webhookSecret();
    if (secret === undefined) {
      // Refusing is the only safe answer: without the secret there is no way
      // to tell AgentMail apart from anyone who has guessed the URL.
      return new Response("Webhook secret not configured", { status: 503 });
    }

    const body = await request.text();
    if (!(await verifyWebhook(secret, request.headers, body))) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Malformed payload", { status: 400 });
    }

    const event = payload as {
      event_id?: unknown;
      event_type?: unknown;
      message?: unknown;
    };
    const eventId =
      typeof event.event_id === "string" ? event.event_id : undefined;
    const eventType =
      typeof event.event_type === "string" ? event.event_type : undefined;

    if (eventId === undefined || eventType === undefined) {
      return new Response("Missing event id or type", { status: 400 });
    }

    // 200 on an event we do not act on: anything else makes Svix retry
    // something that will never be handled.
    if (!INBOUND_EVENTS.has(eventType)) {
      return new Response(null, { status: 204 });
    }

    await ctx.runMutation(internal.pipelines.mailIngest.onMessageReceived, {
      eventId,
      eventType,
      message: event.message ?? null,
    });

    return new Response(null, { status: 204 });
  }),
});

export default http;
