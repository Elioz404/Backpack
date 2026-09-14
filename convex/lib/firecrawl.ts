import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { components } from "../_generated/api";

/**
 * Firecrawl, scoped to the component instance mounted in `convex.config.ts`.
 *
 * The component owns the crawl row and the pages; the app owns the decision to
 * start one and who is allowed to read it. Authorization lives in the calling
 * action, because a component cannot see `ctx.auth`.
 */
export const firecrawl = new FirecrawlClient(components.firecrawl);

/**
 * School sites bury the useful pages under events, staff bios and photo
 * galleries. Excluding the obvious noise keeps the page budget on material a
 * family could actually owe something against, and every crawl page costs a
 * Firecrawl credit.
 */
export const DEFAULT_EXCLUDE_PATHS = [
  ".*/staff/.*",
  ".*/directory/.*",
  ".*/gallery/.*",
  ".*/photos?/.*",
  ".*/alumni/.*",
  ".*/search.*",
] as const;
