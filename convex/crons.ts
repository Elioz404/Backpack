import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Scheduled work.
 *
 * Just the one job. A school site keeps publishing all term, and a family that
 * pointed Backpack at it once should not have to remember to look again — so
 * every site is re-read weekly, and dedupe by content hash means an unchanged
 * site costs nothing beyond the crawl itself.
 *
 * Sunday night: the sweep lands before the week it is about, and off-peak for
 * the school's own servers.
 */
const crons = cronJobs();

crons.weekly(
  "re-read every school site",
  { dayOfWeek: "sunday", hourUTC: 23, minuteUTC: 0 },
  internal.pipelines.recrawl.sweep,
  { cursor: null },
);

export default crons;
