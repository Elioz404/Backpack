import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import { recipients, tagOf } from "../lib/agentmail";
import { extractionPool } from "../lib/pools";
import * as Activity from "../model/activity";
import * as Sources from "../model/sources";

/**
 * Mail arriving at a household inbox.
 *
 * Two kinds land here and they are handled differently. A reply on a thread we
 * started is the answer to a question the family asked the school, and it
 * closes that question. Anything else — a newsletter a parent forwarded, a
 * note from a teacher — is a new source to read.
 *
 * Either way the message becomes a source, because an answer from the office
 * ("the trip is now the 14th") is exactly the kind of thing the board should
 * pick up.
 */

/** Narrow AgentMail's untyped payload to the fields this pipeline uses. */
function readMessage(raw: unknown): {
  inboxId: string;
  threadId: string;
  messageId: string;
  subject: string;
  from: string;
  to: string[];
  text: string;
} | null {
  if (typeof raw !== "object" || raw === null) return null;
  const message = raw as Record<string, unknown>;

  const asString = (value: unknown): string =>
    typeof value === "string" ? value : "";

  const inboxId = asString(message.inbox_id);
  const threadId = asString(message.thread_id);
  const messageId = asString(message.message_id);
  if (inboxId === "" || threadId === "" || messageId === "") return null;

  return {
    inboxId,
    threadId,
    messageId,
    // The envelope is what says which household this is for: the recipient
    // carries the `+householdId` tag, and the inbox is shared between them.
    to: recipients(message.to),
    subject: asString(message.subject),
    from: asString(message.from),
    // `text` is the plain-text body; `extracted_text` is what AgentMail
    // recovers from an HTML-only message.
    text: asString(message.text) || asString(message.extracted_text),
  };
}

/**
 * Every verified inbound webhook lands here.
 *
 * Two jobs: refuse a delivery we have already handled, and decide what the
 * message is. Svix retries on any non-2xx and can redeliver regardless, so the
 * event id is recorded first — the content hash further down would catch a
 * duplicate body, but not a duplicate history entry.
 *
 * Hashing the body needs `crypto.subtle`, which a mutation does not have, so
 * the reading itself moves to an action and this stays a routing decision.
 */
export const onMessageReceived = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    message: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("emailEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (seen !== null) return null;

    await ctx.db.insert("emailEvents", {
      eventId: args.eventId,
      eventType: args.eventType,
      receivedAt: Date.now(),
    });

    const message = readMessage(args.message);
    if (message === null || message.text.trim() === "") return null;

    // Deciding whose board a message belongs on, strongest signal first.
    //
    // Order matters more than it looks. Every household shares one inbox, so
    // the bare address names no household at all — matching on it would drop
    // every untagged message onto whichever board happens to hold it, which
    // is one family reading another family's mail.
    const mailbox = await ctx.db.query("mailbox").first();
    const sharedAddress = mailbox?.address ?? null;

    let household = null;

    // 1. The tag on the envelope names the household outright. Accepted only
    //    when that household really claimed this inbox, so a guessed id
    //    cannot put mail on someone else's board.
    for (const address of message.to) {
      const tag = tagOf(address);
      if (tag === undefined) continue;
      const householdId = ctx.db.normalizeId("households", tag);
      if (householdId === null) continue;
      const candidate = await ctx.db.get(householdId);
      if (candidate !== null && candidate.inboxId === message.inboxId) {
        household = candidate;
        break;
      }
    }

    // 2. A reply on a thread this deployment started. Questions go out with
    //    Reply-To set to the household's sub-address, but a mail client is
    //    free to answer the From address instead — and that is the bare
    //    shared inbox. The thread id was minted by our own send, so it
    //    identifies the household as surely as the tag, and unlike an address
    //    it cannot be guessed from outside.
    if (household === null) {
      const question = await ctx.db
        .query("questions")
        .withIndex("by_thread", (q) => q.eq("threadId", message.threadId))
        .unique();
      if (question !== null) household = await ctx.db.get(question.householdId);
    }

    // 3. A household from before the inbox was shared still owns an inbox of
    //    its own, and mail to it is unambiguous. The shared address is
    //    excluded here for the reason above: it belongs to no one household.
    if (household === null) {
      for (const address of message.to) {
        if (address === sharedAddress) continue;
        household = await ctx.db
          .query("households")
          .withIndex("by_inbox_address", (q) => q.eq("inboxAddress", address))
          .first();
        if (household !== null) break;
      }
    }

    // Mail for an inbox this deployment does not own, or addressed to a
    // household that does not exist.
    if (household === null) return null;

    await ctx.scheduler.runAfter(0, internal.pipelines.mailIngest.ingestMessage, {
      householdId: household._id,
      threadId: message.threadId,
      messageId: message.messageId,
      subject: message.subject,
      from: message.from,
      body: message.text,
    });
    return null;
  },
});

export const ingestMessage = internalAction({
  args: {
    householdId: v.id("households"),
    threadId: v.string(),
    messageId: v.string(),
    subject: v.string(),
    from: v.string(),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { text, hash } = await Sources.prepare(args.body);
    await ctx.runMutation(internal.pipelines.mailIngest.recordMessage, {
      householdId: args.householdId,
      threadId: args.threadId,
      messageId: args.messageId,
      subject: args.subject,
      from: args.from,
      text,
      hash,
    });
    return null;
  },
});

export const recordMessage = internalMutation({
  args: {
    householdId: v.id("households"),
    threadId: v.string(),
    messageId: v.string(),
    subject: v.string(),
    from: v.string(),
    text: v.string(),
    hash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const title = args.subject === "" ? `Message from ${args.from}` : args.subject;

    const result = await Sources.ingest(ctx, {
      householdId: args.householdId,
      kind: "email",
      title,
      threadId: args.threadId,
      messageId: args.messageId,
      fromAddress: args.from,
      text: args.text,
      hash: args.hash,
    });

    if (result.status !== "ingested") return null;

    // A reply on a thread we opened closes the question that opened it.
    const question = await ctx.db
      .query("questions")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (
      question !== null &&
      question.householdId === args.householdId &&
      question.status !== "answered"
    ) {
      await ctx.db.patch(question._id, {
        status: "answered",
        answeredAt: Date.now(),
        answerSourceId: result.sourceId,
      });
      await Activity.record(ctx, {
        householdId: args.householdId,
        kind: "question_answered",
        message: `The school answered: ${title}`,
        obligationId: question.obligationId,
      });
    } else {
      await Activity.record(ctx, {
        householdId: args.householdId,
        kind: "source_ingested",
        message: `New mail: ${title}`,
      });
    }

    await extractionPool.enqueueAction(
      ctx,
      internal.pipelines.extract.extractSource,
      { sourceId: result.sourceId },
    );
    return null;
  },
});
