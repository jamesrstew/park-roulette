"use client";

import { useMemo, useState, useTransition } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { removeEvent, splitEvent, trimEventDates } from "@/lib/client-actions";

type AdminEvent = {
  id: number;
  slug: string;
  title: string;
  venue: string;
  town: string;
  kind: string;
  confirm: string;
  dates: { id: string; day: string; start?: string; url: string }[];
};

type Edit = {
  id: number;
  slug: string;
  action: string;
  at: string;
  by: number | null;
  what: string;
};

/**
 * Kids' events repairs: find a wrong page, then take dates off it (Trim),
 * move dates to their own page under their real title and venue (Split
 * off), or delete it (Remove). Every repair is logged with who did it.
 */
export function AdminEvents({
  events,
  edits,
}: {
  events: AdminEvent[];
  edits: Edit[];
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const hits = t
      ? events.filter((e) =>
          `${e.slug} ${e.title} ${e.venue} ${e.town}`.toLowerCase().includes(t),
        )
      : events;
    return hits.slice(0, 40);
  }, [q, events]);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-hand text-3xl">Kids&apos; events</h2>
      <p className="text-sm text-ink-soft">
        {events.length} event pages. Fix a wrong one here, never with SQL.
      </p>
      <input
        className="field min-h-11"
        placeholder="Find an event (slug, title, venue)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="flex flex-col gap-2">
        {shown.map((e) => (
          <li key={e.id} className="doodle-box p-3 text-sm">
            <button
              type="button"
              className="flex min-h-11 w-full items-baseline justify-between gap-2 text-left"
              onClick={() => setOpen(open === e.id ? null : e.id)}
              aria-expanded={open === e.id}
            >
              <span className="min-w-0">
                <b className="block truncate">{e.title}</b>
                <span className="block truncate text-ink-soft">
                  {e.venue}, {e.town} · /events/{e.slug}
                </span>
              </span>
              <span className="chip shrink-0 text-xs">
                {e.dates.length} {e.dates.length === 1 ? "date" : "dates"}
                {e.confirm === "ok" ? "" : " · unconfirmed"}
              </span>
            </button>
            {open === e.id ? <Repair event={e} /> : null}
          </li>
        ))}
      </ul>
      {edits.length ? (
        <div className="flex flex-col gap-1">
          <h3 className="font-hand text-2xl">Recent repairs</h3>
          <ul className="flex flex-col gap-1 text-sm text-ink-soft">
            {edits.map((x) => (
              <li key={x.id}>
                {x.at} · {x.action} · {x.slug}: {x.what}
                {x.by ? ` (explorer ${x.by})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Repair({ event: e }: { event: AdminEvent }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState(e.title);
  const [venue, setVenue] = useState(e.venue);
  const [town, setTown] = useState(e.town);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ids = [...picked];
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const run = (
    label: string,
    f: () => Promise<{ ok: boolean; error?: string }>,
  ) =>
    start(async () => {
      setError(null);
      setDone(null);
      const r = await f();
      if (!r.ok) setError(r.error ?? "That didn't work.");
      else {
        setDone(label);
        setPicked(new Set());
      }
    });
  return (
    <div className="mt-2 flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1">
        <legend className="font-hand text-lg">Dates</legend>
        {e.dates.map((d) => (
          <label key={d.id} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-6"
              checked={picked.has(d.id)}
              onChange={() => toggle(d.id)}
            />
            <span>
              {d.day}
              {d.start ? ` ${d.start}` : ""}{" "}
              <a
                className="underline"
                href={d.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                page
              </a>
            </span>
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        className="crayon-btn min-h-11 bg-crayon-yellow px-4"
        disabled={pending || !ids.length}
        onClick={() =>
          confirm(`Take ${ids.length} date(s) off ${e.slug}?`) &&
          run("Dates taken off.", () => trimEventDates(e.id, ids))
        }
      >
        <span className="wax">Trim {ids.length || ""} dates</span>
      </button>
      <div className="flex flex-col gap-2">
        <p className="font-hand text-lg">
          Split the picked dates off to their own page
        </p>
        <input
          className="field min-h-11"
          aria-label="Title"
          value={title}
          onChange={(x) => setTitle(x.target.value)}
        />
        <input
          className="field min-h-11"
          aria-label="Venue"
          value={venue}
          onChange={(x) => setVenue(x.target.value)}
        />
        <input
          className="field min-h-11"
          aria-label="Town"
          value={town}
          onChange={(x) => setTown(x.target.value)}
        />
        <button
          type="button"
          className="crayon-btn min-h-11 bg-crayon-blue px-4"
          disabled={pending || !ids.length}
          onClick={() =>
            confirm(
              `Move ${ids.length} date(s) to "${title}" at ${venue}, ${town}?`,
            ) &&
            run("Split off.", () =>
              splitEvent(e.id, ids, {
                title,
                venueName: venue,
                venueTown: town,
              }),
            )
          }
        >
          <span className="wax">Split off {ids.length || ""} dates</span>
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <input
          className="field min-h-11"
          placeholder="Why remove it? (logged)"
          value={reason}
          onChange={(x) => setReason(x.target.value)}
        />
        <button
          type="button"
          className="crayon-btn min-h-11 bg-crayon-red px-4"
          disabled={pending || reason.trim().length < 3}
          onClick={() =>
            confirm(`Remove ${e.slug} for good? Its page goes away.`) &&
            run("Removed.", () => removeEvent(e.id, reason))
          }
        >
          <span className="wax">Remove this event</span>
        </button>
      </div>
      {done ? <p className="text-sm">{done}</p> : null}
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </div>
  );
}
