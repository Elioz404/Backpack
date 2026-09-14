import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { obligationFingerprint } from "./lib/text";
import { resolveDueAt } from "./lib/time";

/**
 * A worked example, for a demo or a fresh deployment.
 *
 * Internal on purpose: there is no path to this from the browser, only
 * `npx convex run seed:demo '{"householdId":"..."}'`. The content is openly
 * fictional — an invented school, invented children — because seeding a board
 * with data that looks real is how a demo ends up lying.
 *
 * Idempotent: it keys the obligations on the same fingerprint the extractor
 * would produce, so running it twice leaves one board, not two.
 */

type Sample = {
  title: string;
  detail?: string;
  kind: "form" | "money" | "supply" | "schedule" | "event" | "info";
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
    title: "Parent newsletter — September",
    url: "https://example-primary.test/newsletters/september",
  },
  calendar: {
    kind: "page" as const,
    title: "Term dates and calendar",
    url: "https://example-primary.test/calendar",
  },
  email: {
    kind: "email" as const,
    title: "From the school office",
    from: "office@example-primary.test",
  },
};

export const demo = internalMutation({
  args: { householdId: v.string() },
  returns: v.object({ obligations: v.number(), children: v.number() }),
  handler: async (ctx, args) => {
    const householdId = ctx.db.normalizeId("households", args.householdId);
    if (householdId === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "household" });
    }
    const household = await ctx.db.get(householdId);
    if (household === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "household" });
    }

    const now = Date.now();

    // Children, keyed by name so a second run reuses them.
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

    if (
      (
        await ctx.db
          .query("schools")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect()
      ).length === 0
    ) {
      await ctx.db.insert("schools", {
        householdId,
        name: "Example Primary",
        siteUrl: "https://example-primary.test/",
        officeEmail: "office@example-primary.test",
        crawlLimit: 40,
      });
    }

    // One source row per distinct sample source.
    const sourceIds = new Map<string, Id<"sources">>();
    for (const [key, spec] of Object.entries(SOURCES)) {
      const hash = `demo-${key}`;
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
  },
});

/**
 * Forget a source and everything it produced.
 *
 * A page or message can turn out to be one the household never wanted read —
 * a test, a misdirected mail, a page that was crawled by mistake. Removing the
 * source alone would leave its obligations pointing at nothing and its lines
 * in the history, so this takes all three together.
 *
 * Internal, like `demo`: there is no path to it from the browser.
 */
export const forgetSource = internalMutation({
  args: { sourceId: v.id("sources") },
  returns: v.object({ obligations: v.number(), activity: v.number() }),
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (source === null) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "source" });
    }

    const obligations = await ctx.db
      .query("obligations")
      .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
      .collect();

    const removedIds = new Set(obligations.map((row) => row._id));
    for (const row of obligations) await ctx.db.delete(row._id);

    // History that names a removed obligation, plus the "new mail" line the
    // source itself wrote, which is matched by title because activity rows do
    // not carry a source id.
    const history = await ctx.db
      .query("activity")
      .withIndex("by_household", (q) => q.eq("householdId", source.householdId))
      .collect();

    let activityRemoved = 0;
    for (const entry of history) {
      const namesRemoved =
        entry.obligationId !== undefined && removedIds.has(entry.obligationId);
      const namesSource = entry.message.includes(source.title);
      if (namesRemoved || namesSource) {
        await ctx.db.delete(entry._id);
        activityRemoved += 1;
      }
    }

    await ctx.db.delete(args.sourceId);
    return { obligations: obligations.length, activity: activityRemoved };
  },
});
