import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { BoardCard } from "./BoardRow";
import { Icon } from "./Icon";
import { Button, Spinner, Textarea } from "./ui";

/**
 * Asking the school office.
 *
 * The parent types the thing they actually want to know; the model turns it
 * into a message an office will answer, and it goes from the household's own
 * address. The reply lands back in the same inbox and is read like any other
 * notice — so an answer that moves a date moves the card.
 *
 * The quoted notice is shown while composing, because what makes this
 * answerable is that the office can tell which of forty families is asking
 * about which notice.
 */
export function AskDialog({
  householdId,
  card,
  onClose,
}: {
  householdId: Id<"households">;
  card: BoardCard | null;
  onClose: () => void;
}) {
  const ask = useAction(api.questions.ask);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (card === null) return;
    setQuestion("");
    setSent(null);
    setError(null);
    fieldRef.current?.focus();
  }, [card]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (card === null) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await ask({
        householdId,
        obligationId: card!._id,
        question: question.trim(),
      });
      setSent(result.subject);
    } catch (caught) {
      setError(explain(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-ink/25 px-4 py-4 sm:place-items-center backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ask the school"
        className="sheet settle w-full max-w-lg shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
          <div>
            <p className="label">Ask the school</p>
            <h2 className="display mt-1 text-[18px] leading-snug">
              {card.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring -mr-1 rounded-[2px] p-1 text-ink-faint hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        {sent === null ? (
          <form onSubmit={submit} className="grid gap-4 px-5 py-4">
            <blockquote className="evidence rounded-r-[3px] px-3 py-2.5">
              {card.quote}
            </blockquote>

            <div className="grid gap-1.5">
              <label htmlFor="ask-field" className="label">
                What do you want to know?
              </label>
              <Textarea
                id="ask-field"
                ref={fieldRef}
                rows={3}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Is the deadline firm, or can we send it Monday?"
              />
              <p className="text-[12px] leading-relaxed text-ink-faint">
                Backpack writes the email and sends it from your household
                address. It only asks — it never agrees to anything for you.
              </p>
            </div>

            {error ? (
              <p className="text-[12.5px] text-overdue">{error}</p>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-rule pt-4">
              <Button type="button" tone="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                tone="primary"
                disabled={busy || question.trim() === ""}
                icon={busy ? <Spinner /> : <Icon name="mail" size={14} />}
              >
                {busy ? "Writing…" : "Write and send"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid gap-3 px-5 py-5">
            <p className="text-[14px] text-ink">Sent.</p>
            <p className="font-mono text-[12.5px] text-ink-soft">{sent}</p>
            <p className="text-[12.5px] leading-relaxed text-ink-faint">
              The reply comes back to your household address, and Backpack
              reads it onto this board.
            </p>
            <div className="flex justify-end border-t border-rule pt-4">
              <Button tone="quiet" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Turn the server's tagged errors into something a parent can act on. */
function explain(caught: unknown): string {
  const data = (caught as { data?: { code?: string } })?.data;
  switch (data?.code) {
    case "NO_INBOX":
      return "This household has no address yet — get one from the left first.";
    case "NO_OFFICE_EMAIL":
      return "Add the school office email address before asking a question.";
    case "RATE_LIMITED":
      return "That is a lot of mail for one day. Try again tomorrow.";
    default:
      return "The message could not be sent. Check the deployment keys.";
  }
}
