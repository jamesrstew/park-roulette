"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { Icon } from "@/components/icons";
import { PageTitle } from "@/components/PageTitle";
import { Stars } from "@/components/Stars";
import {
  applyFix,
  confirmPark,
  dropFix,
  rejectPark,
  removeReview,
  restoreReview,
} from "@/lib/client-actions";
import type { getAdminQueue } from "@/lib/data-admin";
import { fixLine } from "@/lib/fix-words";
import { VISIBILITY_LABELS, type Visibility } from "@/lib/visibility";

type Queue = NonNullable<Awaited<ReturnType<typeof getAdminQueue>>>;

/** One button that runs an action and shows its error. */
function Act({
  label,
  run,
  tone = "paper",
}: {
  label: string;
  run: () => Promise<{ ok: boolean; error?: string }>;
  tone?: "paper" | "red" | "green";
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const bg =
    tone === "red"
      ? "bg-crayon-red text-white"
      : tone === "green"
        ? "bg-crayon-green text-white"
        : "bg-paper";
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await run();
            if (!r.ok) setError(r.error ?? "That didn't work.");
          })
        }
        className={`crayon-btn min-h-11 px-3 text-lg ${bg}`}
      >
        {pending ? "…" : label}
      </button>
      {error && <ErrorLine>{error}</ErrorLine>}
    </span>
  );
}

/** Reported reviews, suggested park fixes, new parks. */
export function AdminQueue({ queue }: { queue: Queue }) {
  const fixes = new Map<string, Queue["fixes"]>();
  for (const f of queue.fixes) {
    const k = `${f.parkId}|${f.topic}`;
    fixes.set(k, [...(fixes.get(k) ?? []), f]);
  }
  const empty = !queue.reports.length && !fixes.size && !queue.newParks.length;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        accent="Admin"
        color="red"
        underline="yellow"
        size="text-4xl"
      />
      {empty && (
        <p className="doodle-box p-4 text-center font-hand text-2xl">
          All clear! Nothing to look at.
        </p>
      )}

      {queue.reports.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-hand text-3xl">Reported reviews</h2>
          {queue.reports.map((r) => (
            <article key={r.id} className="doodle-box flex flex-col gap-2 p-4">
              <p className="font-hand text-xl leading-tight">
                {r.author} ({r.family}) on{" "}
                <Link href={`/parks/${r.slug}`} className="underline">
                  {r.park}
                </Link>
              </p>
              <p className="text-xs text-ink-soft">
                {VISIBILITY_LABELS[r.visibility as Visibility]?.label} ·{" "}
                {r.hidden ? "hidden now" : "still showing"}
              </p>
              <Stars tenths={r.ratingTenths} size={16} />
              {r.body && <p className="whitespace-pre-line">{r.body}</p>}
              {r.media.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {r.media.map((m) =>
                    m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- our own photo door
                      <img
                        key={m.id}
                        src={m.url}
                        alt=""
                        className="aspect-square w-full rounded border-2 border-ink object-cover"
                      />
                    ) : (
                      <video
                        key={m.id}
                        src={m.url}
                        controls
                        playsInline
                        className="aspect-square w-full rounded border-2 border-ink"
                      />
                    ),
                  )}
                </div>
              )}
              <ul className="text-sm">
                {r.reasons.map((x, i) => (
                  <li key={i} className="flex items-center gap-1">
                    <Icon name="warning" size={16} /> {x.label}
                    {x.note ? `: “${x.note}”` : ""}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Act
                  label="It's fine"
                  tone="green"
                  run={() => restoreReview(r.id)}
                />
                <Act
                  label="Take it down"
                  tone="red"
                  run={() => removeReview(r.id)}
                />
              </div>
            </article>
          ))}
        </section>
      )}

      {fixes.size > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-hand text-3xl">Suggested park fixes</h2>
          {[...fixes.values()].map((votes) => {
            const f = votes[0];
            const counts = new Map<string, number>();
            for (const v of votes)
              counts.set(v.value, (counts.get(v.value) ?? 0) + 1);
            return (
              <article
                key={`${f.parkId}|${f.topic}`}
                className="doodle-box-alt flex flex-col gap-2 p-4"
              >
                <Link
                  href={`/parks/${f.slug}`}
                  className="font-hand text-xl underline"
                >
                  {f.park}
                </Link>
                {[...counts].map(([value, n]) => (
                  <div
                    key={value}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="flex-1">
                      {fixLine(f.topic, value)} ({n}{" "}
                      {n === 1 ? "family" : "families"})
                    </span>
                    <Act
                      label="Make it so"
                      tone="green"
                      run={() =>
                        applyFix({ parkId: f.parkId, topic: f.topic, value })
                      }
                    />
                  </div>
                ))}
                {votes
                  .filter((v) => v.note)
                  .map((v, i) => (
                    <p key={i} className="text-sm italic">
                      “{v.note}”
                    </p>
                  ))}
                <Act
                  label="Turn it down"
                  run={() => dropFix({ parkId: f.parkId, topic: f.topic })}
                />
              </article>
            );
          })}
        </section>
      )}

      {queue.newParks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-hand text-3xl">New parks to confirm</h2>
          {queue.newParks.map((p) => (
            <article
              key={p.id}
              className="doodle-box-alt flex flex-col gap-2 p-4"
            >
              <Link
                href={`/parks/${p.slug}`}
                className="font-hand text-xl underline"
              >
                {p.name}, {p.city}
              </Link>
              {p.notes && <p className="text-sm italic">“{p.notes}”</p>}
              <div className="flex flex-wrap gap-2">
                <Act
                  label="It's real"
                  tone="green"
                  run={() => confirmPark(p.id)}
                />
                <Act
                  label="Not a park"
                  tone="red"
                  run={() => rejectPark(p.id)}
                />
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
