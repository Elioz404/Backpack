import { Workpool } from "@convex-dev/workpool";
import { components } from "../_generated/api";
import { EXTRACTION_CONCURRENCY } from "./config";

/**
 * A finished crawl can land a hundred pages in one callback, and each page is
 * one OpenAI call. Scheduling a hundred actions would run them all at once,
 * spike the bill and trip the model's rate limit.
 *
 * The pool turns that into a queue with a fixed number in flight, and retries
 * the transient failures. Extraction is safe to retry: a page is identified by
 * its content hash, and re-reading one revises the same rows rather than
 * adding more.
 */
export const extractionPool = new Workpool(components.extractionPool, {
  maxParallelism: EXTRACTION_CONCURRENCY,
  retryActionsByDefault: true,
});
