import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { BUCKET_LABELS, bucketOf, formatClock, type Bucket } from "../lib/format";
import { BoardRow, type BoardCard } from "./BoardRow";
import { Icon } from "./Icon";

const BUCKET_ORDER: Bucket[] = ["overdue", "today", "week", "later", "undated"];

/**
 * The example board, readable without an account.
 *
 * A first-time visitor cannot judge a shared family board from a sign-up form,
 * and the honest ways to fill one — crawl a school site, forward it some mail —
 * both take minutes. This is the same board component with nothing to press,
 * reading one household the deployment has marked as the public example.
 *
 * Labelled as invented in two places, because a demo that looks like real
 * family data is how a demo ends up lying.
 */
export function DemoBoard() {
  const demo = useQuery(api.demo.board);
  const feed = useQuery(api.demo.feed);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // The example is written in one zone; showing it in the visitor's would slide
  // every deadline by a day for half the world.
  const timeZone = "America/Argentina/Buenos_Aires";

  const grouped = useMemo(() => {
    const groups = new Map<Bucket, BoardCard[]>();
    for (const card of (demo?.cards ?? []) as BoardCard[]) {
      const bucket = bucketOf(card.dueAt, timeZone, now);
      const list = groups.get(bucket);
      if (list === undefined) groups.set(bucket, [card]);
      else list.push(card);
    }
    return groups;
  }, [demo, now]);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-rule bg-ground/92 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-3 sm:px-7">
          <a
            href="/"
            className="focus-ring flex items-center gap-2.5 text-ballpoint"
          >
            <Icon name="backpack" size={19} strokeWidth={1.4} />
            <span className="display shrink-0 text-[16px] text-ink">Backpack</span>
          </a>
          <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-rule-strong" />
          <span className="label">Example board</span>
          <a
            href="/"
            className="focus-ring ml-auto text-[13.5px] font-medium text-ballpoint underline underline-offset-2"
          >
            Make your own
          </a>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-5 py-7 sm:px-7 lg:grid-cols-[minmax(0,1fr)_272px] lg:gap-10">
        <main className="min-w-0">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="display text-[22px]">On the board</h1>
            <p className="label">
              {demo === undefined
                ? "loading"
                : demo === null
                  ? "unavailable"
                  : `${demo.cards.length} open`}
            </p>
          </div>

          <p className="mt-3 max-w-prose text-[13.5px] leading-relaxed text-ink-soft">
            An invented family and an invented school, so you can see what
            Backpack produces without signing up. Every line was read out of a
            notice by the same pipeline the real product uses — open one to see
            the sentence it came from.
          </p>

          {demo === undefined ? null : demo === null || demo.cards.length === 0 ? (
            <p className="mt-6 text-[14px] text-ink-faint">
              This deployment has no example board configured.
            </p>
          ) : (
            <div className="mt-6">
              {BUCKET_ORDER.map((bucket) => {
                const rows = grouped.get(bucket);
                if (rows === undefined || rows.length === 0) return null;
                return (
                  <section key={bucket} className="mb-7">
                    <div className="flex items-baseline gap-3">
                      <h2
                        className={[
                          "label whitespace-nowrap",
                          bucket === "overdue" ? "!text-overdue" : "",
                        ].join(" ")}
                      >
                        {BUCKET_LABELS[bucket]}
                      </h2>
                      <span className="h-px flex-1 bg-rule" aria-hidden="true" />
                      <span className="label tabular-nums">{rows.length}</span>
                    </div>
                    <ul className="mt-1 border-t border-rule">
                      {rows.map((card) => (
                        <BoardRow
                          key={card._id}
                          card={card}
                          householdId={"" as Id<"households">}
                          timeZone={timeZone}
                          now={now}
                          currentUserId={null}
                          onAsk={() => undefined}
                          readOnly
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </main>

        <aside className="grid content-start gap-3">
          <div className="flex items-baseline gap-3">
            <span className="label whitespace-nowrap">Log</span>
            <span className="h-px flex-1 bg-rule" aria-hidden="true" />
          </div>
          {feed === undefined || feed.length === 0 ? (
            <p className="text-[13px] text-ink-faint">Nothing yet.</p>
          ) : (
            <ol className="grid gap-1.5">
              {feed.map((entry) => (
                <li
                  key={entry._id}
                  className="grid grid-cols-[auto_1fr] gap-2 text-[12px] leading-relaxed"
                >
                  <time className="font-mono text-[11px] text-ink-faint tabular-nums">
                    {formatClock(entry.at)}
                  </time>
                  <span className="text-ink-soft">{entry.message}</span>
                </li>
              ))}
            </ol>
          )}

          <p className="mt-4 border-t border-rule pt-4 text-[12px] leading-relaxed text-ink-faint">
            This page is read-only — it is the same board everyone sees, so
            nothing here can be pressed.{" "}
            <a
              href="/"
              className="focus-ring font-medium text-ballpoint underline underline-offset-2"
            >
              Sign up
            </a>{" "}
            and you can put this same example on a board of your own in one
            click, with its own address and every control live.
          </p>
        </aside>
      </div>
    </div>
  );
}
