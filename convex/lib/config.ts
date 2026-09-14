import { env } from "../_generated/server";

/**
 * Every tunable in one place, read from the deployment environment with a
 * documented default. Nothing in the pipeline reads `process.env` directly and
 * nothing carries a magic number inline.
 */

/**
 * The cheap model, on purpose.
 *
 * Extraction is high-volume and narrow: read one page, answer a strict JSON
 * schema, quote the source. The schema does most of the work and the verbatim
 * check catches what it does not, so the judgement a larger model buys is
 * mostly wasted here — and a single 40-page crawl at `gpt-5.6-terra` costs
 * about twenty times what it costs at `gpt-5.6-luna`.
 *
 * Override with `OPENAI_MODEL` to trade cost for judgement (`gpt-5.6-terra`,
 * `gpt-5.6-sol`, `gpt-6-astra`) once the bill is somebody else's problem.
 */
const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";

/**
 * What each model costs, in micro-cents per token, so the spend guard can
 * account in integers. Input first, output second.
 *
 * Update alongside OpenAI's pricing page — an unknown model is charged at the
 * most expensive rate here rather than at zero, so a typo in `OPENAI_MODEL`
 * cannot silently disable the budget.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  // $0.20 / $1.20 per million tokens.
  "gpt-5.6-luna": { input: 20, output: 120 },
  // $2.00 / $12.00
  "gpt-5.6-terra": { input: 200, output: 1_200 },
  // $4.00 / $20.00
  "gpt-5.6-sol": { input: 400, output: 2_000 },
  // $10.00 / $50.00
  "gpt-6-astra": { input: 1_000, output: 5_000 },
};

export function priceOf(model: string): { input: number; output: number } {
  return (
    PRICES[model] ?? { input: 1_000, output: 5_000 }
  );
}

/**
 * The ceiling, in whole cents, on what this deployment may spend at OpenAI.
 *
 * A hard stop rather than an alert: the operator is paying, the pipeline runs
 * unattended on a cron, and a runaway crawl should fail loudly long before it
 * empties an account. Raise it with `OPENAI_BUDGET_CENTS`.
 */
const DEFAULT_BUDGET_CENTS = 400;

/** Model calls are bounded so one pathological page cannot stall a crawl. */
const OPENAI_TIMEOUT_MS = 90_000;
const OPENAI_MAX_RETRIES = 4;

/**
 * How much of a page or message the model is shown.
 *
 * Measured rather than guessed: over a real 40-page crawl of a school district
 * site, 24,000 characters sent 810,000 characters to the model and 8,000 sent
 * 321,000 — a 60% cut. School sites repeat their navigation on every page and
 * put the notice near the top, so the tail is mostly chrome that has already
 * been paid for on the page before.
 */
export const MAX_SOURCE_CHARS = 8_000;

/**
 * Concurrency for the extraction pool: OpenAI calls in flight at once.
 *
 * Two, not four. A new OpenAI account's per-minute token limit is low enough
 * that four parallel extractions trip it together, and four callers then back
 * off in the same window and trip it again — 23 of one 40-page crawl failed
 * that way. The pool exists to make the fan-out polite; this is the number
 * that makes it so.
 */
export const EXTRACTION_CONCURRENCY = 2;

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

/**
 * Default crawl breadth for a newly added school; editable per school.
 *
 * Fifteen, not forty. Each page is one OpenAI request, and a new account's cap
 * is fifty requests a *day* — so a forty-page default means the first person to
 * try it takes the day's allowance for everyone. Fifteen finishes in about
 * ninety seconds instead of four minutes, leaves room for three runs a day, and
 * on the school sites tested still reaches the calendar and the newsletters,
 * which is where anything a family owes actually lives.
 */
export const DEFAULT_CRAWL_LIMIT = 15;

/**
 * When a dated obligation has no time of day, it is due at the end of the
 * school day in the household's own zone rather than at midnight UTC.
 */
export const ALL_DAY_DUE_HOUR = 15;

export const budgetCents = (): number => {
  const raw = env.OPENAI_BUDGET_CENTS;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUDGET_CENTS;
};

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
