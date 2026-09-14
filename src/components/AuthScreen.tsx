import {
  useSignInWithPassword,
  useSignUpWithPassword,
} from "@convex-dev/auth/providers/password/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Icon } from "./Icon";
import { Button, Field, Input } from "./ui";

/**
 * The way in.
 *
 * Laid out as a notice board rather than a product landing page: the left side
 * is the thing itself, printed; the right is the slip you fill in. Username
 * and password, because the second parent is usually standing next to the
 * first and a mailed link is a worse experience than typing a name.
 */

const USER_ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: "That username and password do not match.",
  USER_NOT_FOUND: "No account with that username.",
  PASSWORD_TOO_SHORT: "Pick a longer password — at least 8 characters.",
  PASSWORD_TOO_LONG: "That password is too long.",
  PASSWORD_HAS_SURROUNDING_WHITESPACE:
    "That password starts or ends with a space.",
  RATE_LIMITED: "Too many attempts. Wait a moment and try again.",
  OTHER_ERROR: "Something went wrong. Try again.",
};

export function AuthScreen() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { signIn, pending: signingIn } = useSignInWithPassword(
    api.auth.signInWithPassword,
  );
  const { signUp, pending: signingUp } = useSignUpWithPassword(
    api.auth.signUpWithPassword,
  );
  const pending = signingIn || signingUp;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const credentials = { username: username.trim(), password };
    const result =
      mode === "in" ? await signIn(credentials) : await signUp(credentials);
    if (!result.success) {
      setError(
        USER_ERRORS[result.userError.error] ?? USER_ERRORS.OTHER_ERROR,
      );
    }
  }

  return (
    <main className="min-h-full px-5 py-10 sm:px-8 lg:px-12">
      <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
        <section className="max-w-xl">
          <div className="flex items-center gap-2 text-ballpoint">
            <Icon name="backpack" size={22} strokeWidth={1.4} />
            <span className="display text-[19px] tracking-tight">Backpack</span>
          </div>

          <h1 className="display mt-8 text-[clamp(2rem,4.4vw,2.9rem)] leading-[1.07] text-balance">
            Everything the school year asks of you, on one page.
          </h1>

          <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-ink-soft">
            Point it at your school&rsquo;s website and forward it the mail you
            already get. It keeps one shared list of what your family actually
            has to do — and both parents watch the same list change.
          </p>

          <ul className="mt-9 grid gap-0 border-t border-rule">
            {[
              {
                icon: "site" as const,
                title: "It reads the school site",
                body: "The calendar, the newsletters, the handbook — the pages nobody opens twice.",
              },
              {
                icon: "mail" as const,
                title: "You forward the mail",
                body: "Your household gets its own address. Three teachers and two coaches, one list.",
              },
              {
                icon: "quote" as const,
                title: "Every line quotes its source",
                body: "If the notice does not say it, it does not appear. No summaries you have to trust.",
              },
            ].map((item) => (
              <li
                key={item.title}
                className="flex gap-3.5 border-b border-rule py-4"
              >
                <span className="mt-0.5 text-ballpoint">
                  <Icon name={item.icon} size={17} />
                </span>
                <div>
                  <p className="text-[14px] font-medium text-ink">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-faint">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="lg:pt-16">
          <form
            onSubmit={submit}
            className="sheet grid gap-5 p-6 sm:p-7"
            noValidate
          >
            <div>
              <p className="label">
                {mode === "in" ? "Sign in" : "New household"}
              </p>
              <h2 className="display mt-1.5 text-[22px]">
                {mode === "in" ? "Welcome back." : "Start a Backpack."}
              </h2>
            </div>

            <Field label="Username">
              {(id) => (
                <Input
                  id={id}
                  value={username}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="dani"
                />
              )}
            </Field>

            <Field
              label="Password"
              hint={mode === "up" ? "At least 8 characters." : undefined}
              error={error}
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  value={password}
                  autoComplete={
                    mode === "in" ? "current-password" : "new-password"
                  }
                  required
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                />
              )}
            </Field>

            <Button
              type="submit"
              tone="primary"
              disabled={pending || username.trim() === "" || password === ""}
              className="mt-1 w-full"
            >
              {pending
                ? "One moment…"
                : mode === "in"
                  ? "Sign in"
                  : "Create account"}
            </Button>

            <p className="border-t border-rule pt-4 text-[13px] text-ink-faint">
              {mode === "in" ? "No account yet?" : "Already have one?"}{" "}
              <button
                type="button"
                className="focus-ring font-medium text-ballpoint underline underline-offset-2"
                onClick={() => {
                  setMode(mode === "in" ? "up" : "in");
                  setError(null);
                }}
              >
                {mode === "in" ? "Create one" : "Sign in instead"}
              </button>
            </p>
          </form>

          <p className="mt-4 px-1 text-[12px] leading-relaxed text-ink-faint">
            A household is private to the people in it. Invite the other parent
            by username once you are in.
          </p>
        </section>
      </div>
    </main>
  );
}
