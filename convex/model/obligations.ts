import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { ExtractedItem } from "../lib/openai/extraction";
import { obligationFingerprint } from "../lib/text";
import { resolveDueAt } from "../lib/time";
import * as Activity from "./activity";

/**
 * The board itself: turning what the extractor found into rows a family can
 * act on, without ever showing the same thing twice.
 */

export type MergeOutcome = "created" | "revised" | "unchanged";

/**
 * Fold one extracted item into the household's board.
 *
 * The same obligation is routinely announced more than once — on the school's
 * calendar page, then in a reminder email a week later. Both mention it, so
 * both extract it, and a naive insert would give the family two identical
 * cards. The fingerprint collapses them: same kind, same date, same normalised
 * title means the same obligation, and the second sighting revises the first.
 *
 * Two rules protect what the family has already done:
 *
 * - A `done` or `dismissed` row is never reopened by a later sighting. A
 *   reminder email about a form you already sent back does not un-send it.
 * - `claimedBy` survives a revision. If one parent has taken it, updated
 *   wording does not hand it back to nobody.
 */
export async function mergeExtracted(
  ctx: MutationCtx,
  input: {
    household: Doc<"households">;
    sourceId: Id<"sources">;
    item: ExtractedItem;
    children: Doc<"children">[];
  },
): Promise<MergeOutcome> {
  const { household, sourceId, item } = input;

  const fingerprint = obligationFingerprint({
    kind: item.kind,
    title: item.title,
    dueDate: item.dueDate,
  });

  const { dueAt, allDay } = resolveDueAt(
    household.timeZone,
    item.dueDate,
    item.dueTime,
  );

  const childIds = matchChildren(item.childNames, input.children);
  const now = Date.now();

  const existing = await ctx.db
    .query("obligations")
    .withIndex("by_household_and_fingerprint", (q) =>
      q.eq("householdId", household._id).eq("fingerprint", fingerprint),
    )
    .unique();

  if (existing === null) {
    const obligationId = await ctx.db.insert("obligations", {
      householdId: household._id,
      title: item.title,
      detail: item.detail,
      kind: item.kind,
      status: "open",
      dueAt,
      dueIsAllDay: allDay,
      childIds,
      amountCents: toCents(item.amountValue),
      currency: item.amountCurrency,
      sourceId,
      quote: item.quote,
      confidence: item.confidence,
      fingerprint,
      updatedAt: now,
    });
    await Activity.record(ctx, {
      householdId: household._id,
      kind: "obligation_created",
      message: item.title,
      obligationId,
    });
    return "created";
  }

  // Settled rows stay settled.
  if (existing.status === "done" || existing.status === "dismissed") {
    return "unchanged";
  }

  // A weaker sighting of something already recorded adds nothing.
  if (item.confidence < existing.confidence && existing.dueAt === dueAt) {
    return "unchanged";
  }

  const changed =
    existing.title !== item.title ||
    existing.detail !== item.detail ||
    existing.dueAt !== dueAt ||
    existing.amountCents !== toCents(item.amountValue) ||
    !sameIds(existing.childIds, childIds);

  if (!changed) return "unchanged";

  await ctx.db.patch(existing._id, {
    title: item.title,
    detail: item.detail,
    dueAt,
    dueIsAllDay: allDay,
    childIds: childIds.length > 0 ? childIds : existing.childIds,
    amountCents: toCents(item.amountValue) ?? existing.amountCents,
    currency: item.amountCurrency ?? existing.currency,
    sourceId,
    quote: item.quote,
    confidence: Math.max(existing.confidence, item.confidence),
    updatedAt: now,
  });

  await Activity.record(ctx, {
    householdId: household._id,
    kind: "obligation_revised",
    message: item.title,
    obligationId: existing._id,
  });
  return "revised";
}

/**
 * Resolve the names the model reported onto real children.
 *
 * Matched case-insensitively on the given name, and an unrecognised name is
 * dropped rather than guessed at: an obligation tagged to nobody shows for the
 * whole household, which is the safe failure. Tagging it to the wrong child is
 * not.
 */
function matchChildren(
  names: string[],
  children: Doc<"children">[],
): Id<"children">[] {
  const byName = new Map(
    children.map((child) => [child.name.trim().toLowerCase(), child._id]),
  );
  const matched = new Set<Id<"children">>();
  for (const name of names) {
    const id = byName.get(name.trim().toLowerCase());
    if (id !== undefined) matched.add(id);
  }
  return [...matched];
}

/** Money is stored in minor units so arithmetic on the board never drifts. */
function toCents(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 100);
}

function sameIds(a: Id<"children">[], b: Id<"children">[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, index) => id === right[index]);
}

/** Everything still asking something of the family, soonest deadline first. */
export async function openBoard(
  ctx: QueryCtx,
  householdId: Id<"households">,
): Promise<Doc<"obligations">[]> {
  const open = await ctx.db
    .query("obligations")
    .withIndex("by_household_and_status", (q) =>
      q.eq("householdId", householdId).eq("status", "open"),
    )
    .collect();

  const claimed = await ctx.db
    .query("obligations")
    .withIndex("by_household_and_status", (q) =>
      q.eq("householdId", householdId).eq("status", "claimed"),
    )
    .collect();

  return [...open, ...claimed].sort(byDueThenCreated);
}

/**
 * Undated items sort after dated ones: a deadline outranks a standing note,
 * and within each group the older sighting comes first.
 */
function byDueThenCreated(a: Doc<"obligations">, b: Doc<"obligations">): number {
  if (a.dueAt !== undefined && b.dueAt !== undefined) {
    return a.dueAt - b.dueAt || a._creationTime - b._creationTime;
  }
  if (a.dueAt !== undefined) return -1;
  if (b.dueAt !== undefined) return 1;
  return a._creationTime - b._creationTime;
}
