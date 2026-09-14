import usePresence from "@convex-dev/presence/react";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { initials } from "../lib/format";

/**
 * Who is looking at this board.
 *
 * Inked initials rather than avatars: nobody uploads a photo to a school
 * admin tool, and a grey silhouette would say less than two letters do. The
 * point is only to answer "is the other parent here right now?" — which is
 * what stops both of them doing the same errand.
 */
export function Facepile({
  householdId,
  userId,
  members,
}: {
  householdId: Id<"households">;
  userId: Id<"users">;
  members: { userId: Id<"users">; displayName: string }[];
}) {
  const state = usePresence(api.presence, householdId, userId);

  const names = useMemo(
    () => new Map(members.map((member) => [member.userId, member.displayName])),
    [members],
  );

  const online = (state ?? []).filter((entry) => entry.online);
  if (online.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      <ul className="flex -space-x-1.5">
        {online.slice(0, 4).map((entry) => {
          const name = names.get(entry.userId as Id<"users">) ?? "Someone";
          const isYou = entry.userId === userId;
          return (
            <li key={entry.userId}>
              <span
                title={isYou ? `${name} (you)` : name}
                className={[
                  "grid h-6 w-6 place-items-center rounded-full border font-mono text-[10px] font-medium",
                  isYou
                    ? "border-ballpoint bg-ballpoint text-sheet"
                    : "border-rule-strong bg-sheet text-ink-soft",
                ].join(" ")}
              >
                {initials(name)}
              </span>
            </li>
          );
        })}
      </ul>
      {online.length > 1 ? (
        <span className="label hidden sm:inline">both here</span>
      ) : null}
    </div>
  );
}
