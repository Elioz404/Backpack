import { MAX_SOURCE_CHARS } from "./config";

/**
 * Text handling shared by both ingestion paths. A crawled page and a forwarded
 * email become the same thing before the model sees either: normalised text
 * plus a hash that answers "have we already read exactly this?".
 */

/**
 * Collapse the differences that do not change meaning, so the same page
 * fetched twice hashes the same. Line structure is kept because the extractor
 * relies on it to quote accurately.
 *
 * Markdown link and image syntax is flattened first. A rendered school page is
 * mostly navigation, and in markdown every one of those links carries a URL far
 * longer than its own text: the first 900 characters of one real page were a
 * skip link, a search box and two image URLs, without a sentence among them.
 * Dropping the targets and keeping the words leaves the same readable text at a
 * fraction of the size — which is both what the model should be reading and
 * what we are paying to send it.
 */
export function normaliseText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // Images say nothing a family must act on, and their URLs are enormous.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // Links keep their text and lose their target.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Bare URLs, including any the two rules above leave behind.
    .replace(/<?\bhttps?:\/\/[^\s)>\]]+>?/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** SHA-256 of the normalised text, hex encoded. */
export async function contentHash(normalised: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Trim to what the model is shown, on a paragraph boundary where one is close
 * enough, so a quote is never cut mid-sentence.
 */
export function clampForModel(text: string, limit = MAX_SOURCE_CHARS): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const lastBreak = head.lastIndexOf("\n\n");
  return lastBreak > limit * 0.6 ? head.slice(0, lastBreak) : head;
}

/**
 * A stable identity for the same real-world obligation announced more than
 * once — first on the school site, then in a reminder email. Built from the
 * meaning (kind, due date, normalised title) rather than the wording, so two
 * phrasings of one deadline collapse onto a single card.
 */
export function obligationFingerprint(input: {
  kind: string;
  title: string;
  dueDate: string | undefined;
}): string {
  const title = input.title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .sort()
    .join("-");
  return [input.kind, input.dueDate ?? "undated", title].join("|");
}

/**
 * Dropped before fingerprinting so "Return the permission slip" and
 * "Permission slip to return" are recognised as the same thing.
 */
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "your",
  "you",
  "our",
  "with",
  "from",
  "this",
  "that",
  "please",
  "all",
  "any",
  "are",
  "must",
  "will",
  "need",
  "needs",
  "needed",
  "should",
]);
