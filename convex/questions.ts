import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { agentmail } from "./lib/agentmail";
import { rateLimiter } from "./lib/limits";
import { composeQuestion } from "./lib/openai/compose";
import * as Activity from "./model/activity";
import { requireMembership } from "./model/households";
import { vQuestionStatus } from "./schema";

/**
 * Asking the school.
 *
 * The last mile of the board: when a notice does not say enough, the family
 * asks, from their own household address, and the answer comes back into the
 * same inbox — where it is read like any other source, so an answer that
 * changes a date changes the card too.
 */

export const list = query({
  args: { householdId: v.id("households") },
  returns: v.array(
    v.object({
      _id: v.id("questions"),
      subject: v.string(),
      body: v.string(),
      toAddress: v.string(),
      status: vQuestionStatus,
      sentAt: v.union(v.number(), v.null()),
      answeredAt: v.union(v.number(), v.null()),
      obligationId: v.union(v.id("obligations"), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    const questions = await ctx.db
      .query("questions")
      .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
      .order("desc")
      .take(25);

    return await Promise.all(
      questions.map(async (question) => ({
        _id: question._id,
        subject: question.subject,
        body: question.body,
        toAddress: question.toAddress,
        // Delivery state lives in the component and changes after this row is
        // written. Reading it here rather than copying it across on a cron
        // keeps the UI honest: the query re-runs when the component's row
        // moves, so "sending" becomes "sent" or "bounced" on its own.
        status: await liveStatus(ctx, question),
        sentAt: question.sentAt ?? null,
        answeredAt: question.answeredAt ?? null,
        obligationId: question.obligationId ?? null,
      })),
    );
  },
});

/**
 * Overlay the component's delivery state onto a question row.
 *
 * An answered question stays answered — a reply is the terminal state this
 * product cares about, and it outranks whatever the send pipeline last said.
 */
async function liveStatus(
  ctx: { runQuery: QueryCtx["runQuery"] },
  question: Doc<"questions">,
): Promise<Doc<"questions">["status"]> {
  if (question.status === "answered" || question.outboundId === undefined) {
    return question.status;
  }
  const delivery = await agentmail.status(ctx, question.outboundId);
  if (delivery === null) return question.status;

  switch (delivery.status) {
    case "sent":
    case "delivered":
      return "sent";
    case "bounced":
    case "complained":
    case "rejected":
    case "failed":
      return "failed";
    default:
      return "sending";
  }
}

/**
 * Gather everything the draft needs, and prove the family may send it, before
 * a single token is spent on writing it.
 */
export const prepare = internalQuery({
  args: {
    householdId: v.id("households"),
    obligationId: v.optional(v.id("obligations")),
  },
  returns: v.object({
    householdName: v.string(),
    askedBy: v.string(),
    askedById: v.id("users"),
    inboxId: v.union(v.string(), v.null()),
    officeEmail: v.union(v.string(), v.null()),
    context: v.union(
      v.null(),
      v.object({
        title: v.string(),
        quote: v.string(),
        sourceTitle: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { household, userId } = await requireMembership(
      ctx,
      args.householdId,
    );
    const user = await ctx.db.get(userId);

    // The office address lives on the school; the first one that has set it is
    // the one a general question goes to.
    const schools = await ctx.db
      .query("schools")
      .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
      .collect();
    const officeEmail =
      schools.find((school) => school.officeEmail !== undefined)?.officeEmail ??
      null;

    let context = null;
    if (args.obligationId !== undefined) {
      const obligation = await ctx.db.get(args.obligationId);
      if (obligation === null || obligation.householdId !== args.householdId) {
        throw new ConvexError({ code: "NOT_FOUND", entity: "obligation" });
      }
      const source = await ctx.db.get(obligation.sourceId);
      context = {
        title: obligation.title,
        quote: obligation.quote,
        sourceTitle: source?.title ?? "a school notice",
      };
    }

    return {
      householdName: household.name,
      askedBy: user?.displayName ?? "A parent",
      askedById: userId,
      inboxId: household.inboxId ?? null,
      officeEmail,
      context,
    };
  },
});

/**
 * Record and enqueue the send, in one transaction.
 *
 * `sendMessage` enqueues from a mutation — the component's own workpool does
 * the talking to AgentMail, with retries — so a question row and its outbound
 * message are committed together or not at all.
 */
export const send = internalMutation({
  args: {
    householdId: v.id("households"),
    obligationId: v.optional(v.id("obligations")),
    askedById: v.id("users"),
    inboxId: v.string(),
    toAddress: v.string(),
    subject: v.string(),
    body: v.string(),
  },
  returns: v.id("questions"),
  handler: async (ctx, args) => {
    await rateLimiter.limit(ctx, "askSchool", {
      key: args.householdId,
      throws: true,
    });

    const outboundId = await agentmail.sendMessage(ctx, args.inboxId, {
      to: args.toAddress,
      subject: args.subject,
      text: args.body,
      // Labelled so the thread is identifiable in the AgentMail inbox itself,
      // not only through this app.
      labels: ["backpack", "school-question"],
    });

    const questionId = await ctx.db.insert("questions", {
      householdId: args.householdId,
      obligationId: args.obligationId,
      askedBy: args.askedById,
      toAddress: args.toAddress,
      subject: args.subject,
      body: args.body,
      status: "sending",
      outboundId,
      sentAt: Date.now(),
    });

    await Activity.record(ctx, {
      householdId: args.householdId,
      kind: "question_sent",
      message: `Asked the school: ${args.subject}`,
      actorId: args.askedById,
      obligationId: args.obligationId,
    });

    return questionId;
  },
});

/**
 * Draft a question and send it.
 *
 * The address is taken from the school record rather than from the caller, so
 * this endpoint cannot be used to mail an arbitrary recipient.
 */
export const ask = action({
  args: {
    householdId: v.id("households"),
    obligationId: v.optional(v.id("obligations")),
    question: v.string(),
  },
  returns: v.object({ questionId: v.id("questions"), subject: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ questionId: Id<"questions">; subject: string }> => {
    const question = args.question.trim();
    if (question === "") {
      throw new ConvexError({ code: "INVALID", field: "question" });
    }

    const prepared = await ctx.runQuery(internal.questions.prepare, {
      householdId: args.householdId,
      obligationId: args.obligationId,
    });

    if (prepared.inboxId === null) {
      throw new ConvexError({
        code: "NO_INBOX",
        message: "This household has no address yet.",
      });
    }
    if (prepared.officeEmail === null) {
      throw new ConvexError({
        code: "NO_OFFICE_EMAIL",
        message: "Add the school office address before asking a question.",
      });
    }

    const draft = await composeQuestion({
      householdName: prepared.householdName,
      askedBy: prepared.askedBy,
      question,
      context: prepared.context ?? undefined,
    });

    const questionId = await ctx.runMutation(internal.questions.send, {
      householdId: args.householdId,
      obligationId: args.obligationId,
      askedById: prepared.askedById,
      inboxId: prepared.inboxId,
      toAddress: prepared.officeEmail,
      subject: draft.subject,
      body: draft.body,
    });

    return { questionId, subject: draft.subject };
  },
});
