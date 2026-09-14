import { openAiConfig } from "../config";

/**
 * OpenAI, over the Responses API.
 *
 * Not the `openai` package. The SDK sets `url.username` when it normalises a
 * request, which the Convex runtime does not implement — every call fails with
 * "Not implemented: set username for URL. Consider calling an action defined
 * in Node.js instead". Moving to a Node action would fix it and cost a cold
 * start on every extraction, so this calls the endpoint directly instead,
 * which is also how the Firecrawl component and our AgentMail client work.
 *
 * One entry point, `respondJson`, because every call this app makes is the
 * same shape: a system prompt, a user prompt, and a strict JSON schema the
 * answer must satisfy.
 */

const API_BASE = "https://api.openai.com/v1";

export class OpenAiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenAiError";
    this.status = status;
  }
}

/**
 * Ask for an object matching `schema`, and return it parsed.
 *
 * `strict` is on, so the model cannot answer with a shape the schema does not
 * describe, and there is no prose to salvage a value out of.
 */
export type Usage = { inputTokens: number; outputTokens: number };

export async function respondJson(request: {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<{ value: unknown; usage: Usage }> {
  const config = openAiConfig();

  if (config.apiKey.startsWith("PLACEHOLDER")) {
    throw new Error(
      "OPENAI_API_KEY is still the provisioning placeholder. Set a real key " +
        "with `npx convex env set OPENAI_API_KEY sk-...` before extracting.",
    );
  }

  const response = await fetchWithRetry(
    `${config.baseURL ?? API_BASE}/responses`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
      }),
    },
    config.maxRetries,
    config.timeoutMs,
  );

  const payload: unknown = await response.json();
  return {
    value: JSON.parse(outputText(payload)),
    usage: readUsage(payload),
  };
}

/**
 * Token counts as the API reports them.
 *
 * Missing counts are reported as zero rather than estimated: a guess folded
 * into a running total that gates spending is worse than a known undercount
 * the operator can see is wrong.
 */
function readUsage(payload: unknown): Usage {
  const usage = (payload as { usage?: { input_tokens?: number; output_tokens?: number } })
    .usage;
  return {
    inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
    outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
  };
}

/**
 * Pull the answer out of a Responses payload.
 *
 * `output_text` is an SDK convenience that the wire format does not carry, so
 * the message content is read directly. A refusal is surfaced as an error
 * rather than being parsed as JSON and failing confusingly one line later.
 */
function outputText(payload: unknown): string {
  const response = payload as {
    status?: string;
    incomplete_details?: { reason?: string };
    output?: {
      type?: string;
      content?: { type?: string; text?: string; refusal?: string }[];
    }[];
  };

  if (response.status === "incomplete") {
    throw new OpenAiError(
      200,
      `Model stopped early: ${response.incomplete_details?.reason ?? "unknown reason"}`,
    );
  }

  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "refusal" && part.refusal !== undefined) {
        throw new OpenAiError(200, `Model refused: ${part.refusal}`);
      }
      if (part.type === "output_text" && part.text !== undefined) {
        return part.text;
      }
    }
  }
  throw new OpenAiError(200, "Model returned no text output");
}

/**
 * Retry the failures worth retrying — a rate limit, a timeout, a 5xx — and
 * nothing else. A 400 from a bad schema will fail the same way every time, and
 * retrying it just spends money three times over.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries: number,
  timeoutMs: number,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) return response;

      const body = await response.text();
      // A 429 is normally a rate limit and worth waiting out, but an exhausted
      // credit balance arrives as one too and will never succeed — retrying it
      // three times just delays the error the operator needs to see.
      const outOfCredit = body.includes("insufficient_quota");
      const retryable =
        (response.status === 429 && !outOfCredit) || response.status >= 500;
      lastError = new OpenAiError(
        response.status,
        `OpenAI returned ${response.status}: ${body.slice(0, 300)}`,
      );
      if (!retryable || attempt === maxRetries) throw lastError;
    } catch (error) {
      lastError = error;
      if (error instanceof OpenAiError && error.status < 429) throw error;
      if (attempt === maxRetries) throw error;
    }

    // Exponential, with jitter so a batch of extractions does not retry in
    // lockstep and trip the rate limit again together.
    const backoff = 500 * 2 ** attempt + Math.random() * 250;
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }

  throw lastError;
}
