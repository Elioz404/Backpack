/**
 * The ticket that carries a trial board onto a real account.
 *
 * Held in this browser between two sessions — minted as the anonymous
 * visitor, redeemed as whoever they sign up as — because those are two
 * different identities and nothing on the server can connect them without
 * something the visitor carries across.
 *
 * Every accessor tolerates storage being unavailable: a private window, or a
 * browser with site data switched off, should still be able to sign up. It
 * just will not carry the trial board over, which is the honest outcome.
 */

const KEY = "backpack.trial-claim";

export function rememberClaim(code: string): void {
  try {
    window.localStorage.setItem(KEY, code);
  } catch {
    // Nothing to carry it in. Sign-up still works.
  }
}

export function pendingClaim(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetClaim(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Already unreachable.
  }
}

/**
 * Why a board did not come across.
 *
 * The sign-in screen cannot report this itself: the moment the session is
 * established the shell swaps it out for the board, and any message it was
 * holding goes with it. Without somewhere to put the reason, a failed hand-off
 * looks exactly like a successful one until someone notices their school and
 * their children are missing.
 *
 * Session storage, not local: it belongs to this tab and this attempt, and it
 * should not still be waiting tomorrow.
 */
const FAILURE = "backpack.trial-claim-failed";

export function noteCarryFailure(reason: string): void {
  try {
    window.sessionStorage.setItem(FAILURE, reason);
  } catch {
    // Then it goes unsaid, which is all that is left.
  }
}

/** Reads it and clears it, so the notice is shown exactly once. */
export function takeCarryFailure(): string | null {
  try {
    const reason = window.sessionStorage.getItem(FAILURE);
    if (reason !== null) window.sessionStorage.removeItem(FAILURE);
    return reason;
  } catch {
    return null;
  }
}
