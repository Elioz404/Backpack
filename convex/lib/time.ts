import { ALL_DAY_DUE_HOUR } from "./config";

/**
 * School deadlines are local dates: "Friday the 3rd" means the end of that day
 * where the family lives, not midnight UTC. Every date the model extracts is a
 * plain `YYYY-MM-DD`, and it is resolved into an instant here against the
 * household's own zone.
 *
 * Dependency-free on purpose: `Intl` already knows every zone's offset
 * including its daylight-saving transitions, so there is nothing to keep in
 * sync with a bundled database.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The offset of a zone at a given instant, in milliseconds. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new Error(`Intl gave no ${type} for time zone ${timeZone}`);
    }
    return Number(part.value);
  };

  // `formatToParts` renders midnight as hour 24 in some locales' output.
  const asUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour") % 24,
    field("minute"),
    field("second"),
  );
  return asUtc - instant;
}

/**
 * Resolve a wall-clock time in a zone to an instant.
 *
 * The offset depends on the instant we are solving for, so it is applied once
 * and then re-checked: on the two days a year a zone shifts, the first guess
 * can land on the wrong side of the transition, and the second offset is the
 * correct one.
 */
export function zonedTimeToInstant(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = zoneOffsetMs(naive, timeZone);
  const candidate = naive - firstOffset;
  const secondOffset = zoneOffsetMs(candidate, timeZone);
  return firstOffset === secondOffset ? candidate : naive - secondOffset;
}

/**
 * Turn an extracted `YYYY-MM-DD` (optionally with `HH:MM`) into an instant in
 * the household's zone. Returns `undefined` for anything malformed rather than
 * inventing a date, so an unparseable deadline surfaces as "no date" instead
 * of as the wrong one.
 */
export function resolveDueAt(
  timeZone: string,
  date: string | undefined,
  time: string | undefined,
): { dueAt: number | undefined; allDay: boolean } {
  if (date === undefined || !DATE_ONLY.test(date)) {
    return { dueAt: undefined, allDay: true };
  }
  const [year, month, day] = date.split("-").map(Number);

  const parsedTime = time?.match(/^(\d{2}):(\d{2})$/);
  const allDay = parsedTime === null || parsedTime === undefined;
  const hour = allDay ? ALL_DAY_DUE_HOUR : Number(parsedTime[1]);
  const minute = allDay ? 0 : Number(parsedTime[2]);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { dueAt: undefined, allDay: true };
  }
  return {
    dueAt: zonedTimeToInstant(timeZone, year, month, day, hour, minute),
    allDay,
  };
}

/**
 * Today's date in a zone, as `YYYY-MM-DD`. The extractor is given this so it
 * can resolve "next Friday" against the family's calendar rather than the
 * server's.
 */
export function todayInZone(timeZone: string, now: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return parts;
}

/** Whether a zone identifier is one this runtime actually knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
