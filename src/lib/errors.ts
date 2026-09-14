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
  };
};

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
};

export function explainError(caught: unknown, fallback: string): string {
  const data = (caught as TaggedError)?.data;
  if (data === undefined) return fallback;

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
