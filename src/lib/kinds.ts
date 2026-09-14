/**
 * What each kind of obligation looks like on the board.
 *
 * The kind is the only taxonomy a parent sees, so it carries the whole visual
 * load: the folder tab down the left edge of a row, the verb on the button,
 * and the word in the group header. Kept in one table so a row, a filter and a
 * legend can never disagree about what "supply" means.
 */
export type ObligationKind =
  | "form"
  | "money"
  | "supply"
  | "schedule"
  | "event"
  | "info";

type KindSpec = {
  /** Shown on the row. Singular, lowercase — it sits inside a sentence. */
  label: string;
  /** What doing it means, used on the completion control. */
  done: string;
  /** CSS custom property holding this kind's stationery colour. */
  color: string;
  /** One-line explanation, for the legend and for screen readers. */
  gloss: string;
};

export const KINDS: Record<ObligationKind, KindSpec> = {
  form: {
    label: "form",
    done: "Sent back",
    color: "var(--color-kind-form)",
    gloss: "Something to sign and return",
  },
  money: {
    label: "money",
    done: "Paid",
    color: "var(--color-kind-money)",
    gloss: "Something to pay",
  },
  supply: {
    label: "bring",
    done: "Packed",
    color: "var(--color-kind-supply)",
    gloss: "Something to bring or buy",
  },
  schedule: {
    label: "day",
    done: "Noted",
    color: "var(--color-kind-schedule)",
    gloss: "A day that changes — no school, early pickup",
  },
  event: {
    label: "be there",
    done: "Handled",
    color: "var(--color-kind-event)",
    gloss: "Somewhere to be",
  },
  info: {
    label: "note",
    done: "Read",
    color: "var(--color-kind-info)",
    gloss: "Worth knowing, nothing to do",
  },
};

export const KIND_ORDER: ObligationKind[] = [
  "form",
  "money",
  "supply",
  "schedule",
  "event",
  "info",
];

/** The accent a child is marked with, wherever they appear. */
export const CHILD_COLORS: Record<string, string> = {
  amber: "#b9752a",
  sky: "#2f5d9e",
  violet: "#68499b",
  emerald: "#2c7350",
  rose: "#ad2f27",
  slate: "#7d7366",
};

export function childColor(colorKey: string): string {
  return CHILD_COLORS[colorKey] ?? CHILD_COLORS.slate;
}
