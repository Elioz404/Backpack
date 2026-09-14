import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { guessTimeZone } from "../lib/format";
import { Icon } from "./Icon";
import { Button, Field, Input } from "./ui";

/**
 * The first thing a new account sees.
 *
 * One question, asked once. Children and a school are added from the board
 * itself, where the empty state explains why each one matters — asking for all
 * of it up front would be a form to fill in before the product has earned it.
 */
export function Onboarding() {
  const createHousehold = useMutation(api.households.create);
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState(guessTimeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createHousehold({ name: name.trim(), timeZone });
    } catch {
      setError("That did not take. Check the name and try again.");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-full place-items-center px-5 py-16">
      <form onSubmit={submit} className="w-full max-w-md">
        <div className="flex items-center gap-2 text-ballpoint">
          <Icon name="backpack" size={20} strokeWidth={1.4} />
          <span className="display text-[17px]">Backpack</span>
        </div>

        <h1 className="display mt-7 text-[28px] leading-tight">
          What should we call your household?
        </h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-soft">
          It appears at the top of the board and in the mail Backpack sends on
          your behalf.
        </p>

        <div className="mt-9 grid gap-6">
          <Field label="Household" error={error}>
            {(id) => (
              <Input
                id={id}
                value={name}
                required
                autoFocus
                placeholder="The Ferreiras"
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>

          <Field
            label="Time zone"
            hint="School deadlines are local dates, so this decides when things are due."
          >
            {(id) => (
              <Input
                id={id}
                value={timeZone}
                required
                spellCheck={false}
                onChange={(event) => setTimeZone(event.target.value)}
              />
            )}
          </Field>

          <Button
            type="submit"
            tone="primary"
            disabled={busy || name.trim() === ""}
          >
            {busy ? "Setting up…" : "Open the board"}
          </Button>
        </div>
      </form>
    </main>
  );
}
