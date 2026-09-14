import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * What a line on the board asks of the family. The kind drives how it is
 * grouped and what the card offers to do about it, so it is a closed set
 * rather than a free-text label the model can invent.
 */
export const vObligationKind = v.union(
  v.literal("form"), // something to sign and send back
  v.literal("money"), // something to pay
  v.literal("supply"), // something to bring or buy
  v.literal("schedule"), // a day that changes: no school, early dismissal
  v.literal("event"), // somewhere to be
  v.literal("info"), // worth knowing, nothing to do
);

export const vObligationStatus = v.union(
  v.literal("open"),
  v.literal("claimed"),
  v.literal("done"),
  v.literal("dismissed"),
);

/** Where a fact came from. Every obligation points at exactly one. */
export const vSourceKind = v.union(
  v.literal("page"), // a page from a Firecrawl crawl of the school site
  v.literal("email"), // a message forwarded into the household inbox
);

/**
 * Deliberately without an in-flight state. The extraction pool already owns
 * what is running; stamping it on the row as well means a job the pool drops
 * leaves the source stranded in a state nothing reports and nothing retries —
 * which is how a board ends up quietly missing a term of notices. A source is
 * unread until it is `done` or `failed`, both terminal.
 */
export const vExtractionState = v.union(
  v.literal("pending"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("skipped"), // content we had already read, byte for byte
);

export const vCrawlStatus = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const vQuestionStatus = v.union(
  v.literal("sending"),
  v.literal("sent"),
  v.literal("answered"),
  v.literal("failed"),
);

export const vActivityKind = v.union(
  v.literal("crawl_started"),
  v.literal("crawl_finished"),
  v.literal("source_ingested"),
  v.literal("obligation_created"),
  v.literal("obligation_revised"),
  v.literal("obligation_claimed"),
  v.literal("obligation_released"),
  v.literal("obligation_done"),
  v.literal("obligation_dismissed"),
  v.literal("question_sent"),
  v.literal("question_answered"),
);

export default defineSchema({
  /**
   * App-side user record. Convex Auth owns credentials and sessions in its own
   * component; this table holds only what the product needs to show.
   */
  users: defineTable({
    displayName: v.string(),
    email: v.optional(v.string()),
    /**
     * True for a visitor who has not signed up.
     *
     * The interface has to know: a trial session lives in one browser, has no
     * username for anyone to add it by, and cannot be signed back into — so
     * the one thing it must offer is a way out of being temporary, and the
     * one thing it must not offer casually is "sign out".
     */
    anonymous: v.optional(v.boolean()),
  }),

  /**
   * A family. The tenant boundary: every other row carries `householdId` and
   * every read is gated on membership.
   */
  households: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
    /** IANA zone. School deadlines are local dates, so this is not optional. */
    timeZone: v.string(),
    /**
     * Where this household's mail arrives.
     *
     * `inboxId` is the AgentMail inbox, which households share: the address is
     * a sub-address of it, `<inbox>+<householdId>@`, so one metered inbox
     * serves any number of families. Households created before that carry
     * an inbox of their own and are still routed by `by_inbox`.
     */
    inboxId: v.optional(v.string()),
    inboxAddress: v.optional(v.string()),
  })
    .index("by_creator", ["createdBy"])
    // Inbound mail is routed on the address it was sent to, which identifies
    // the household whether or not that address carries a tag.
    .index("by_inbox_address", ["inboxAddress"]),

  memberships: defineTable({
    householdId: v.id("households"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("parent")),
    joinedAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_user", ["userId"])
    .index("by_user_and_household", ["userId", "householdId"]),

  /**
   * A one-use ticket that carries a trial household onto a real account.
   *
   * A visitor who tries Backpack without signing up gets a genuine household:
   * a school, an address, children, a board they have put work into. Signing
   * up afterwards mints a brand new user, so without this that work is
   * stranded — the new account is empty and the anonymous one has no
   * credentials to go back in with. Which is the exact path someone takes
   * when they have decided they like it.
   *
   * The ticket is minted by the household's owner while they are still signed
   * in as the visitor, and redeemed by whoever they become. Both halves are
   * authenticated as the right party at the right moment, so no one can claim
   * a household that was never theirs, and a code that leaks is useless: it
   * is single use and short lived.
   */
  trialClaims: defineTable({
    householdId: v.id("households"),
    code: v.string(),
    mintedBy: v.id("users"),
    expiresAt: v.number(),
    redeemedAt: v.optional(v.number()),
    redeemedBy: v.optional(v.id("users")),
  })
    .index("by_code", ["code"])
    .index("by_household", ["householdId"]),

  children: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    grade: v.optional(v.string()),
    /** Stable per-child accent so the board is scannable at a glance. */
    colorKey: v.string(),
  }).index("by_household", ["householdId"]),

  schools: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    siteUrl: v.string(),
    /** Office address questions are sent to, once we know it. */
    officeEmail: v.optional(v.string()),
    /** Crawl shape, per school - never a constant buried in the pipeline. */
    crawlLimit: v.number(),
    includePaths: v.optional(v.array(v.string())),
    excludePaths: v.optional(v.array(v.string())),
  }).index("by_household", ["householdId"]),

  /**
   * App-side record of one Firecrawl crawl. The component owns the pages and
   * the live progress; this row is what ties a crawl to a school and a user,
   * and what the board subscribes to.
   */
  crawlRuns: defineTable({
    householdId: v.id("households"),
    schoolId: v.id("schools"),
    /**
     * Absent for the moment between the run row being created and Firecrawl
     * returning an id. The completion callback resolves the run through its
     * own `context` passthrough instead, so that window is never a race.
     */
    crawlId: v.optional(v.string()),
    jobId: v.optional(v.string()),
    status: vCrawlStatus,
    startedBy: v.id("users"),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    pageCount: v.optional(v.number()),
    /** Pages the component could not store, reported rather than swallowed. */
    unstoredCount: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_household", ["householdId"])
    .index("by_crawl_id", ["crawlId"])
    .index("by_school", ["schoolId"]),

  /**
   * One ingested artifact, normalised. Provenance lives here so an obligation
   * never has to carry a copy of where it came from.
   */
  sources: defineTable({
    householdId: v.id("households"),
    kind: vSourceKind,
    title: v.string(),
    /** Page sources. */
    url: v.optional(v.string()),
    crawlRunId: v.optional(v.id("crawlRuns")),
    /** Email sources. */
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    fromAddress: v.optional(v.string()),
    /** SHA-256 of the normalised text: the same content is never read twice. */
    contentHash: v.string(),
    text: v.string(),
    capturedAt: v.number(),
    extraction: vExtractionState,
    extractionError: v.optional(v.string()),
  })
    .index("by_household", ["householdId"])
    .index("by_household_and_hash", ["householdId", "contentHash"])
    .index("by_household_and_extraction", ["householdId", "extraction"])
    .index("by_thread", ["threadId"])
    .index("by_crawl_run", ["crawlRunId"]),

  /**
   * The board. One row is one thing the family has to do, with the sentence
   * from the source that says so.
   */
  obligations: defineTable({
    householdId: v.id("households"),
    title: v.string(),
    detail: v.optional(v.string()),
    kind: vObligationKind,
    status: vObligationStatus,
    /** Local-date deadline as an instant, resolved in the household zone. */
    dueAt: v.optional(v.number()),
    dueIsAllDay: v.boolean(),
    childIds: v.array(v.id("children")),
    amountCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    /** Provenance: the source, and the sentence in it that supports this row. */
    sourceId: v.id("sources"),
    quote: v.string(),
    confidence: v.number(),
    /**
     * Deterministic identity for the same real-world obligation announced more
     * than once (site page, then a reminder email). Re-extraction revises the
     * existing row instead of adding a duplicate.
     */
    fingerprint: v.string(),
    claimedBy: v.optional(v.id("users")),
    claimedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_household_and_status", ["householdId", "status"])
    .index("by_household_and_due", ["householdId", "dueAt"])
    .index("by_household_and_fingerprint", ["householdId", "fingerprint"])
    .index("by_source", ["sourceId"]),

  /** A question sent to the school office, and the reply that closed it. */
  questions: defineTable({
    householdId: v.id("households"),
    obligationId: v.optional(v.id("obligations")),
    askedBy: v.id("users"),
    toAddress: v.string(),
    subject: v.string(),
    body: v.string(),
    status: vQuestionStatus,
    /** AgentMail's id for the sent message, once the API has accepted it. */
    messageId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    answeredAt: v.optional(v.number()),
    answerSourceId: v.optional(v.id("sources")),
    error: v.optional(v.string()),
  })
    .index("by_household", ["householdId"])
    .index("by_thread", ["threadId"])
    .index("by_obligation", ["obligationId"]),

  /**
   * The one AgentMail inbox this deployment owns.
   *
   * A single row. Households are sub-addresses of it rather than inboxes of
   * their own, because inboxes are metered — the free tier allows three in
   * total — while sub-addresses are not, and a household is not a mailbox in
   * any case. It is created the first time a household asks for an address.
   */
  mailbox: defineTable({
    inboxId: v.string(),
    address: v.string(),
    createdAt: v.number(),
  }),

  /**
   * Webhook deliveries already handled, by AgentMail's event id.
   *
   * Svix retries on any non-2xx and can deliver the same event more than once
   * regardless, so ingestion is made idempotent here rather than relying on
   * the content hash alone — two deliveries of one message must not produce
   * two history entries.
   */
  emailEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    receivedAt: v.number(),
  }).index("by_event_id", ["eventId"]),

  /**
   * What this deployment has spent at OpenAI, as one running total.
   *
   * The operator pays for every extraction on their own key and the pipeline
   * runs unattended on a cron, so the spend is metered against a ceiling and
   * refused past it. Accounted in micro-cents as integers, because repeatedly
   * adding fractions of a cent as floats drifts.
   */
  apiSpend: defineTable({
    inputTokens: v.number(),
    outputTokens: v.number(),
    microCents: v.number(),
    calls: v.number(),
    since: v.number(),
  }),

  /** Household-visible history. Also what makes the board feel alive. */
  activity: defineTable({
    householdId: v.id("households"),
    kind: vActivityKind,
    message: v.string(),
    actorId: v.optional(v.id("users")),
    obligationId: v.optional(v.id("obligations")),
  }).index("by_household", ["householdId"]),
});
