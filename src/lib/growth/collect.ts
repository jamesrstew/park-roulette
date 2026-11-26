import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { PLACES_PER_DAY } from "@/lib/social/store";
import {
  accountFollowers,
  accountInsights,
  pageFollowers,
  postInsights,
} from "@/lib/social/graph";
import { graphOpts, pageIdEnv } from "@/lib/social/settings";
import { WEEKEND_PICK_CLICK, WEEKEND_PICK_TAP } from "@/lib/weekend-pick";
import type { Details, Metrics, Snapshot } from "./model";
import { alertKind } from "./analyze";
import { applyTraffic, readTraffic, vercelConfig } from "./vercel";
import type { Week } from "./week";

/**
 * Gather one week's numbers from the database, Vercel Web Analytics and
 * Meta. Aggregates only: every query returns counts and labels, never an
 * address, a number, a name or an IP. Light queries (each one an indexed
 * or small-table count), so it's safe on the production database.
 *
 * `live`: also read what only exists now (followers, listings, the
 * sitemap). A backfilled week leaves those null. Any source that fails
 * leaves its metrics null and names itself in details.missing: the
 * digest still goes.
 */

/** Metrics that only mean something when read at the time (see above). */
export const AS_OF_NOW = [
  "email_clicks",
  "text_clicks",
  "email_pending",
  "event_saves",
  "event_hides",
  "both_lists",
] as const;

/** Vercel Web Analytics began counting (components/SiteAnalytics.tsx). */
export const ANALYTICS_SINCE = new Date("2026-11-13T08:00:00Z");

type Row = Record<string, unknown>;
const rows = async (q: SQL): Promise<Row[]> =>
  (await db.execute(q)) as unknown as Row[];
const one = async (q: SQL): Promise<Row> => (await rows(q))[0] ?? {};
const n = (v: unknown): number => Number(v ?? 0) || 0;

export type CollectOptions = {
  /** Read live-only sources (followers, sitemap). False for a backfill. */
  live: boolean;
  fetchImpl?: typeof fetch;
  /** The sitemap, injected (the route passes the app's; tests stub it). */
  sitemap?: () => Promise<{ url: string }[]>;
  /** Upcoming event pages right now (the route passes the store's). */
  eventsListed?: () => Promise<number>;
};

export async function collectWeek(
  week: Week,
  o: CollectOptions,
): Promise<Snapshot> {
  const from = week.from.toISOString();
  const to = week.to.toISOString();
  const metrics: Metrics = {};
  const details: Details = {
    missing: [],
    // Gathered before the week was over (the web view's "so far").
    partial: Date.now() < week.to.getTime(),
  };
  const missing = details.missing!;
  const F = sql`${from}::timestamptz`;
  const T = sql`${to}::timestamptz`;
  const inWeek = (col: SQL) => sql`${col} >= ${F} and ${col} < ${T}`;

  const tasks: Promise<void>[] = [];
  const task = (name: string, fn: () => Promise<void>) =>
    tasks.push(
      fn().catch((e) => {
        console.error(`[growth] ${name} failed`, (e as Error)?.message);
        missing.push(`${name}: couldn't be read this run`);
      }),
    );

  // --- Families and activation ------------------------------------------
  task("families", async () => {
    const r = await one(sql`
      select
        (select count(*) from crews where ${inWeek(sql`created_at`)}) as families_new,
        (select count(*) from crews where created_at < ${T}) as families_total,
        (select count(*) from explorers where not is_kid and ${inWeek(sql`created_at`)}) as grownups_new,
        (select count(*) from explorers where is_kid and ${inWeek(sql`created_at`)}) as kids_new,
        (select count(*) from explorers where ${inWeek(sql`phone_verified_at`)}) as phones_verified,
        (select count(*) from visits where ${inWeek(sql`created_at`)}) as stamps,
        (select count(*) from reviews where ${inWeek(sql`created_at`)}) as reviews,
        (select count(*) from media where ${inWeek(sql`created_at`)}) as photos,
        (select count(*) from event_saves where ${inWeek(sql`created_at`)}) as event_saves,
        (select count(*) from event_hides where ${inWeek(sql`created_at`)}) as event_hides,
        (select count(*) from (
          select crew_id from visits group by crew_id
          having min(created_at) >= ${F} and min(created_at) < ${T}
        ) f) as first_stamps,
        (select count(distinct crew_id) from (
          select crew_id from visits where ${inWeek(sql`created_at`)}
          union all
          select e.crew_id from reviews r join explorers e on e.id = r.explorer_id
            where ${inWeek(sql`r.created_at`)} or ${inWeek(sql`r.updated_at`)}
          union all
          select crew_id from event_saves where ${inWeek(sql`created_at`)}
          union all
          select crew_id from event_hides where ${inWeek(sql`created_at`)}
          union all
          select crew_id from park_votes where ${inWeek(sql`created_at`)}
        ) a) as active_families,
        (select count(distinct a.crew_id) from (
          select crew_id from visits where ${inWeek(sql`created_at`)}
          union all
          select e.crew_id from reviews r join explorers e on e.id = r.explorer_id
            where ${inWeek(sql`r.created_at`)}
        ) a join crews c on c.id = a.crew_id where c.created_at < ${F}) as returning_families`);
    for (const k of [
      "families_new",
      "families_total",
      "grownups_new",
      "kids_new",
      "phones_verified",
      "stamps",
      "reviews",
      "photos",
      "event_saves",
      "event_hides",
      "first_stamps",
      "active_families",
      "returning_families",
    ])
      metrics[k] = n(r[k]);
  });

  // --- Lists --------------------------------------------------------------
  task("email list", async () => {
    const r = await one(sql`
      select
        (select count(*) from email_subscribers
          where confirmed_at < ${T} and (stopped_at is null or stopped_at >= ${T})) as email_list,
        (select count(*) from email_subscribers where ${inWeek(sql`confirmed_at`)}) as email_new,
        (select count(*) from email_subscribers where ${inWeek(sql`stopped_at`)}) as email_stopped,
        (select count(*) from email_subscribers
          where status = 'pending' and created_at < ${T}) as email_pending`);
    for (const k of [
      "email_list",
      "email_new",
      "email_stopped",
      "email_pending",
    ])
      metrics[k] = n(r[k]);
    const by = await rows(sql`
      select source, count(*) as n from email_subscribers
      where ${inWeek(sql`confirmed_at`)} group by source`);
    details.emailBySource = Object.fromEntries(
      by.map((x) => [String(x.source), n(x.n)]),
    );
  });

  // The texts list as of the week's end: each number's latest yes or stop
  // before then, minus numbers on the STOP list by then.
  const activeTexts = sql`
    select address from (
      select distinct on (address) address, action
      from contact_consents
      where channel = 'sms' and action in ('opt_in', 'opt_out') and created_at < ${T}
      order by address, id desc
    ) last
    where action = 'opt_in'
      and not exists (
        select 1 from sms_opt_outs o where o.phone = last.address and o.created_at < ${T}
      )`;
  task("texts list", async () => {
    const r = await one(sql`
      select
        (select count(*) from (${activeTexts}) t) as texts_list,
        (select count(*) from contact_consents
          where channel = 'sms' and action = 'opt_in' and ${inWeek(sql`created_at`)}) as texts_new,
        (select count(*) from contact_consents
          where channel = 'sms' and action = 'opt_out' and ${inWeek(sql`created_at`)}) as texts_stopped,
        (select count(*) from contact_consents
          where channel = 'sms' and action = 'opt_out' and source in ('stop', 'twilio_stop')
            and ${inWeek(sql`created_at`)}) as texts_stop_replies,
        (select count(distinct e.id) from explorers e
          join email_subscribers s on s.explorer_id = e.id
          where s.confirmed_at < ${T} and (s.stopped_at is null or s.stopped_at >= ${T})
            and e.phone in (${activeTexts})) as both_lists`);
    for (const k of [
      "texts_list",
      "texts_new",
      "texts_stopped",
      "texts_stop_replies",
      "both_lists",
    ])
      metrics[k] = n(r[k]);
    const by = await rows(sql`
      select source, count(*) as n from contact_consents
      where channel = 'sms' and action = 'opt_in' and ${inWeek(sql`created_at`)}
      group by source`);
    details.textsBySource = Object.fromEntries(
      by.map((x) => [String(x.source), n(x.n)]),
    );
  });

  // --- Email and texts performance ------------------------------------------
  task("newsletter", async () => {
    const issues = await rows(sql`
      select i.id, i.issue_date::text as issue_date,
        (select count(*) from news_sends s where s.issue_id = i.id and s.status = 'sent') as sent
      from news_issues i
      where i.status = 'sent' and ${inWeek(sql`coalesce(i.sent_at, i.send_started_at)`)}
      order by i.issue_date`);
    metrics.email_sent = issues.reduce((t, i) => t + n(i.sent), 0);
    const dates = issues.map((i) => String(i.issue_date));
    const clicks = dates.length
      ? await rows(sql`
          select issue_date::text as issue_date, slug, clicks from news_clicks
          where issue_date in (${sql.join(
            dates.map((d) => sql`${d}::date`),
            sql`, `,
          )})
            and slug not in (${WEEKEND_PICK_CLICK}, ${WEEKEND_PICK_TAP})
          order by clicks desc, slug`)
      : [];
    metrics.email_clicks = clicks.reduce((t, c) => t + n(c.clicks), 0);
    const last = issues.at(-1);
    details.issue = last
      ? {
          date: String(last.issue_date),
          sent: n(last.sent),
          links: clicks
            .filter((c) => c.issue_date === last.issue_date)
            .map((c) => ({ slug: String(c.slug), clicks: n(c.clicks) })),
        }
      : null;
    const stops = await one(sql`
      select
        count(*) filter (where source = 'bounce') as bounces,
        count(*) filter (where source = 'complaint') as complaints,
        count(*) filter (where source not in ('bounce', 'complaint')) as unsubs
      from contact_consents
      where channel = 'email' and action = 'opt_out' and ${inWeek(sql`created_at`)}`);
    metrics.email_bounces = n(stops.bounces);
    metrics.email_complaints = n(stops.complaints);
    metrics.email_unsubs = n(stops.unsubs);
  });

  task("texts", async () => {
    const r = await one(sql`
      select
        count(*) filter (where status = 'sent') as sent,
        count(*) filter (where status = 'sent' and delivery_status = 'delivered') as delivered,
        count(*) filter (where status = 'failed'
          or delivery_status in ('undelivered', 'failed')) as failed
      from sms_program_sends
      where ${inWeek(sql`coalesce(sent_at, created_at)`)}`);
    metrics.texts_sent = n(r.sent);
    metrics.texts_delivered = n(r.delivered);
    metrics.texts_failed = n(r.failed);
    const c = await one(sql`
      select coalesce(sum(clicks), 0) as n from news_clicks
      where issue_date >= ${week.start}::date and issue_date <= ${week.end}::date
        and slug in (${WEEKEND_PICK_CLICK}, ${WEEKEND_PICK_TAP})`);
    metrics.text_clicks = n(c.n);
  });

  // --- Social (our own records) ---------------------------------------------
  const published: { id: number; kind: string; day: string; ig: string }[] = [];
  task("social posts", async () => {
    const posts = await rows(sql`
      select id, kind, slot_date::text as day, ig_media_id, fb_post_id
      from social_posts
      where status = 'published' and ${inWeek(sql`published_at`)}
      order by published_at`);
    metrics.posts_published = posts.filter((p) => p.ig_media_id).length;
    metrics.fb_posts = posts.filter((p) => p.fb_post_id).length;
    const byKind: Record<string, number> = {};
    for (const p of posts) {
      byKind[String(p.kind)] = (byKind[String(p.kind)] ?? 0) + 1;
      if (p.ig_media_id)
        published.push({
          id: n(p.id),
          kind: String(p.kind),
          day: String(p.day),
          ig: String(p.ig_media_id),
        });
    }
    details.postsByKind = byKind;
    const dm = await one(sql`
      select count(*) filter (where status = 'sent') as sent,
             count(*) filter (where status = 'failed') as failed
      from social_dm_replies where ${inWeek(sql`created_at`)}`);
    metrics.dms_sent = n(dm.sent);
    metrics.dms_failed = n(dm.failed);
  });

  // --- Content and health -------------------------------------------------
  task("content", async () => {
    const r = await one(sql`
      select
        (select count(*) from kid_events where ${inWeek(sql`created_at`)}) as events_new,
        (select count(*) from pairing_pages where born_at < ${T}) as pairing_pages`);
    metrics.events_new = n(r.events_new);
    metrics.pairing_pages = n(r.pairing_pages);
  });

  task("health", async () => {
    // alert_log keeps only each kind's LAST email, not history, so it's
    // read on live runs only: kinds that emailed since the week began (to
    // now, so this morning counts too). A job that keeps failing re-emails
    // at least daily (every cron alert's window is 23 hours or less), so
    // it always shows. Counter rows (_hour, inbox:tempfail:<id>) aren't
    // alerts.
    if (o.live) {
      const keys = await rows(sql`
        select key from alert_log
        where key <> '_hour' and key not like 'inbox:tempfail:%'
          and sent_at >= ${F}
        order by sent_at`);
      const kinds = [...new Set(keys.map((k) => alertKind(String(k.key))))];
      details.alertKeys = kinds;
      metrics.alerts = kinds.length;
      metrics.cron_errors = kinds.filter((k) =>
        k.startsWith("error:cron-"),
      ).length;
    } else {
      metrics.alerts = null;
      metrics.cron_errors = null;
    }
    const p = await one(sql`
      select coalesce(sum(requests + details), 0) as total,
             coalesce(max(requests), 0) as peak
      from places_usage
      where day >= ${week.start}::date and day <= ${week.end}::date`);
    metrics.places_requests = n(p.total);
    metrics.places_peak_pct = Math.round((n(p.peak) / PLACES_PER_DAY) * 100);
  });

  // --- Vercel Web Analytics -------------------------------------------------
  const vc = vercelConfig(o.fetchImpl);
  if (week.to.getTime() <= ANALYTICS_SINCE.getTime())
    missing.push("Visitors: Web Analytics wasn't on yet that week");
  else if (!vc)
    missing.push(
      "Visitors, sources and browser events (spins, sign-in codes, asks): not connected yet. They start once VERCEL_ANALYTICS_TOKEN and VERCEL_ANALYTICS_TEAM_ID are set in Vercel.",
    );
  else
    task("Vercel Web Analytics", async () => {
      if (week.from.getTime() < ANALYTICS_SINCE.getTime())
        missing.push(
          "Visitors: Web Analytics started partway through this week (Nov 13, 2026)",
        );
      applyTraffic(await readTraffic(vc, week.from, week.to), metrics, details);
    });

  // --- Meta -----------------------------------------------------------------
  const go = graphOpts(o.fetchImpl);
  if (!go) missing.push("Instagram: no token in this environment");
  else {
    task("Instagram insights", async () => {
      const ins = await accountInsights(go, week.from, week.to);
      metrics.ig_reach = ins.reach;
      metrics.ig_views = ins.views;
      metrics.ig_profile_views = ins.profile_views;
      metrics.ig_link_taps = ins.website_clicks;
      metrics.ig_interactions = ins.total_interactions;
      metrics.ig_saves = ins.saves;
    });
    if (o.live) {
      task("Instagram followers", async () => {
        metrics.ig_followers = await accountFollowers(go);
      });
      const page = pageIdEnv();
      if (page)
        task("Facebook followers", async () => {
          metrics.fb_followers = await pageFollowers(page, go);
        });
    }
  }

  await Promise.all(tasks);

  // Numbers that are "so far" or "right now" (link taps keep counting,
  // saves get undone, pending rows change, accounts change numbers): a
  // rebuilt week can't know what they were, so it leaves them unmeasured
  // rather than invite a false week-over-week change.
  if (!o.live) for (const k of AS_OF_NOW) metrics[k] = null;

  // Per-post numbers need the week's posts first (lifetime, so far).
  if (o.live && go && published.length) {
    details.posts = await Promise.all(
      published.map(async (p) => {
        const i = await postInsights(go, p.ig);
        return {
          id: p.id,
          kind: p.kind,
          day: p.day,
          reach: i?.reach ?? null,
          views: i?.views ?? null,
          saved: i?.saved ?? null,
          shares: i?.shares ?? null,
          likes: i?.likes ?? null,
          comments: i?.comments ?? null,
        };
      }),
    );
  } else details.posts = [];

  // --- Live-only content ------------------------------------------------------
  if (o.live) {
    if (o.sitemap)
      await o
        .sitemap()
        .then((urls) => {
          metrics.sitemap_urls = urls.length;
          metrics.guides_live = urls.filter((u) =>
            /\/guides(\/|$)/.test(new URL(u.url).pathname),
          ).length;
        })
        .catch((e) => {
          console.error("[growth] sitemap failed", (e as Error)?.message);
          missing.push("Sitemap: couldn't be read this run");
        });
    if (o.eventsListed)
      await o
        .eventsListed()
        .then((c) => {
          metrics.events_listed = c;
        })
        .catch(() => missing.push("Events listed: couldn't be read this run"));
  }

  // Audience reach: every part must be measured, or it isn't comparable.
  const parts = [metrics.email_list, metrics.texts_list, metrics.ig_followers];
  metrics.audience_total = parts.every((x) => typeof x === "number")
    ? parts.reduce((t, x) => t! + x!, 0)
    : null;

  return { weekStart: week.start, metrics, details, backfilled: !o.live };
}
