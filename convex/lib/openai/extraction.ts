import { v } from "convex/values";
import { vObligationKind } from "../../schema";
import { clampForModel, normaliseText } from "../text";
import { openAiClient } from "./client";

/**
 * Reading one page or one message and reporting what it asks of the family.
 *
 * Two rules make the output trustworthy enough to put on a shared board:
 *
 * 1. The model answers against a strict JSON schema, so there is no prose to
 *    parse and no field to guess at.
 * 2. Every item must carry a sentence copied from the source. That claim is
 *    then checked here against the actual text — an item whose quote is not in
 *    the source is dropped, not merely flagged. The model cannot put something
 *    on the board that the source does not say.
 */

export const OBLIGATION_KINDS = [
  "form",
  "money",
  "supply",
  "schedule",
  "event",
  "info",
] as const;

export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

export type ExtractedItem = {
  title: string;
  detail: string | undefined;
  kind: ObligationKind;
  dueDate: string | undefined;
  dueTime: string | undefined;
  childNames: string[];
  amountValue: number | undefined;
  amountCurrency: string | undefined;
  quote: string;
  confidence: number;
};

/**
 * The wire shape of an extracted item, for the hop from the action that called
 * the model to the mutation that writes the result.
 */
export const vExtractedItem = v.object({
  title: v.string(),
  detail: v.optional(v.string()),
  kind: vObligationKind,
  dueDate: v.optional(v.string()),
  dueTime: v.optional(v.string()),
  childNames: v.array(v.string()),
  amountValue: v.optional(v.number()),
  amountCurrency: v.optional(v.string()),
  quote: v.string(),
  confidence: v.number(),
});

export type ExtractionInput = {
  /** Where this text came from, so the model can weigh it. */
  sourceKind: "page" | "email";
  sourceTitle: string;
  sourceUrl: string | undefined;
  text: string;
  /** Household context: who the children are and what "today" means to them. */
  childNames: string[];
  schoolNames: string[];
  today: string;
  timeZone: string;
};

export type ExtractionResult = {
  items: ExtractedItem[];
  /** Items the model returned whose quote was not found in the source. */
  rejected: number;
  model: string;
};

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      description:
        "Everything in this source that the family has to act on or know about. Empty when the source asks nothing of them.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "detail",
          "kind",
          "dueDate",
          "dueTime",
          "childNames",
          "amountValue",
          "amountCurrency",
          "quote",
          "confidence",
        ],
        properties: {
          title: {
            type: "string",
            description:
              "What the family must do, as a short imperative phrase. No school name, no date.",
          },
          detail: {
            type: ["string", "null"],
            description: "One sentence of context, or null when the title says it all.",
          },
          kind: {
            type: "string",
            enum: [...OBLIGATION_KINDS],
            description:
              "form: sign and send back. money: pay. supply: bring or buy. schedule: a day that changes, like no school or early dismissal. event: somewhere to be. info: worth knowing, nothing to do.",
          },
          dueDate: {
            type: ["string", "null"],
            description:
              "The date it is due or happens, strictly YYYY-MM-DD, resolved against today's date. Null when the source gives no date. Never guess a year.",
          },
          dueTime: {
            type: ["string", "null"],
            description: "Time of day as HH:MM 24-hour, or null when the source gives none.",
          },
          childNames: {
            type: "array",
            items: { type: "string" },
            description:
              "Which of the household's children this applies to, copied exactly from the names provided. Empty when it applies to the whole family or the source does not say.",
          },
          amountValue: {
            type: ["number", "null"],
            description: "Amount of money owed, as a number. Null when no money is involved.",
          },
          amountCurrency: {
            type: ["string", "null"],
            description: "ISO 4217 code for the amount, such as USD. Null when there is no amount.",
          },
          quote: {
            type: "string",
            description:
              "A sentence copied VERBATIM from the source text that states this. Copy it character for character. Do not paraphrase, summarise, translate or correct it. An item whose quote is not found in the source is discarded.",
          },
          confidence: {
            type: "number",
            description:
              "0 to 1. How sure you are that the source really asks this of this family, rather than being generic text or an item for someone else.",
          },
        },
      },
    },
  },
} as const;

function systemPrompt(input: ExtractionInput): string {
  return [
    "You read school communications and report only what a family has to do.",
    "",
    "Rules:",
    "- Report only what the text actually says. Never infer an obligation that is not stated.",
    "- Navigation menus, footers, staff directories, mission statements and photo captions ask nothing of a family. Return no item for them.",
    "- A date with no year is the next occurrence on or after today.",
    "- Copy the quote verbatim from the source. An item whose quote cannot be found in the source is discarded, so an approximate quote loses the whole item.",
    "- One item per real obligation. Do not split a single request into steps.",
    "- Prefer no item over a speculative one.",
    "",
    `Today is ${input.today} in ${input.timeZone}.`,
    input.childNames.length > 0
      ? `The children in this household are: ${input.childNames.join(", ")}.`
      : "This household has not named its children yet, so leave childNames empty.",
    input.schoolNames.length > 0
      ? `Their school(s): ${input.schoolNames.join(", ")}.`
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function userPrompt(input: ExtractionInput): string {
  const origin =
    input.sourceKind === "email"
      ? "An email forwarded into the household inbox."
      : `A page from the school website${input.sourceUrl ? ` (${input.sourceUrl})` : ""}.`;
  return [
    origin,
    `Title: ${input.sourceTitle}`,
    "",
    "--- SOURCE TEXT BEGINS ---",
    input.text,
    "--- SOURCE TEXT ENDS ---",
  ].join("\n");
}

/**
 * Whether a quote really appears in the source.
 *
 * Compared on collapsed whitespace and case, because a faithful copy can still
 * differ in line wrapping once a page has been rendered to markdown. Anything
 * beyond that — a reworded, translated or invented sentence — fails.
 */
function isGrounded(quote: string, haystack: string): boolean {
  const flatten = (value: string) =>
    value.toLowerCase().replace(/\s+/g, " ").trim();
  const needle = flatten(quote);
  return needle.length >= 12 && flatten(haystack).includes(needle);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Read one source and return the obligations it states.
 *
 * Throws on a transport or schema failure so the caller can record the source
 * as failed and retry it; returns an empty list when the source genuinely asks
 * nothing, which is the common case for a school website.
 */
export async function extractObligations(
  input: ExtractionInput,
): Promise<ExtractionResult> {
  const { client, model } = openAiClient();
  const text = clampForModel(normaliseText(input.text));

  const response = await client.responses.create({
    model,
    input: [
      { role: "system", content: systemPrompt({ ...input, text }) },
      { role: "user", content: userPrompt({ ...input, text }) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "school_obligations",
        strict: true,
        schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
  });

  const payload: unknown = JSON.parse(response.output_text);
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray((payload as { items?: unknown }).items)
  ) {
    throw new Error("Model returned a payload without an items array");
  }

  const items: ExtractedItem[] = [];
  let rejected = 0;

  for (const raw of (payload as { items: unknown[] }).items) {
    if (typeof raw !== "object" || raw === null) {
      rejected += 1;
      continue;
    }
    const candidate = raw as Record<string, unknown>;
    const title = asOptionalString(candidate.title);
    const quote = asOptionalString(candidate.quote);
    const kind = candidate.kind;

    if (
      title === undefined ||
      quote === undefined ||
      typeof kind !== "string" ||
      !(OBLIGATION_KINDS as readonly string[]).includes(kind)
    ) {
      rejected += 1;
      continue;
    }

    // The grounding guarantee. Everything above this line is the model's
    // claim; only what survives here reaches the board.
    if (!isGrounded(quote, text)) {
      rejected += 1;
      continue;
    }

    const confidence = asOptionalNumber(candidate.confidence) ?? 0;
    items.push({
      title,
      detail: asOptionalString(candidate.detail),
      kind: kind as ObligationKind,
      dueDate: asOptionalString(candidate.dueDate),
      dueTime: asOptionalString(candidate.dueTime),
      childNames: Array.isArray(candidate.childNames)
        ? candidate.childNames.filter(
            (name): name is string => typeof name === "string",
          )
        : [],
      amountValue: asOptionalNumber(candidate.amountValue),
      amountCurrency: asOptionalString(candidate.amountCurrency),
      quote,
      confidence: Math.min(1, Math.max(0, confidence)),
    });
  }

  return { items, rejected, model };
}
