import OpenAI from "openai";
import { openAiConfig } from "../config";

/**
 * The OpenAI client, built per call from the deployment environment.
 *
 * Deliberately not a module-level singleton: Convex actions run in isolates
 * that may outlive an environment change, and building the client is cheap
 * next to the request it makes.
 */
export function openAiClient(): { client: OpenAI; model: string } {
  const config = openAiConfig();

  if (config.apiKey.startsWith("PLACEHOLDER")) {
    throw new Error(
      "OPENAI_API_KEY is still the provisioning placeholder. Set a real key " +
        "with `npx convex env set OPENAI_API_KEY sk-...` before extracting.",
    );
  }

  return {
    client: new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
    }),
    model: config.model,
  };
}
