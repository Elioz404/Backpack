import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { BUCKET_LABELS, bucketOf, type Bucket } from "../lib/format";
import { AskDialog } from "./AskDialog";
import { BoardRow, type BoardCard } from "./BoardRow";
import { Facepile } from "./Facepile";
import { Icon } from "./Icon";
import { Rail } from "./Rail";
import { Button, Spinner } from "./ui";

const BUCKET_ORDER: Bucket[] = ["overdue", "today", "week", "later", "undated"];

/**
 * The board.
 *
 * An agenda, not a card grid: one ruled column of lines in the order a family
 * will meet them, grouped by how soon. Everything on screen comes from two
 * live queries, so when the pipeline adds a line or the other parent takes
 * one, it changes here without anything asking again.
 */
export function Board({
  householdId,
  userId,
  onSignOut,
}: {
  householdId: Id<"households">;
  userId: Id<"users">;
  onSignOut: () => void;
}) {
  const household = useQuery(api.households.get, { householdId });
  const cards = useQuery(api.board.cards, { householdId });
  const [asking, setAsking] = useState<BoardCard | null>(null);

  // Bucket boundaries are relative to "now", so the board re-groups itself as
  // the day turns rather than going stale until someone reloads.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const timeZone = household?.timeZone ?? "UTC";

  const grouped = useMemo(() => {
    const groups = new Map<Bucket, BoardCard[]>();
    for (const card of (cards ?? []) as BoardCard[]) {
      const bucket = bucketOf(card.dueAt, timeZone, now);
      const list = groups.get(bucket);
      if (list === undefined) groups.set(bucket, [card]);
      else list.push(card);
    }
    return groups;
  }, [cards, timeZone, now]);

  const total = cards?.length ?? 0;
  const claimed = (cards ?? []).filter(
    (card) => card.claimedBy !== null,
  ).length;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-rule bg-ground/92 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-3 sm:px-7 2xl:max-w-[80rem]">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="text-ballpoint">
              <Icon name="backpack" size={19} strokeWidth={1.4} />
            </span>
            <span className="display shrink-0 text-[16px]">Backpack</span>
            {household ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-3.5 w-px shrink-0 bg-rule-strong"
                />
                <span className="truncate text-[14px] text-ink-soft">
                  {household.name}
                </span>
              </>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {household ? (
              <Facepile
                householdId={householdId}
                userId={userId}
                members={household.members}
              />
            ) : null}
            <Button size="sm" tone="ghost" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/*
        Capped for reading, but not at one width forever. On a 1080p monitor a
        64rem column leaves more than half the screen empty and the board
        looks like a phone app someone stretched a window around; 80rem from
        the 2xl breakpoint fills it without letting a row grow so wide that
        the title and its date stop looking like the same line.
      */}
      <div className="mx-auto grid max-w-5xl gap-8 px-5 py-7 sm:px-7 lg:grid-cols-[minmax(0,1fr)_272px] lg:gap-10 2xl:max-w-[80rem] 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="display text-[22px]">On the board</h1>
            <p className="label">
              {total === 0
                ? "nothing yet"
                : `${total} open${claimed > 0 ? ` · ${claimed} taken` : ""}`}
            </p>
          </div>

          {cards === undefined ? (
            <Skeleton />
          ) : total === 0 ? (
            <EmptyBoard householdId={householdId} />
          ) : (
            <div className="mt-5">
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
                      <span
                        className="h-px flex-1 bg-rule"
                        aria-hidden="true"
                      />
                      <span className="label tabular-nums">{rows.length}</span>
                    </div>

                    <ul className="mt-1 border-t border-rule">
                      {rows.map((card) => (
                        <BoardRow
                          key={card._id}
                          card={card}
                          householdId={householdId}
                          timeZone={timeZone}
                          now={now}
                          currentUserId={userId}
                          onAsk={setAsking}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </main>

        <div>
          <Rail
            householdId={householdId}
            inboxAddress={household?.inboxAddress ?? null}
          />
        </div>
      </div>

      <AskDialog
        householdId={householdId}
        card={asking}
        onClose={() => setAsking(null)}
      />
    </div>
  );
}

/**
 * The empty board is the instruction manual. A family arrives here with
 * nothing, and the two things that fill it are the two things to explain.
 */
function EmptyBoard({ householdId }: { householdId: Id<"households"> }) {
  const fill = useMutation(api.households.fillWithExample);
  const [filling, setFilling] = useState(false);

  return (
    <div className="ruled mt-5 border-t border-rule py-10">
      <div className="max-w-md">
        <h2 className="display text-[19px]">Nothing on it yet.</h2>
        <p className="mt-2.5 text-[14px] leading-relaxed text-ink-soft">
          Backpack fills this from two places, and you only have to set each one
          up once.
        </p>
        <ol className="mt-6 grid gap-4">
          <li className="flex gap-3">
            <span className="label mt-1 shrink-0 tabular-nums">01</span>
            <p className="text-[13.5px] leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">
                Add the school&rsquo;s website
              </span>{" "}
              and press read. It works through the calendar, the newsletters and
              the handbook, and keeps watching them each week.
            </p>
          </li>
          <li className="flex gap-3">
            <span className="label mt-1 shrink-0 tabular-nums">02</span>
            <p className="text-[13.5px] leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">Get your address</span> and
              forward the school mail to it. Every notice that arrives is read
              onto this board.
            </p>
          </li>
        </ol>

        <div className="mt-8 border-t border-rule pt-6">
          <p className="text-[13.5px] leading-relaxed text-ink-soft">
            Or put an invented family on it now, and press the buttons. It is
            your board — nobody else sees it, and you can clear it by
            dismissing the cards.
          </p>
          <Button
            className="mt-3"
            disabled={filling}
            icon={filling ? <Spinner /> : <Icon name="quote" size={14} />}
            onClick={async () => {
              setFilling(true);
              try {
                await fill({ householdId });
              } finally {
                setFilling(false);
              }
            }}
          >
            {filling ? "Filling…" : "Fill it with an example"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-5 border-t border-rule" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="grid grid-cols-[3px_1fr] gap-3.5 border-b border-rule py-4"
        >
          <span className="rounded-l-[2px] bg-rule" />
          <div className="grid gap-2">
            <div
              className="h-2 rounded-full bg-rule"
              style={{ width: `${28 + index * 9}%` }}
            />
            <div
              className="h-2 rounded-full bg-rule/60"
              style={{ width: `${46 + index * 7}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
