import type { MutationCtx, QueryCtx } from "../_generated/server";
import { budgetCents, priceOf } from "../lib/config";
import type { Usage } from "../lib/openai/client";

/**
 * What this deployment has spent at OpenAI, and whether it may spend more.
 *
 * The operator pays for every extraction on their own key, and the pipeline
 * runs unattended: a weekly cron re-reads every school site, and one crawl of
 * a large district fans out to forty model calls. Left ungoverned that is a
 * bill nobody chose. So the spend is metered against a ceiling and refused
 * past it — a hard stop, not a warning, because a warning nobody is awake to
 * read is not a control.
 *
 * Accounted in micro-cents as integers. Adding fractions of a cent as floats
 * forty times an hour drifts, and a budget that drifts is not a budget.
 */

const MICRO_CENTS_PER_CENT = 1_000_000;

export type Ledger = {
  spentCents: number;
  budgetCents: number;
  calls: number;
  exhausted: boolean;
};

export async function read(ctx: QueryCtx): Promise<Ledger> {
  const row = await ctx.db.query("apiSpend").first();
  const limit = budgetCents();
  const spentCents =
    row === null ? 0 : row.microCents / MICRO_CENTS_PER_CENT;

  return {
    spentCents,
    budgetCents: limit,
    calls: row?.calls ?? 0,
    exhausted: spentCents >= limit,
  };
}

/**
 * Whether another call is allowed.
 *
 * Checked before the call rather than after, so the ceiling is a ceiling. It
 * can be exceeded by at most one call's worth, because the cost of a call is
 * not known until it returns.
 */
export async function maySpend(ctx: QueryCtx): Promise<boolean> {
  return !(await read(ctx)).exhausted;
}

/** Add one call to the running total. */
export async function record(
  ctx: MutationCtx,
  model: string,
  usage: Usage,
): Promise<void> {
  const price = priceOf(model);
  const cost =
    usage.inputTokens * price.input + usage.outputTokens * price.output;

  const row = await ctx.db.query("apiSpend").first();
  if (row === null) {
    await ctx.db.insert("apiSpend", {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      microCents: cost,
      calls: 1,
      since: Date.now(),
    });
    return;
  }

  await ctx.db.patch(row._id, {
    inputTokens: row.inputTokens + usage.inputTokens,
    outputTokens: row.outputTokens + usage.outputTokens,
    microCents: row.microCents + cost,
    calls: row.calls + 1,
  });
}
