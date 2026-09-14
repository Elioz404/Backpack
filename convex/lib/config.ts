import { env } from "../_generated/server";

/**
 * Every tunable in one place, read from the deployment environment with a
 * documented default. Nothing in the pipeline reads `process.env` directly and
 * nothing carries a magic number inline.
 */

/**
 * Balances capability against cost, which matters here because a single crawl
 * can fan out to a hundred extractions on the operator's own API key.
 * Override with `OPENAI_MODEL` to trade cost for judgement (`gpt-5.6-sol`,
 * `gpt-6-astra`) or the other way (`gpt-5.6-luna`).
 */
const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

/** Model calls are bounded so one pathological page cannot stall a crawl. */
const OPENAI_TIMEOUT_MS = 90_000;
const OPENAI_MAX_RETRIES = 2;

/**
 * How much of a page or message the model is shown. School pages are mostly
 * navigation; the informative part is at the top. Well under the model's
 * context window, and it keeps the per-page cost predictable.
 */
export const MAX_SOURCE_CHARS = 24_000;

/** Concurrency for the extraction pool: OpenAI calls in flight at once. */
export const EXTRACTION_CONCURRENCY = 4;

/** A crawl is a spend, so each household gets a bounded number of them. */
export const CRAWL_RATE_LIMIT = {
  /** Crawls per period. */
  rate: 6,
  /** One hour. */
  periodMs: 60 * 60 * 1000,
  /** Allows two back-to-back crawls after a quiet hour. */
  capacity: 2,
} as const;

/** Outbound questions, bounded well under AgentMail's 100/day free tier. */
export const QUESTION_RATE_LIMIT = {
  rate: 20,
  periodMs: 24 * 60 * 60 * 1000,
  capacity: 5,
} as const;

/** Default crawl breadth for a newly added school; editable per school. */
export const DEFAULT_CRAWL_LIMIT = 40;

/**
 * When a dated obligation has no time of day, it is due at the end of the
 * school day in the household's own zone rather than at midnight UTC.
 */
export const ALL_DAY_DUE_HOUR = 15;

export const openAiConfig = () => ({
  apiKey: env.OPENAI_API_KEY,
  model: env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
  baseURL: env.OPENAI_BASE_URL,
  timeoutMs: OPENAI_TIMEOUT_MS,
  maxRetries: OPENAI_MAX_RETRIES,
});

export const agentMailConfig = () => ({
  apiKey: env.AGENTMAIL_API_KEY,
  webhookSecret: env.AGENTMAIL_WEBHOOK_SECRET,
});

/**
 * The deployment's own public origin. Used to register the AgentMail webhook
 * and to link back into the app from an outbound email, so neither is ever a
 * literal in the code.
 */
export const siteUrl = () => env.CONVEX_SITE_URL;
