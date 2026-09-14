/**
 * How the board talks about time and money.
 *
 * Everything here is rendered in the household's own zone, not the browser's,
 * because a deadline set by a school in one place must read the same to a
 * parent travelling in another.
 */

export type Bucket = "overdue" | "today" | "week" | "later" | "undated";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight tonight in a zone, as an instant. */
function endOfDay(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
  const [year, month, day] = parts.split("-").map(Number);
  // Local midnight, approximated through the zone's offset at `at`. Good to
  // the hour, which is all a bucket boundary needs.
  const naive = Date.UTC(year, month - 1, day + 1);
  const offset = zoneOffset(at, timeZone);
  return naive - offset;
}

function zoneOffset(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(at));
  const field = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return (
    Date.UTC(
      field("year"),
      field("month") - 1,
      field("day"),
      field("hour") % 24,
      field("minute"),
    ) - at
  );
}

/**
 * Which band of the agenda an item belongs to.
 *
 * "Today" ends at midnight rather than 24 hours from now, because a parent
 * reading this at 9pm cares about tomorrow morning, not about the next
 * rolling day.
 */
export function bucketOf(
  dueAt: number | null,
  timeZone: string,
  now: number,
): Bucket {
  if (dueAt === null) return "undated";
  const tonight = endOfDay(timeZone, now);
  if (dueAt < now) return "overdue";
  if (dueAt <= tonight) return "today";
  if (dueAt <= tonight + 6 * DAY_MS) return "week";
  return "later";
}

export const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "Past due",
  today: "Today",
  week: "This week",
  later: "Later",
  undated: "No date given",
};

/** "Fri 3 Oct" — short, unambiguous, no year unless it is not this one. */
export function formatDue(
  dueAt: number | null,
  timeZone: string,
  allDay: boolean,
  now: number,
): string {
  if (dueAt === null) return "—";

  const sameYear =
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric" }).format(
      new Date(dueAt),
    ) ===
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric" }).format(
      new Date(now),
    );

  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(new Date(dueAt));

  if (allDay) return date;

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(dueAt));
  return `${date} · ${time}`;
}

/** How many days out, for the small print under a date. */
export function relativeDue(
  dueAt: number | null,
  timeZone: string,
  now: number,
): string | null {
  if (dueAt === null) return null;
  const tonight = endOfDay(timeZone, now);
  const days = Math.round((dueAt - tonight) / DAY_MS);
  if (dueAt < now) {
    const over = Math.max(1, Math.round((now - dueAt) / DAY_MS));
    return over === 1 ? "yesterday" : `${over} days ago`;
  }
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  return null;
}

export function formatMoney(cents: number, currency: string | null): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency ?? "USD",
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/** Two letters for a stamp. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function formatClock(at: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

/** The browser's best guess, offered as the default when creating a household. */
export function guessTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
