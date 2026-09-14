import { RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import {
  CRAWL_RATE_LIMIT,
  GLOBAL_CRAWL_RATE_LIMIT,
  QUESTION_RATE_LIMIT,
  TRIAL_RATE_LIMIT,
} from "./config";

/**
 * The two things a household can do that spend someone else's money or
 * someone else's patience: crawling a school site burns Firecrawl credits and
 * OpenAI budget on the operator's keys, and mailing the school office puts
 * real email in a real person's inbox.
 *
 * Token buckets rather than fixed windows, so a family that has been quiet can
 * do two things back to back instead of being told to wait on the clock.
 *
 * Both are keyed by household, which bounds one family and nothing else. The
 * two unkeyed buckets below bound the deployment: without them a loop over
 * `/demo` gets a brand new household, and with it a brand new allowance,
 * every time it asks.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  startCrawl: {
    kind: "token bucket",
    rate: CRAWL_RATE_LIMIT.rate,
    period: CRAWL_RATE_LIMIT.periodMs,
    capacity: CRAWL_RATE_LIMIT.capacity,
  },
  newTrial: {
    kind: "token bucket",
    rate: TRIAL_RATE_LIMIT.rate,
    period: TRIAL_RATE_LIMIT.periodMs,
    capacity: TRIAL_RATE_LIMIT.capacity,
  },
  crawlsOverall: {
    kind: "token bucket",
    rate: GLOBAL_CRAWL_RATE_LIMIT.rate,
    period: GLOBAL_CRAWL_RATE_LIMIT.periodMs,
    capacity: GLOBAL_CRAWL_RATE_LIMIT.capacity,
  },
  askSchool: {
    kind: "token bucket",
    rate: QUESTION_RATE_LIMIT.rate,
    period: QUESTION_RATE_LIMIT.periodMs,
    capacity: QUESTION_RATE_LIMIT.capacity,
  },
});
