/**
 * Turning a thrown value into something a person can act on.
 *
 * The backend raises `ConvexError` with a tagged payload precisely so the
 * reason survives the trip to the browser. Catching it and substituting a
 * guess — "check the API key" when the real answer is "your plan allows three
 * inboxes" — sends the reader to the wrong place and costs them an hour.
 */
type TaggedError = {
  data?: {
    code?: string;
    field?: string;
    entity?: string;
    message?: string;
    upstream?: string;
    /** The rate limiter's own shape, which is not ours to change. */
    kind?: string;
    name?: string;
    retryAfter?: number;
  };
};

/** "in about four minutes" reads better than a millisecond count. */
function inAbout(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "in a minute";
  if (minutes < 60) return `in about ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}

/** Reasons worth phrasing ourselves, because the server's wording is internal. */
const KNOWN: Record<string, string> = {
  UNAUTHENTICATED: "Your session expired. Sign in again.",
  NOT_FOUND: "That is no longer there.",
  FORBIDDEN: "Only the household owner can do that.",
  ALREADY_CLAIMED: "Someone else just took this one.",
  RATE_LIMITED: "That is a lot at once. Try again shortly.",
  NO_INBOX: "This household has no address yet — get one first.",
  NO_OFFICE_EMAIL: "Add the school office address before asking a question.",
  BUDGET_REACHED:
    "This deployment has reached its OpenAI budget, so it cannot write that.",
  DUPLICATE: "That one is already on the list.",
  ALREADY_IN_HOUSEHOLD:
    "This account already has a board, so the trial one was left where it is.",
};

/**
 * Where the same code means something different depending on what it is
 * about. A missing obligation and a missing hand-off ticket both come back as
 * NOT_FOUND, and "that is no longer there" explains neither.
 */
const BY_ENTITY: Record<string, string> = {
  "NOT_FOUND:claim":
    "That hand-off has already been used, so the board stayed where it was.",
  "EXPIRED:claim":
    "That took too long and the hand-off lapsed. Open the trial board again " +
    "and press Keep this board.",
};

export function explainError(caught: unknown, fallback: string): string {
  const data = (caught as TaggedError)?.data;
  if (data === undefined) return fallback;

  // The rate limiter throws its own payload. Saying when to come back is the
  // whole difference between a limit and a wall.
  if (data.kind === "RateLimited") {
    const when =
      typeof data.retryAfter === "number"
        ? ` Try again ${inAbout(data.retryAfter)}.`
        : " Try again shortly.";
    return data.name === "newTrial" || data.name === "crawlsOverall"
      ? `Backpack is busy — a lot of people are trying it at once.${when}`
      : `That is a lot at once.${when}`;
  }

  if (data.code !== undefined && data.entity !== undefined) {
    const specific = BY_ENTITY[`${data.code}:${data.entity}`];
    if (specific !== undefined) return specific;
  }

  const known = data.code === undefined ? undefined : KNOWN[data.code];
  if (known !== undefined) return known;

  // An upstream failure carries the service's own explanation, which is
  // usually better than anything we would write for it.
  if (typeof data.message === "string" && data.message !== "") {
    return data.message;
  }
  if (data.code === "INVALID" && data.field !== undefined) {
    return `That ${data.field} does not look right.`;
  }
  return fallback;
}
