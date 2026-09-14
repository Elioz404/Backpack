import { useAnonymousAuth } from "@convex-dev/auth/providers/anonymous/react";
import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { guessTimeZone } from "../lib/format";
import { Icon } from "./Icon";

/**
 * Trying Backpack without deciding to.
 *
 * A shared family board cannot be judged from a sign-up form, and a read-only
 * tour is worse than nothing: it shows the output while hiding the point,
 * which is two people moving the same list. So this is not a tour. It signs
 * the visitor in anonymously, gives them a real household with a real address
 * and a board already worth looking at, and hands them the product with every
 * control live.
 *
 * It is private to whoever opened it — nothing they press changes what the
 * next visitor sees — and it is the same code path a signed-up family uses,
 * so there is no second, lesser version of the app to keep working.
 */
export function Trial({ onReady }: { onReady: () => void }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signInAnonymous } = useAnonymousAuth(api.auth.signInAnonymous);
  const startTrial = useMutation(api.households.startTrial);

  const [error, setError] = useState<string | null>(null);
  // Strict mode mounts effects twice; without this the visitor gets two
  // anonymous accounts and lands in the emptier of them.
  const started = useRef(false);

  useEffect(() => {
    if (started.current || isLoading) return;
    started.current = true;

    void (async () => {
      try {
        // Resolves once the session is established; it throws rather than
        // reporting a failure, so there is no result to check.
        if (!isAuthenticated) await signInAnonymous();
        await startTrial({ timeZone: guessTimeZone() });
        onReady();
      } catch {
        started.current = false;
        setError(
          "Could not start a trial board. Reload, or sign up for one instead.",
        );
      }
    })();
  }, [isAuthenticated, isLoading, signInAnonymous, startTrial, onReady]);

  return (
    <main className="grid min-h-full place-items-center px-5">
      <div className="max-w-sm text-center">
        <div className="flex items-center justify-center gap-2 text-ballpoint">
          <Icon name="backpack" size={22} strokeWidth={1.4} />
          <span className="display text-[18px] text-ink">Backpack</span>
        </div>

        {error === null ? (
          <>
            <p className="display mt-6 text-[19px] leading-snug">
              Making you a board.
            </p>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
              Your own household, your own address, and an invented family on it
              so there is something to press. No account needed.
            </p>
          </>
        ) : (
          <>
            <p className="display mt-6 text-[19px] leading-snug">
              That did not start.
            </p>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
              {error}
            </p>
            <a
              href="/"
              className="focus-ring mt-4 inline-block text-[14px] font-medium text-ballpoint underline underline-offset-2"
            >
              Go to sign up
            </a>
          </>
        )}
      </div>
    </main>
  );
}
