import { env } from "../_generated/server";

/**
 * AgentMail, over its REST API.
 *
 * Not `@agentmail/convex`. That component reads `process.env.AGENTMAIL_API_KEY`
 * inside its own isolate, where deployment variables are not visible, and its
 * `convex.config` declares no typed environment — so there is no supported way
 * to hand it the key, and every call that reaches the API fails with
 * "AGENTMAIL_API_KEY is not set on this Convex deployment" even when it is.
 * 0.1.0 is the latest published version and the defect has no workaround short
 * of patching or vendoring the package.
 *
 * So this talks to the API directly. It is a small surface — create an inbox,
 * send a message, verify a webhook — and doing it here means the state that
 * matters (threads, messages, provenance) lives in our own tables, reactive by
 * default, rather than behind a component we cannot configure.
 *
 * Everything runs in the Convex runtime: `fetch` and `crypto.subtle`, no
 * `"use node"`, no SDK.
 */

const API_BASE = "https://api.agentmail.to/v0";

function apiKey(): string {
  const key = env.AGENTMAIL_API_KEY;
  if (key === "" || key.startsWith("PLACEHOLDER")) {
    throw new Error(
      "AGENTMAIL_API_KEY is still the provisioning placeholder. Set a real " +
        "key with `npx convex env set AGENTMAIL_API_KEY ...`.",
    );
  }
  return key;
}

/** An API error carrying AgentMail's own machine-readable code where it gives one. */
export class AgentMailError extends Error {
  readonly status: number;
  /** AgentMail's stable snake_case code, when the response carries one. */
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "AgentMailError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  const payload: unknown = text === "" ? {} : JSON.parse(text);

  if (!response.ok) {
    const detail = payload as { code?: string; message?: string; fix?: string };
    // AgentMail's `fix` is the sentence worth showing — "your plan's inbox
    // limit is 3, delete one or upgrade" tells the reader what to do, where
    // `message` only says what went wrong.
    const explanation = [detail.message, detail.fix]
      .filter((part): part is string => typeof part === "string" && part !== "")
      .join(" ");
    throw new AgentMailError(
      response.status,
      detail.code,
      explanation === ""
        ? `AgentMail returned ${response.status}`
        : explanation,
    );
  }
  return payload as T;
}

export type Inbox = {
  inbox_id: string;
  email: string;
  display_name?: string;
};

export type SentMessage = {
  message_id: string;
  thread_id: string;
};

export async function createInbox(request_: {
  displayName?: string;
  username?: string;
  /** Makes creation idempotent: the same client id returns the same inbox. */
  clientId?: string;
}): Promise<Inbox> {
  return await request<Inbox>("/inboxes", {
    method: "POST",
    body: {
      display_name: request_.displayName,
      username: request_.username,
      client_id: request_.clientId,
    },
  });
}

export async function sendMessage(
  inboxId: string,
  message: {
    to: string;
    subject: string;
    text: string;
    labels?: string[];
  },
): Promise<SentMessage> {
  return await request<SentMessage>(
    `/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
    { method: "POST", body: message },
  );
}

/**
 * Verify a Svix-signed webhook delivery.
 *
 * AgentMail delivers through Svix, so a request is authentic when the HMAC of
 * `id.timestamp.body`, keyed by the endpoint secret, matches one of the
 * signatures offered. Implemented here with Web Crypto rather than the `svix`
 * package, which targets Node and would force this route into a Node action.
 *
 * Returns false rather than throwing, so an unsigned probe gets a flat 401 and
 * no stack trace.
 */
export async function verifyWebhook(
  secret: string,
  headers: Headers,
  body: string,
): Promise<boolean> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (id === null || timestamp === null || signatureHeader === null) {
    return false;
  }

  // Reject anything outside a five-minute window, so a captured delivery
  // cannot be replayed later.
  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > 5 * 60 * 1000) {
    return false;
  }

  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(rawSecret);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const mac = await crypto.subtle.sign("HMAC", key, signed);
  const expected = bytesToBase64(new Uint8Array(mac));

  // The header carries space-separated `v1,<signature>` entries; a secret
  // rotation means more than one can be valid at once.
  for (const entry of signatureHeader.split(" ")) {
    const [version, candidate] = entry.split(",");
    if (version !== "v1" || candidate === undefined) continue;
    if (timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

/** Constant-time comparison, so a wrong signature leaks nothing by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The sub-address that routes to one household.
 *
 * AgentMail delivers mail sent to `<local>+<tag>@<domain>` into the inbox
 * `<local>@<domain>`, with the tag intact on the recipient header — verified
 * against the live API, since it is not in the documentation. That is what
 * lets one metered inbox serve any number of households: the tag is the
 * household id, and the webhook reads it back off the envelope.
 */
export function subAddress(inboxAddress: string, tag: string): string {
  const at = inboxAddress.lastIndexOf("@");
  if (at <= 0) return inboxAddress;
  return `${inboxAddress.slice(0, at)}+${tag}${inboxAddress.slice(at)}`;
}

/**
 * The household tag carried by a recipient address, if it has one.
 *
 * Returns nothing for a bare address, which is how mail to a household
 * created before sub-addressing still resolves by its own inbox.
 */
export function tagOf(address: string): string | undefined {
  const at = address.lastIndexOf("@");
  const local = at <= 0 ? address : address.slice(0, at);
  const plus = local.indexOf("+");
  if (plus < 0) return undefined;
  const tag = local.slice(plus + 1).trim();
  return tag === "" ? undefined : tag;
}

/**
 * Every address a message was addressed to.
 *
 * AgentMail reports `to` as a string or a list, and a forwarded message can
 * carry several recipients, so the caller looks through all of them for one
 * that belongs to us rather than assuming the first.
 */
export function recipients(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    // "Name <a@b.c>" and a bare "a@b.c" both appear.
    const angled = value.match(/<([^>]+)>/);
    const address = (angled === null ? value : angled[1]).trim().toLowerCase();
    if (address.includes("@")) out.push(address);
  }
  return out;
}

export function webhookSecret(): string | undefined {
  const secret = env.AGENTMAIL_WEBHOOK_SECRET;
  return secret === "" ? undefined : secret;
}
