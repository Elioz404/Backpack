import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { contentHash, normaliseText } from "../lib/text";

/**
 * Provenance. Both ingestion paths — a page from a crawl, a message forwarded
 * into the inbox — land here as the same shape, so the extractor has one kind
 * of input and every obligation can point at the thing that said so.
 */

/**
 * Normalise and hash, in the action that fetched the content.
 *
 * Hashing is async (`crypto.subtle`) and mutations are for writes, so the
 * preparation happens before the transaction opens and the mutation receives
 * a value it can simply index on.
 */
export async function prepare(
  rawText: string,
): Promise<{ text: string; hash: string }> {
  const text = normaliseText(rawText);
  return { text, hash: await contentHash(text) };
}

export type IngestInput = {
  householdId: Id<"households">;
  kind: Doc<"sources">["kind"];
  title: string;
  text: string;
  hash: string;
  url?: string;
  crawlRunId?: Id<"crawlRuns">;
  threadId?: string;
  messageId?: string;
  fromAddress?: string;
};

export type IngestResult =
  | { status: "ingested"; sourceId: Id<"sources"> }
  | { status: "duplicate"; sourceId: Id<"sources"> }
  | { status: "empty" };

/**
 * Below this, a "page" is a nav bar and a footer. Set where it is because a
 * genuine one-line notice ("No school Monday, October 12") is about 35
 * characters and must survive.
 */
const MIN_MEANINGFUL_CHARS = 30;

/**
 * Record a source, unless we have already read exactly this content.
 *
 * The hash is over normalised text, so a school page that is re-crawled
 * unchanged — the common case, since most of a site does not move between
 * crawls — costs nothing. This is the difference between a weekly re-crawl
 * being affordable and being a hundred needless model calls.
 */
export async function ingest(
  ctx: MutationCtx,
  input: IngestInput,
): Promise<IngestResult> {
  if (input.text.length < MIN_MEANINGFUL_CHARS) {
    return { status: "empty" };
  }

  const seen = await ctx.db
    .query("sources")
    .withIndex("by_household_and_hash", (q) =>
      q.eq("householdId", input.householdId).eq("contentHash", input.hash),
    )
    .unique();

  if (seen !== null) {
    return { status: "duplicate", sourceId: seen._id };
  }

  const sourceId = await ctx.db.insert("sources", {
    householdId: input.householdId,
    kind: input.kind,
    title: input.title,
    url: input.url,
    crawlRunId: input.crawlRunId,
    threadId: input.threadId,
    messageId: input.messageId,
    fromAddress: input.fromAddress,
    contentHash: input.hash,
    text: input.text,
    capturedAt: Date.now(),
    extraction: "pending",
  });

  return { status: "ingested", sourceId };
}

export async function markExtraction(
  ctx: MutationCtx,
  sourceId: Id<"sources">,
  state: Doc<"sources">["extraction"],
  error?: string,
): Promise<void> {
  await ctx.db.patch(sourceId, {
    extraction: state,
    extractionError: error,
  });
}

export async function load(
  ctx: QueryCtx,
  sourceId: Id<"sources">,
): Promise<Doc<"sources"> | null> {
  return await ctx.db.get(sourceId);
}
