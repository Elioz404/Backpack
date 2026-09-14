import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { AgentMailError, sendMessage } from "./lib/agentmail";
import { rateLimiter } from "./lib/limits";
import { openAiConfig } from "./lib/config";
import { composeQuestion } from "./lib/openai/compose";
import * as Activity from "./model/activity";
import * as Budget from "./model/budget";
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
      error: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    const questions = await ctx.db
      .query("questions")
      .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
      .order("desc")
      .take(25);

    return questions.map((question) => ({
      _id: question._id,
      subject: question.subject,
      body: question.body,
      toAddress: question.toAddress,
      status: question.status,
      sentAt: question.sentAt ?? null,
      answeredAt: question.answeredAt ?? null,
      obligationId: question.obligationId ?? null,
      error: question.error ?? null,
    }));
  },
});

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
    inboxAddress: v.union(v.string(), v.null()),
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
      inboxAddress: household.inboxAddress ?? null,
      officeEmail,
      context,
    };
  },
});

/**
 * Claim the allowance and record the intent, before the message goes out.
 *
 * The rate limit is checked in the same transaction as the insert, so a
 * household that is out of allowance never gets a row — and a row never exists
 * without having been paid for.
 */
export const record = internalMutation({
  args: {
    householdId: v.id("households"),
    obligationId: v.optional(v.id("obligations")),
    askedById: v.id("users"),
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

    return await ctx.db.insert("questions", {
      householdId: args.householdId,
      obligationId: args.obligationId,
      askedBy: args.askedById,
      toAddress: args.toAddress,
      subject: args.subject,
      body: args.body,
      status: "sending",
    });
  },
});

export const mayAsk = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => await Budget.maySpend(ctx),
});

export const recordSpend = internalMutation({
  args: { inputTokens: v.number(), outputTokens: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await Budget.record(ctx, openAiConfig().model, {
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
    });
    return null;
  },
});

export const markSent = internalMutation({
  args: {
    questionId: v.id("questions"),
    messageId: v.string(),
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const question = await ctx.db.get(args.questionId);
    if (question === null) return null;

    await ctx.db.patch(args.questionId, {
      status: "sent",
      messageId: args.messageId,
      threadId: args.threadId,
      sentAt: Date.now(),
    });

    await Activity.record(ctx, {
      householdId: question.householdId,
      kind: "question_sent",
      message: `Asked the school: ${question.subject}`,
      actorId: question.askedBy,
      obligationId: question.obligationId,
    });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { questionId: v.id("questions"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.questionId, {
      status: "failed",
      error: args.error,
    });
    return null;
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

    if (!(await ctx.runQuery(internal.questions.mayAsk, {}))) {
      throw new ConvexError({
        code: "BUDGET_REACHED",
        message:
          "This deployment has reached its OpenAI budget, so it cannot write " +
          "the message.",
      });
    }

    const draft = await composeQuestion({
      householdName: prepared.householdName,
      askedBy: prepared.askedBy,
      question,
      context: prepared.context ?? undefined,
    });

    await ctx.runMutation(internal.questions.recordSpend, {
      inputTokens: draft.usage.inputTokens,
      outputTokens: draft.usage.outputTokens,
    });

    const questionId = await ctx.runMutation(internal.questions.record, {
      householdId: args.householdId,
      obligationId: args.obligationId,
      askedById: prepared.askedById,
      toAddress: prepared.officeEmail,
      subject: draft.subject,
      body: draft.body,
    });

    try {
      const sent = await sendMessage(prepared.inboxId, {
        to: prepared.officeEmail,
        subject: draft.subject,
        text: draft.body,
        // The inbox is shared, so the message goes out as the bare address
        // and an answer to it would come back with nothing to route on.
        // Reply-To is the household's own sub-address, which is what puts the
        // school's answer on the board that asked the question.
        replyTo: prepared.inboxAddress ?? undefined,
        // Labelled so the thread is identifiable in the AgentMail inbox
        // itself, not only through this app.
        labels: ["backpack", "school-question"],
      });

      await ctx.runMutation(internal.questions.markSent, {
        questionId,
        messageId: sent.message_id,
        threadId: sent.thread_id,
      });
    } catch (error) {
      const message =
        error instanceof AgentMailError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      // Recorded on the row rather than only thrown, so the family can see
      // which question did not go out and why.
      await ctx.runMutation(internal.questions.markFailed, {
        questionId,
        error: message,
      });
      throw new ConvexError({ code: "SEND_FAILED", message });
    }

    return { questionId, subject: draft.subject };
  },
});
