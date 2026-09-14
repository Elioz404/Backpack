import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { obligationFingerprint } from "../lib/text";
import { resolveDueAt } from "../lib/time";

/**
 * A worked example, written into a household that asks for one.
 *
 * Why this exists at all: a new board is empty, and the honest ways to fill it
 * — crawl a school site, forward it some mail — take minutes and spend a
 * quota. Someone evaluating Backpack should be able to hold the real thing,
 * with its own address and its own controls, within a few seconds of signing
 * up. The public `/demo` board cannot do that job: it is read-only by
 * necessity, so it can show the output but never the part that matters, which
 * is two people moving the same list.
 *
 * The content is openly invented and says so on every card's source. It is
 * seeded into the caller's *own* household, so nothing here is shared and
 * nobody can change what anyone else sees.
 */

type Sample = {
  title: string;
  detail?: string;
  kind: Doc<"obligations">["kind"];
  /** Days from today. Negative is already past due. */
  inDays: number | null;
  time?: string;
  child?: "Mateo" | "Lila";
  amount?: number;
  quote: string;
  source: "newsletter" | "calendar" | "email";
  confidence: number;
};

const SAMPLES: Sample[] = [
  {
    title: "Return the swimming consent form",
    detail: "Term 3 lessons start the week after.",
    kind: "form",
    inDays: -2,
    child: "Mateo",
    quote:
      "Signed consent forms for Term 3 swimming must be returned to the school office by Friday 11 September.",
    source: "newsletter",
    confidence: 0.94,
  },
  {
    title: "Pay for the museum trip",
    kind: "money",
    inDays: 1,
    child: "Lila",
    amount: 1450,
    quote:
      "The cost of the Year 4 visit to the Natural History Museum is $14.50 per child, payable through the school portal by 15 September.",
    source: "newsletter",
    confidence: 0.97,
  },
  {
    title: "Send a labelled water bottle every day",
    kind: "supply",
    inDays: 1,
    quote:
      "From Monday, all children need a named water bottle in school every day. The fountains in the west corridor are out of service.",
    source: "newsletter",
    confidence: 0.82,
  },
  {
    title: "No school — staff development day",
    kind: "schedule",
    inDays: 3,
    quote:
      "Thursday 17 September is a staff development day. School is closed to pupils.",
    source: "calendar",
    confidence: 0.99,
  },
  {
    title: "Come to the Year 6 parents evening",
    kind: "event",
    inDays: 5,
    time: "18:30",
    child: "Mateo",
    quote:
      "Year 6 parents evening will be held in the main hall on Tuesday 22 September, from 6.30pm.",
    source: "calendar",
    confidence: 0.96,
  },
  {
    title: "Bring a shoebox for the harvest collection",
    kind: "supply",
    inDays: 9,
    quote:
      "Please send in a shoebox, wrapped and filled, for the harvest collection before the end of the month.",
    source: "email",
    confidence: 0.71,
  },
  {
    title: "Order the school photograph",
    detail: "Proofs came home in book bags this week.",
    kind: "money",
    inDays: 14,
    amount: 2200,
    quote:
      "Photograph orders close on 1 October. Packages start at $22.00 and can be ordered using the code on the proof sheet.",
    source: "email",
    confidence: 0.88,
  },
  {
    title: "Pick up at 1.30pm on the last day of term",
    kind: "schedule",
    inDays: 30,
    time: "13:30",
    quote:
      "Term ends on Friday 16 October with an early finish; all pupils should be collected at 1.30pm.",
    source: "calendar",
    confidence: 0.93,
  },
  {
    title: "New drop-off gate from next half term",
    kind: "info",
    inDays: null,
    quote:
      "After half term, morning drop-off moves to the Oak Lane gate while the main entrance is resurfaced.",
    source: "newsletter",
    confidence: 0.9,
  },
];

const SOURCES = {
  newsletter: {
    kind: "page" as const,
    title: "Parent newsletter — an example, not a real school",
    url: "https://example-primary.test/newsletters/september",
  },
  calendar: {
    kind: "page" as const,
    title: "Term dates — an example, not a real school",
    url: "https://example-primary.test/calendar",
  },
  email: {
    kind: "email" as const,
    title: "From the school office — an example, not a real school",
    from: "office@example-primary.test",
  },
};

/**
 * Where a trial board's questions to "the school office" are sent.
 *
 * One of this deployment's own inboxes, so that pressing Ask the school
 * genuinely composes a message, genuinely sends it, and genuinely arrives —
 * rather than being written by the model and then bounced off a domain that
 * does not exist.
 */
const EXAMPLE_OFFICE_ADDRESS = "jealouscard638@agentmail.to";

export type FillResult = { obligations: number; children: number };

/**
 * Idempotent: children are keyed by name, sources by a fixed hash and
 * obligations by the same fingerprint the extractor produces, so asking twice
 * leaves one board rather than two.
 */
export async function fill(
  ctx: MutationCtx,
  household: Doc<"households">,
): Promise<FillResult> {
  const householdId = household._id;
  const now = Date.now();

  const existingChildren = await ctx.db
    .query("children")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .collect();

  const childIdByName = new Map(
    existingChildren.map((child) => [child.name, child._id]),
  );

  for (const [index, name] of ["Mateo", "Lila"].entries()) {
    if (childIdByName.has(name)) continue;
    const id = await ctx.db.insert("children", {
      householdId,
      name,
      grade: index === 0 ? "Year 6" : "Year 4",
      colorKey: index === 0 ? "sky" : "amber",
    });
    childIdByName.set(name, id);
  }

  const schools = await ctx.db
    .query("schools")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .collect();

  if (schools.length === 0) {
    await ctx.db.insert("schools", {
      householdId,
      // A real, public, crawlable school site, and an address that really
      // receives. The seeded cards below are written rather than extracted —
      // they exist so a new board has something on it in under a second — but
      // the two controls that spend a sponsor's API must do real work when
      // pressed. Pointing them at `example-primary.test`, a reserved TLD that
      // cannot resolve, meant the first thing anyone tried failed: the crawl
      // against nothing, and the question composed by the model and then
      // bounced.
      //
      // The families section, not a deep page: Firecrawl refuses to leave the
      // path a crawl starts at, and refuses by failing the whole run rather
      // than skipping the link — so a deep URL dies on its first link back to
      // "/", which every page has. A section root is the shape that survives.
      name: "Boston Public Schools — families",
      siteUrl: "https://www.bostonpublicschools.org/students-families",
      officeEmail: EXAMPLE_OFFICE_ADDRESS,
      // Twelve, not fifteen. Every page is one OpenAI request against a
      // daily cap of fifty, and this is the button a first-time visitor
      // presses — it should finish while they are still watching, and leave
      // the day's allowance for the person after them. Twelve rather than
      // eight because a section root spends its first few pages on
      // navigation before it reaches anything with a date on it.
      crawlLimit: 12,
    });
  }

  const sourceIds = new Map<string, Id<"sources">>();
  for (const [key, spec] of Object.entries(SOURCES)) {
    const hash = `example-${key}`;
    const seen = await ctx.db
      .query("sources")
      .withIndex("by_household_and_hash", (q) =>
        q.eq("householdId", householdId).eq("contentHash", hash),
      )
      .unique();

    if (seen !== null) {
      sourceIds.set(key, seen._id);
      continue;
    }

    const id = await ctx.db.insert("sources", {
      householdId,
      kind: spec.kind,
      title: spec.title,
      url: "url" in spec ? spec.url : undefined,
      fromAddress: "from" in spec ? spec.from : undefined,
      contentHash: hash,
      text: SAMPLES.filter((sample) => sample.source === key)
        .map((sample) => sample.quote)
        .join("\n\n"),
      capturedAt: now - 36 * 60 * 60 * 1000,
      extraction: "done",
    });
    sourceIds.set(key, id);
  }

  let written = 0;
  for (const sample of SAMPLES) {
    const dueDate =
      sample.inDays === null
        ? undefined
        : new Date(now + sample.inDays * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);

    const { dueAt, allDay } = resolveDueAt(
      household.timeZone,
      dueDate,
      sample.time,
    );

    const fingerprint = obligationFingerprint({
      kind: sample.kind,
      title: sample.title,
      dueDate,
    });

    const existing = await ctx.db
      .query("obligations")
      .withIndex("by_household_and_fingerprint", (q) =>
        q.eq("householdId", householdId).eq("fingerprint", fingerprint),
      )
      .unique();
    if (existing !== null) continue;

    const childId =
      sample.child === undefined ? undefined : childIdByName.get(sample.child);

    await ctx.db.insert("obligations", {
      householdId,
      title: sample.title,
      detail: sample.detail,
      kind: sample.kind,
      status: "open",
      dueAt,
      dueIsAllDay: allDay,
      childIds: childId === undefined ? [] : [childId],
      amountCents: sample.amount,
      currency: sample.amount === undefined ? undefined : "USD",
      sourceId: sourceIds.get(sample.source)!,
      quote: sample.quote,
      confidence: sample.confidence,
      fingerprint,
      updatedAt: now,
    });
    written += 1;
  }

  return { obligations: written, children: childIdByName.size };
}
