import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { getMe } from "@/lib/data";
import { linkName, POST_KINDS } from "@/lib/growth/analyze";
import { collectWeek } from "@/lib/growth/collect";
import { viewFor, webUrl } from "@/lib/growth/digest";
import { liveSources } from "@/lib/growth/live";
import { GROUPS, SOURCE_LABELS, SOURCE_NAMES } from "@/lib/growth/model";
import { renderHtml } from "@/lib/growth/render";
import { loadSnapshots, storedWeeks } from "@/lib/growth/store";
import {
  isMonday,
  lastFullWeek,
  mondayOn,
  weekLabel,
  weekOf,
} from "@/lib/growth/week";

export const metadata: Metadata = {
  title: "Growth",
  robots: { index: false, follow: false },
};

/**
 * The growth digest's web view (admins only, like /admin): the same email
 * as sent, then the detail behind every number. ?week=<a Monday> picks a
 * stored week; ?week=now gathers this week so far (not stored).
 */
async function Growth({ params }: { params: Promise<{ week?: string }> }) {
  const me = await getMe();
  if (!me?.isAdmin || !me.trusted) notFound();
  const { week: asked } = await params;
  const weeks = await storedWeeks(12);
  const now = new Date();
  const so = asked === "now";
  const start = so
    ? mondayOn(now)
    : asked && isMonday(asked)
      ? asked
      : (weeks[0] ?? lastFullWeek(now).start);
  const [stored] = so ? [] : await loadSnapshots([start]);
  const cur =
    stored ??
    (await collectWeek(weekOf(start), { live: true, ...liveSources }));
  const { view } = await viewFor(cur);
  const d = cur.details;
  const html = renderHtml(view, { webUrl: webUrl(start) });

  return (
    <div className="flex flex-col gap-8 pb-32">
      <header className="flex flex-col gap-2">
        <h1 className="font-hand text-4xl">Weekly growth</h1>
        <p className="text-ink-soft">
          Week of {weekLabel(weekOf(start))}
          {so
            ? " (so far, not stored)"
            : stored
              ? ""
              : " (gathered now, not stored)"}
          {cur.backfilled ? " (rebuilt later)" : ""}
        </p>
        <nav className="flex flex-wrap gap-2 text-sm">
          <Link className="chip" href="/admin/growth?week=now">
            This week so far
          </Link>
          {weeks.map((w) => (
            <Link
              key={w}
              className={`chip ${w === start && !so ? "bg-crayon-yellow" : ""}`}
              href={`/admin/growth?week=${w}`}
            >
              {weekLabel(weekOf(w))}
            </Link>
          ))}
        </nav>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-hand text-2xl">The email</h2>
        <iframe
          title="The growth digest email"
          srcDoc={html}
          sandbox=""
          className="h-[1400px] w-full rounded-xl border-2 border-ink bg-white"
        />
      </section>

      {d.daily?.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-hand text-2xl">Visitors by day</h2>
          <DailyChart daily={d.daily} />
          <p className="text-xs text-ink-soft">
            Vercel&apos;s days are UTC, so a day here starts at 4 or 5 pm
            Pacific the day before.
          </p>
        </section>
      ) : null}

      <Grid>
        <Table
          title="Visitors by source"
          rows={Object.entries(d.sources ?? {}).map(([k, n]) => [
            SOURCE_NAMES[k] ?? k,
            n,
          ])}
        />
        <Table
          title="Referring sites"
          rows={(d.referrers ?? []).map((r) => [r.host, r.visitors])}
        />
        <Table
          title="Arrived from our links"
          rows={Object.entries(d.arrivedBy ?? {}).map(([k, n]) => [k, n])}
          empty="No arrivals counted yet (the Arrived event is new)."
        />
        <Table
          title="Where people went (page views)"
          rows={(d.pathGroups ?? []).map((g) => [g.group, g.pageviews])}
        />
        <Table
          title="Top pages (page views)"
          rows={(d.topPaths ?? []).map((p) => [p.path, p.pageviews])}
        />
        <Table
          title="Browser events"
          rows={Object.entries(d.events ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => [k, n])}
        />
        <Table
          title="Email sign-ups by where"
          rows={Object.entries(d.emailBySource ?? {}).map(([k, n]) => [
            SOURCE_LABELS[k] ?? k,
            n,
          ])}
        />
        <Table
          title="Text sign-ups by where"
          rows={Object.entries(d.textsBySource ?? {}).map(([k, n]) => [
            SOURCE_LABELS[k] ?? k,
            n,
          ])}
        />
        <Table
          title={
            d.issue
              ? `Newsletter link taps (${d.issue.date}, ${d.issue.sent} sent)`
              : "Newsletter link taps"
          }
          rows={(d.issue?.links ?? []).map((l) => [linkName(l.slug), l.clicks])}
          empty="No issue went out this week."
        />
        <Table
          title="Alerts that emailed"
          rows={(d.alertKeys ?? []).map((k) => [k, ""])}
          empty="None."
        />
      </Grid>

      <section className="flex flex-col gap-2">
        <h2 className="font-hand text-2xl">Posts this week</h2>
        {d.posts?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-soft">
                <tr>
                  {[
                    "Day",
                    "Post",
                    "Reach",
                    "Views",
                    "Saves",
                    "Shares",
                    "Likes",
                    "Comments",
                  ].map((h) => (
                    <th key={h} className="py-1 pr-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.posts.map((p) => (
                  <tr key={p.id} className="border-t border-ink/15">
                    <td className="py-1 pr-3">{p.day}</td>
                    <td className="py-1 pr-3">
                      {POST_KINDS[p.kind] ?? p.kind}
                    </td>
                    {[
                      p.reach,
                      p.views,
                      p.saved,
                      p.shares,
                      p.likes,
                      p.comments,
                    ].map((x, i) => (
                      <td key={i} className="py-1 pr-3 tabular-nums">
                        {x ?? "–"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-ink-soft">No posts went out this week.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-hand text-2xl">Every number</h2>
        {GROUPS.map((g) => (
          <div key={g} className="flex flex-col">
            <h3 className="mt-3 font-bold">{g}</h3>
            {view.rows
              .filter((r) => r.group === g)
              .map((r) => (
                <div
                  key={r.key}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-t border-ink/15 py-2 text-sm"
                >
                  <div>
                    <p className="font-bold">{r.label}</p>
                    <p className="text-xs text-ink-soft">
                      {r.definition} Source: {r.source}.
                    </p>
                  </div>
                  <span className="text-right font-bold tabular-nums">
                    {r.value ?? "–"}
                  </span>
                  <span
                    className={`w-24 text-right text-xs ${r.tone === "good" ? "text-crayon-green" : r.tone === "bad" ? "text-crayon-red" : "text-ink-soft"}`}
                  >
                    {r.change}
                  </span>
                  <Spark series={r.series} />
                </div>
              ))}
          </div>
        ))}
      </section>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function Table({
  title,
  rows,
  empty = "Nothing measured.",
}: {
  title: string;
  rows: [string, number | string][];
  empty?: string;
}) {
  return (
    <section className="doodle-box p-3">
      <h3 className="mb-2 font-bold">{title}</h3>
      {rows.length ? (
        <ul className="flex flex-col gap-1 text-sm">
          {rows.map(([k, n]) => (
            <li key={k} className="flex justify-between gap-3">
              <span className="min-w-0 break-words">{k || "(none)"}</span>
              <span className="tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">{empty}</p>
      )}
    </section>
  );
}

/** Four weeks as bars (inline SVG). */
function Spark({ series }: { series: (number | null)[] }) {
  const max = Math.max(1, ...series.map((x) => x ?? 0));
  return (
    <svg width="40" height="18" viewBox="0 0 40 18" aria-hidden>
      {series.map((x, i) => {
        const h = x == null ? 2 : Math.max(2, (x / max) * 18);
        return (
          <rect
            key={i}
            x={i * 10}
            y={18 - h}
            width="7"
            height={h}
            rx="1"
            fill={
              x == null
                ? "#d9d2c3"
                : i === series.length - 1
                  ? "#2f78d4"
                  : "#a9c4e8"
            }
          />
        );
      })}
    </svg>
  );
}

function DailyChart({
  daily,
}: {
  daily: { day: string; visitors: number; pageviews: number }[];
}) {
  const max = Math.max(1, ...daily.map((d) => d.visitors));
  const W = 320;
  const bw = W / daily.length;
  return (
    <svg
      viewBox={`0 0 ${W} 120`}
      className="w-full max-w-xl"
      role="img"
      aria-label="Visitors by day"
    >
      {daily.map((d, i) => {
        const h = (d.visitors / max) * 90;
        return (
          <g key={d.day}>
            <rect
              x={i * bw + 4}
              y={95 - h}
              width={bw - 8}
              height={Math.max(1, h)}
              rx="2"
              fill="#2f78d4"
            />
            <text
              x={i * bw + bw / 2}
              y={92 - h}
              textAnchor="middle"
              fontSize="9"
              fill="#2b2a33"
            >
              {d.visitors}
            </text>
            <text
              x={i * bw + bw / 2}
              y={110}
              textAnchor="middle"
              fontSize="8"
              fill="#5d5a6b"
            >
              {d.day.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function GrowthPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  return (
    <Suspense fallback={<CrayonLoading label="Counting everything…" />}>
      <Growth params={searchParams} />
    </Suspense>
  );
}
