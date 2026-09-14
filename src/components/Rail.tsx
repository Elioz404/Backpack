import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatClock } from "../lib/format";
import { childColor } from "../lib/kinds";
import { Icon } from "./Icon";
import { Button, Chip, Input, RuledHeading, Spinner } from "./ui";

/**
 * The household's own sheet: its address, its children, the sites it watches,
 * and a running log of what has happened.
 *
 * Everything here is a setting *and* a control — the address is also the thing
 * you copy, the school is also the button that reads it — because a family
 * will open this twice a term and should not have to find a settings page.
 */
export function Rail({
  householdId,
  inboxAddress,
}: {
  householdId: Id<"households">;
  inboxAddress: string | null;
}) {
  return (
    <aside className="grid content-start gap-7">
      <InboxCard householdId={householdId} inboxAddress={inboxAddress} />
      <ChildrenCard householdId={householdId} />
      <SchoolsCard householdId={householdId} />
      <UnreadCard householdId={householdId} />
      <ActivityLog householdId={householdId} />
    </aside>
  );
}

function InboxCard({
  householdId,
  inboxAddress,
}: {
  householdId: Id<"households">;
  inboxAddress: string | null;
}) {
  const ensure = useAction(api.inbox.ensure);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getAddress() {
    setBusy(true);
    setError(null);
    try {
      await ensure({ householdId });
    } catch {
      setError("Could not reach AgentMail. Check the deployment key.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (inboxAddress === null) return;
    try {
      await navigator.clipboard.writeText(inboxAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Your browser would not let us copy that.");
    }
  }

  return (
    <section className="grid gap-3">
      <RuledHeading>Your address</RuledHeading>

      {inboxAddress === null ? (
        <>
          <p className="text-[13px] leading-relaxed text-ink-soft">
            Give this household an address, then set the school mail to forward
            to it. Everything that arrives gets read onto the board.
          </p>
          <Button
            onClick={getAddress}
            disabled={busy}
            icon={busy ? <Spinner /> : <Icon name="mail" size={14} />}
          >
            {busy ? "Asking…" : "Get an address"}
          </Button>
        </>
      ) : (
        <>
          <div className="sheet flex items-center gap-2 px-2.5 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
              {inboxAddress}
            </code>
            <button
              type="button"
              onClick={copy}
              title="Copy address"
              className="focus-ring shrink-0 rounded-[2px] p-1 text-ink-faint hover:text-ballpoint"
            >
              <Icon name={copied ? "check" : "copy"} size={14} />
            </button>
          </div>
          <p className="text-[12px] leading-relaxed text-ink-faint">
            {copied
              ? "Copied. Forward the school's mail here."
              : "Forward school mail here — or set it as a forwarding rule once and forget it."}
          </p>
        </>
      )}

      {error ? <p className="text-[12px] text-overdue">{error}</p> : null}
    </section>
  );
}

function ChildrenCard({ householdId }: { householdId: Id<"households"> }) {
  const children = useQuery(api.children.list, { householdId });
  const add = useMutation(api.children.add);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    setAdding(true);
    try {
      await add({ householdId, name: trimmed });
      setName("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="grid gap-3">
      <RuledHeading trailing={children ? String(children.length) : undefined}>
        Children
      </RuledHeading>

      {children === undefined ? (
        <p className="text-[13px] text-ink-faint">Loading…</p>
      ) : children.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-ink-soft">
          Add their names and Backpack can tell which notice is about which
          child.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
          {children.map((child) => (
            <li key={child._id}>
              <Chip color={childColor(child.colorKey)}>{child.name}</Chip>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex items-end gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Add a name"
          aria-label="Child's name"
          className="text-[13.5px]"
        />
        <Button
          type="submit"
          size="sm"
          tone="ghost"
          disabled={adding || name.trim() === ""}
          aria-label="Add child"
        >
          <Icon name="plus" size={14} />
        </Button>
      </form>
    </section>
  );
}

function SchoolsCard({ householdId }: { householdId: Id<"households"> }) {
  const schools = useQuery(api.schools.list, { householdId });
  const progress = useQuery(api.crawls.progress, { householdId });
  const add = useMutation(api.schools.add);
  const start = useAction(api.crawls.start);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = progress?.status === "running" || progress?.status === "scraping";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await add({ householdId, name: name.trim(), siteUrl: url.trim() });
      setName("");
      setUrl("");
    } catch {
      setError("That did not look like a web address.");
    } finally {
      setBusy(false);
    }
  }

  async function read(schoolId: Id<"schools">) {
    setBusy(true);
    setError(null);
    try {
      await start({ householdId, schoolId });
    } catch {
      setError("Could not start reading. Check the Firecrawl key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3">
      <RuledHeading>School sites</RuledHeading>

      {schools === undefined ? (
        <p className="text-[13px] text-ink-faint">Loading…</p>
      ) : schools.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-ink-soft">
          Point Backpack at the school&rsquo;s website. It reads the calendar,
          the newsletters and the handbook, and keeps watching them.
        </p>
      ) : (
        <ul className="grid gap-2">
          {schools.map((school) => (
            <li key={school._id} className="sheet grid gap-2 px-2.5 py-2">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-ink">
                  {school.name}
                </p>
                <p className="truncate font-mono text-[11px] text-ink-faint">
                  {school.siteUrl.replace(/^https?:\/\//, "")}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => read(school._id)}
                disabled={busy || running}
                icon={
                  running ? <Spinner /> : <Icon name="reading" size={13} />
                }
              >
                {running ? "Reading…" : "Read the site"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {progress !== undefined && progress !== null && running ? (
        <CrawlTicker
          completed={progress.completed}
          total={progress.total}
          creditsUsed={progress.creditsUsed}
        />
      ) : null}

      <form onSubmit={submit} className="grid gap-2 border-t border-rule pt-3">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="School name"
          aria-label="School name"
          className="text-[13.5px]"
        />
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://school.example.edu"
          aria-label="School website"
          spellCheck={false}
          className="text-[13.5px]"
        />
        <Button
          type="submit"
          size="sm"
          tone="ghost"
          disabled={busy || name.trim() === "" || url.trim() === ""}
          icon={<Icon name="plus" size={13} />}
          className="justify-self-start"
        >
          Add a site
        </Button>
        {error ? <p className="text-[12px] text-overdue">{error}</p> : null}
      </form>
    </section>
  );
}

/**
 * A crawl in flight.
 *
 * Shown as a page count against a rule rather than a percentage bar: a crawl
 * discovers its own size as it goes, so a percentage would jump around and
 * lie. The count is the honest number, and it moves on both parents' screens
 * because it is a live query over the component's own crawl row.
 */
function CrawlTicker({
  completed,
  total,
  creditsUsed,
}: {
  completed: number;
  total: number;
  creditsUsed: number | null;
}) {
  const fraction = total > 0 ? Math.min(1, completed / total) : 0;
  return (
    <div className="grid gap-1.5" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between font-mono text-[11.5px] text-ink-soft">
        <span className="tabular-nums">
          {completed}
          <span className="text-ink-faint"> / {total || "?"} pages</span>
        </span>
        {creditsUsed !== null ? (
          <span className="text-ink-faint tabular-nums">
            {creditsUsed} credits
          </span>
        ) : null}
      </div>
      <div className="h-px w-full bg-rule">
        <div
          className="h-px bg-ballpoint transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Pages that reached the household but could not be read.
 *
 * Shown only when there are some. A board quietly missing a third of the
 * term's notices looks identical to a board with nothing on it, so the gap is
 * stated plainly, with the reason and a way to try again — the pages are
 * already stored, so this costs no crawl.
 */
function UnreadCard({ householdId }: { householdId: Id<"households"> }) {
  const health = useQuery(api.sources.health, { householdId });
  const retry = useMutation(api.sources.retryUnread);
  const [busy, setBusy] = useState(false);

  if (health === undefined) return null;
  if (health.unread === 0) return null;

  return (
    <section className="grid gap-3">
      <RuledHeading trailing={String(health.unread)}>Not read yet</RuledHeading>

      <p className="text-[13px] leading-relaxed text-ink-soft">
        {health.unread} page{health.unread === 1 ? "" : "s"} reached your
        household but {health.unread === 1 ? "has" : "have"} not been read onto
        the board.
      </p>

      {health.lastError !== null ? (
        <p className="font-mono text-[11px] leading-relaxed break-words text-ink-faint">
          {health.lastError.slice(0, 180)}
        </p>
      ) : null}

      <Button
        size="sm"
        disabled={busy}
        icon={busy ? <Spinner /> : <Icon name="undo" size={13} />}
        onClick={async () => {
          setBusy(true);
          try {
            await retry({ householdId });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Queueing…" : "Try reading again"}
      </Button>
    </section>
  );
}

function ActivityLog({ householdId }: { householdId: Id<"households"> }) {
  const feed = useQuery(api.board.feed, { householdId, limit: 14 });

  return (
    <section className="grid gap-3">
      <RuledHeading>Log</RuledHeading>
      {feed === undefined ? (
        <p className="text-[13px] text-ink-faint">Loading…</p>
      ) : feed.length === 0 ? (
        <p className="text-[13px] text-ink-faint">
          Nothing has happened yet.
        </p>
      ) : (
        <ol className="grid gap-1.5">
          {feed.map((entry) => (
            <li
              key={entry._id}
              className="settle grid grid-cols-[auto_1fr] gap-2 text-[12px] leading-relaxed"
            >
              <time className="font-mono text-[11px] text-ink-faint tabular-nums">
                {formatClock(entry.at)}
              </time>
              <span className="text-ink-soft">
                {entry.message}
                {entry.actor !== null ? (
                  <span className="text-ink-faint"> · {entry.actor}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
