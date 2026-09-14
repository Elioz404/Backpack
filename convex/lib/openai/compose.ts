import { respondJson, type Usage } from "./client";

/**
 * Writing to the school office.
 *
 * The family types the thing they actually want to know ("is the trip still
 * on?"); this turns it into a message an office will answer — short, specific,
 * quoting the notice it is about so whoever reads it does not have to guess
 * which of forty families this is.
 *
 * Deliberately conservative: it may only ask. It never commits the family to
 * anything, never gives a reason on their behalf, and never invents a detail
 * that was not in the question or the notice.
 */

export type ComposeInput = {
  householdName: string;
  askedBy: string;
  question: string;
  /** The board item this is about, when it is about one. */
  context:
    | { title: string; quote: string; sourceTitle: string }
    | undefined;
};

export type ComposedEmail = {
  subject: string;
  body: string;
  usage: Usage;
};

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: {
      type: "string",
      description:
        "A specific subject line naming what this is about. No greeting, under 80 characters.",
    },
    body: {
      type: "string",
      description:
        "The whole message as plain text, including a greeting and a sign-off. Three short paragraphs at most.",
    },
  },
} as const;

const SYSTEM_PROMPT = [
  "You write a single short email from a parent to their child's school office.",
  "",
  "Rules:",
  "- Ask only what the parent asked. Never add a second question.",
  "- Never commit the family to anything, decline anything, or give a reason on their behalf.",
  "- Never state a fact that is not in the parent's question or the quoted notice.",
  "- When a notice is quoted, refer to it so the office knows which one, but do not paste it in full.",
  "- Plain, warm, brief. No marketing tone, no filler, no bullet points.",
  "- Sign off with the parent's name as given, nothing invented.",
].join("\n");

export async function composeQuestion(
  input: ComposeInput,
): Promise<ComposedEmail> {
  const context =
    input.context === undefined
      ? "The parent did not tie this to a specific notice."
      : [
          `It is about this item on their board: ${input.context.title}`,
          `Which came from: ${input.context.sourceTitle}`,
          `The notice said, verbatim: "${input.context.quote}"`,
        ].join("\n");

  const { value: payload, usage } = await respondJson({
    system: SYSTEM_PROMPT,
    user: [
      `The parent is ${input.askedBy}, of the ${input.householdName} household.`,
      context,
      "",
      `What they want to know: ${input.question}`,
    ].join("\n"),
    schemaName: "school_question",
    schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
  });

  if (typeof payload !== "object" || payload === null) {
    throw new Error("Model returned a payload that was not an object");
  }

  const { subject, body } = payload as Record<string, unknown>;
  if (typeof subject !== "string" || typeof body !== "string") {
    throw new Error("Model returned an email without a subject or body");
  }
  return { subject: subject.trim(), body: body.trim(), usage };
}
