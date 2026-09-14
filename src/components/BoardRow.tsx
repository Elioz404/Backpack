import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatDue, formatMoney, initials, relativeDue } from "../lib/format";
import { childColor, KINDS, type ObligationKind } from "../lib/kinds";
import { Icon, type IconName } from "./Icon";
import { Chip } from "./ui";

export type BoardCard = {
  _id: Id<"obligations">;
  title: string;
  detail: string | null;
  kind: ObligationKind;
  status: "open" | "claimed" | "done" | "dismissed";
  dueAt: number | null;
  dueIsAllDay: boolean;
  amountCents: number | null;
  currency: string | null;
  confidence: number;
  quote: string;
  children: { _id: Id<"children">; name: string; colorKey: string }[];
  claimedBy: { userId: Id<"users">; displayName: string } | null;
  source: {
    kind: "page" | "email";
    title: string;
    url: string | null;
    fromAddress: string | null;
    capturedAt: number;
  };
};

/**
 * One line of the agenda.
 *
 * Three columns: the folder tab that says what kind of thing it is, the thing
 * itself, and when it is due. The controls live in the third column under the
 * date, so they take no vertical room of their own — a list of twenty lines
 * should scan in one screen, and a reserved strip of empty space under each
 * one is what stops that.
 *
 * The evidence — the sentence from the school's own notice — is one click
 * away rather than always open, because the board is for scanning and the
 * quote is for when you doubt it.
 */
export function BoardRow({
  card,
  householdId,
  timeZone,
  now,
  currentUserId,
  onAsk,
}: {
  card: BoardCard;
  householdId: Id<"households">;
  timeZone: string;
  now: number;
  currentUserId: Id<"users"> | null;
  onAsk: (card: BoardCard) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const claim = useMutation(api.board.claim);
  const release = useMutation(api.board.release);
  const complete = useMutation(api.board.complete);
  const dismiss = useMutation(api.board.dismiss);

  const spec = KINDS[card.kind];
  const overdue = card.dueAt !== null && card.dueAt < now;
  const mine = card.claimedBy?.userId === currentUserId;
  const relative = relativeDue(card.dueAt, timeZone, now);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={[
        "settle group grid grid-cols-[3px_minmax(0,1fr)_auto] gap-x-3.5",
        "border-b border-rule transition-colors sm:gap-x-5",
        card.claimedBy !== null ? "bg-[var(--stamp-tint)]" : "hover:bg-sheet",
      ].join(" ")}
    >
      {/* The folder tab. The only place colour carries meaning. */}
      <span
        aria-hidden="true"
        style={{ background: spec.color }}
        className="rounded-l-[2px]"
      />

      <div className="min-w-0 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="focus-ring block w-full text-left"
        >
          <span className="flex items-center gap-2">
            <span
              className="label shrink-0"
              style={{ color: spec.color }}
              title={spec.gloss}
            >
              {spec.label}
            </span>
            {card.confidence < 0.8 ? (
              <span
                className="label shrink-0"
                title="The notice was not explicit. Open it and check the quote."
              >
                · unsure
              </span>
            ) : null}
            {/* An affordance, not information: it appears when the row is
                under the pointer, or once the evidence is already open. */}
            <span
              aria-hidden="true"
              className={[
                "ml-auto shrink-0 text-ink-faint transition-all",
                open
                  ? "rotate-90 opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
              ].join(" ")}
            >
              <Icon name="chevron" size={12} />
            </span>
          </span>

          <span className="display mt-0.5 block text-[16.5px] leading-snug text-ink">
            {card.title}
          </span>
        </button>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-faint">
          {card.children.map((child) => (
            <Chip key={child._id} color={childColor(child.colorKey)}>
              {child.name}
            </Chip>
          ))}
          {card.amountCents !== null ? (
            <span className="font-mono text-[12px] text-kind-money">
              {formatMoney(card.amountCents, card.currency)}
            </span>
          ) : null}
          <span className="inline-flex min-w-0 items-center gap-1">
            <Icon
              name={card.source.kind === "email" ? "mail" : "site"}
              size={11}
            />
            <span className="max-w-[28ch] truncate">{card.source.title}</span>
          </span>
          {card.claimedBy !== null ? (
            <span className="stamp inline-flex items-center gap-1.5 rounded-[2px] px-1.5 py-[2px]">
              <span className="font-semibold">
                {initials(card.claimedBy.displayName)}
              </span>
              <span className="opacity-80">
                {mine ? "you have this" : `${card.claimedBy.displayName} has it`}
              </span>
            </span>
          ) : null}
        </div>

        {open ? (
          <div className="mt-2.5 grid gap-2 pb-1">
            {card.detail ? (
              <p className="max-w-prose text-[13.5px] leading-relaxed text-ink-soft">
                {card.detail}
              </p>
            ) : null}

            <blockquote className="evidence max-w-prose rounded-r-[3px] px-3 py-2.5">
              {card.quote}
            </blockquote>

            <p className="text-[11.5px] text-ink-faint">
              {card.source.kind === "email" ? "Forwarded from " : "Read from "}
              {card.source.url !== null ? (
                <a
                  href={card.source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="focus-ring text-ballpoint underline underline-offset-2"
                >
                  {card.source.title}
                </a>
              ) : (
                <span className="text-ink-soft">
                  {card.source.fromAddress ?? card.source.title}
                </span>
              )}
            </p>
          </div>
        ) : null}
      </div>

      {/* When, and what to do about it. */}
      <div className="flex flex-col items-end justify-start gap-1.5 py-2.5 pr-0.5">
        <div className="text-right">
          <div
            className={[
              "font-mono text-[12.5px] whitespace-nowrap tabular-nums",
              overdue ? "text-overdue" : "text-ink-soft",
            ].join(" ")}
          >
            {formatDue(card.dueAt, timeZone, card.dueIsAllDay, now)}
          </div>
          {relative ? (
            <div
              className={[
                "text-[11px] whitespace-nowrap",
                overdue ? "text-overdue" : "text-ink-faint",
              ].join(" ")}
            >
              {relative}
            </div>
          ) : null}
        </div>

        <div
          className={[
            "flex items-center gap-0.5",
            // Quiet until the row is under the pointer, but never hidden from
            // the keyboard and always present on touch.
            "opacity-100 transition-opacity sm:opacity-0",
            "sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
          ].join(" ")}
        >
          {card.claimedBy === null ? (
            <RowAction
              icon="hand"
              label="I've got this"
              disabled={busy}
              onClick={() => run(() => claim({ householdId, obligationId: card._id }))}
            />
          ) : mine ? (
            <RowAction
              icon="undo"
              label="Put it back"
              disabled={busy}
              onClick={() =>
                run(() => release({ householdId, obligationId: card._id }))
              }
            />
          ) : null}

          <RowAction
            icon="ask"
            label="Ask the school"
            disabled={busy}
            onClick={() => onAsk(card)}
          />

          <RowAction
            icon="dismiss"
            label="Not ours — take it off the board"
            tone="danger"
            disabled={busy}
            onClick={() =>
              run(() => dismiss({ householdId, obligationId: card._id }))
            }
          />

          <RowAction
            icon="check"
            label={spec.done}
            tone="primary"
            disabled={busy}
            onClick={() =>
              run(() => complete({ householdId, obligationId: card._id }))
            }
          />
        </div>
      </div>
    </li>
  );
}

/**
 * An icon-sized control. Labelled for assistive tech and on hover, because a
 * row carries four of these and words would crowd out the line itself.
 */
function RowAction({
  icon,
  label,
  tone = "quiet",
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  tone?: "quiet" | "primary" | "danger";
  disabled?: boolean;
  onClick: () => void;
}) {
  const tones = {
    quiet: "text-ink-faint hover:text-ink hover:bg-sheet-sunk",
    primary: "text-ballpoint hover:bg-ballpoint hover:text-sheet",
    danger: "text-ink-faint hover:text-overdue hover:bg-overdue-soft",
  } as const;

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        "focus-ring grid h-7 w-7 place-items-center rounded-[3px] border border-transparent",
        "transition-colors disabled:opacity-40",
        tones[tone],
      ].join(" ")}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}
