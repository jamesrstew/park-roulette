import { weekLabel, weekOf } from "./week";
import {
  EMAIL_ROWS,
  METRIC,
  METRICS,
  SOURCE_LABELS,
  SOURCE_NAMES,
  type Metrics,
  type Snapshot,
} from "./model";

/**
 * The digest's reading of the numbers: the verdict, what moved, the funnel
 * and three things to try. Deterministic rules over the stored weeks (no
 * model, no randomness), written for small numbers: counts and "+2", and a
 * percentage only when the base is big enough to mean something. Pure.
 */

/** Below this base a percentage says more noise than news. */
export const PCT_MIN_BASE = 50;

export const v = (s: Snapshot | undefined, key: string): number | null => {
  const x = s?.metrics[key];
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};

const fmt = (x: number) => x.toLocaleString("en-US");

/** "+2", "−1", "same", or null when either side isn't measured. */
export function change(cur: number | null, prev: number | null): string {
  if (cur == null) return "not measured";
  if (prev == null) return "no prior week";
  const d = cur - prev;
  if (d === 0) return "same";
  const sign = d > 0 ? "+" : "−";
  const pct =
    prev >= PCT_MIN_BASE
      ? ` (${sign}${Math.round((Math.abs(d) / prev) * 100)}%)`
      : "";
  return `${sign}${fmt(Math.abs(d))}${pct}`;
}

/** "3 (+2)", "3", or "–" (not measured). */
export function withChange(cur: number | null, prev: number | null): string {
  if (cur == null) return "–";
  const c = change(cur, prev);
  return c === "no prior week" || c === "same"
    ? fmt(cur)
    : `${fmt(cur)} (${c.replace(" (", ", ").replace(/\)$/, "")})`;
}

/** Up, down or flat, read through the metric's direction (good or bad). */
export function tone(
  key: string,
  cur: number | null,
  prev: number | null,
): "good" | "bad" | "flat" | "none" {
  if (cur == null || prev == null) return "none";
  if (cur === prev) return "flat";
  const up = cur > prev;
  return up !== !!METRIC[key]?.lowerIsBetter ? "good" : "bad";
}

export const fmtNum = (x: number | null) => (x == null ? "–" : fmt(x));

// --- Words for labels -----------------------------------------------------

export const POST_KINDS: Record<string, string> = {
  park_post: "park post",
  unpack: "park pairings carousel",
  teaser: "newsletter teaser",
  story: "Story",
  events_week: "events-this-week post",
  at_home: "at-home idea",
  mashup: "mashup",
};

/** news_clicks slugs, in words (unknown slugs show as they are). */
export const LINK_NAMES: Record<string, string> = {
  pick: "the Wheel Pick",
  "plan-b": "the Plan B venue",
  events: "All kids' events",
  passport: "the passport",
  meme: "the Parents' corner post",
};
/** "weekend-2" -> "weekend outing 2"; unknown slugs show as they are. */
export function linkName(slug: string): string {
  if (LINK_NAMES[slug]) return LINK_NAMES[slug];
  const m = /^(weekend|heads-up)-(\d+)$/.exec(slug);
  if (m)
    return `${m[1] === "weekend" ? "weekend outing" : "heads-up park"} ${m[2]}`;
  return `"${slug.replace(/-/g, " ")}"`;
}

const sourceName = (k: string) => SOURCE_NAMES[k] ?? k;
const signupSource = (k: string) => SOURCE_LABELS[k] ?? k.replace(/_/g, " ");
const plural = (x: number, one: string, many = `${one}s`) =>
  `${fmt(x)} ${x === 1 ? one : many}`;

// --- Headlines ----------------------------------------------------------------

export type Headline = {
  key: string;
  label: string;
  value: number | null;
  prev: number | null;
  change: string;
  tone: ReturnType<typeof tone>;
  /** Oldest first, this week last (null: not measured that week). */
  series: (number | null)[];
  note: string;
};

export const HEADLINES = [
  {
    key: "families_new",
    label: "New families",
    note: "families that started a passport",
  },
  {
    key: "audience_total",
    label: "Audience reach",
    note: "email + texts + Instagram followers",
  },
  {
    key: "visitors",
    label: "Weekly visitors",
    note: "daily unique browsers, added up",
  },
] as const;

export function series(
  cur: Snapshot,
  history: Snapshot[],
  key: string,
  weeks = 4,
): (number | null)[] {
  return [...history.slice(-(weeks - 1)), cur].map((s) => v(s, key));
}

export function headlines(cur: Snapshot, history: Snapshot[]): Headline[] {
  const prev = history.at(-1);
  return HEADLINES.map((h) => ({
    ...h,
    value: v(cur, h.key),
    prev: v(prev, h.key),
    change: change(v(cur, h.key), v(prev, h.key)),
    tone: tone(h.key, v(cur, h.key), v(prev, h.key)),
    series: series(cur, history, h.key),
  }));
}

// --- Sources ------------------------------------------------------------------

/** Visitor sources, biggest first, direct last. */
export function rankedSources(s: Snapshot): { key: string; n: number }[] {
  const src = s.details.sources ?? {};
  return Object.entries(src)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) =>
      a.key === "direct" ? 1 : b.key === "direct" ? -1 : b.n - a.n,
    );
}

const signups = (s: Snapshot | undefined) => {
  const parts = ["families_new", "email_new", "texts_new"].map((k) => v(s, k));
  return parts.every((x) => x == null)
    ? null
    : parts.reduce<number>((t, x) => t + (x ?? 0), 0);
};

// --- The verdict --------------------------------------------------------------

export function verdict(cur: Snapshot, history: Snapshot[]): string {
  const prev = history.at(-1);
  const fam = v(cur, "families_new") ?? 0;
  const famPrev = v(prev, "families_new");
  const bestBefore = Math.max(
    0,
    ...history.map((h) => v(h, "families_new") ?? 0),
  );
  const vis = v(cur, "visitors");
  const visPrev = v(prev, "visitors");
  const su = signups(cur);
  const suPrev = signups(prev);
  const firsts = v(cur, "first_stamps") ?? 0;
  const stamps = v(cur, "stamps") ?? 0;
  if (su == null && vis == null) return "Nothing was measured this week.";

  // The good news: the biggest gain of the week.
  let good = "";
  if (
    vis != null &&
    visPrev != null &&
    vis >= 2 * visPrev &&
    vis - visPrev >= 20
  )
    good = `Visitors more than doubled to ${fmt(vis)}`;
  else if (
    vis != null &&
    visPrev != null &&
    vis > visPrev &&
    vis - visPrev >= 10
  )
    good = `Visitors rose to ${fmt(vis)}`;
  if (fam > 0) {
    const famWords =
      fam >= 10 && fam > bestBefore
        ? `a record ${plural(fam, "new family", "new families")} joined`
        : `${plural(fam, "family", "families")} joined`;
    good = good ? `${good} and ${famWords}` : capital(famWords);
  } else if (!good && su != null && suPrev != null && su > suPrev)
    good = `Sign-ups rose to ${fmt(su)}`;

  // The catch: the most important thing that didn't happen.
  let catchLine = "";
  if (fam > 0 && firsts === 0 && stamps === 0)
    catchLine = "no one stamped a park yet";
  else if (vis != null && vis >= 30 && (su ?? 0) === 0)
    catchLine = "no one signed up";
  else if (famPrev != null && fam < famPrev && fam === 0)
    catchLine = "no new families joined";

  if (good && catchLine) return `${good}, but ${catchLine}.`;
  if (good) return `${good}.`;
  if (su != null && suPrev != null && su < suPrev)
    return `A slower week: ${plural(su, "sign-up")}, down from ${fmt(suPrev)}.`;
  if (catchLine) return `${capital(catchLine)} this week.`;
  if (su) return `A steady week: ${plural(su, "sign-up")}.`;
  return `A quiet week: no new sign-ups${vis ? ` from ${plural(vis, "visitor")}` : ""}.`;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Problem alerts in plain words (the red line under the verdict). */
export function problemLine(cur: Snapshot): string | null {
  const kinds = (cur.details.alertKeys ?? []).filter(isProblem);
  if (!kinds.length) return null;
  const words = [...new Set(kinds.map(alertWords))];
  return `${capital(words.slice(0, 3).join("; "))}${words.length > 3 ? `; and ${words.length - 3} more` : ""}.`;
}

/** An alert kind in plain words. */
export function alertWords(kind: string): string {
  const cron = /^error:cron-(.+)$/.exec(kind);
  if (cron) return `the ${cron[1].replace(/-/g, " ")} job failed`;
  const render = /^error:render:(.+)$/.exec(kind);
  if (render) return `a page (${render[1]}) failed to load at least once`;
  if (kind.startsWith("error:"))
    return `an error in ${kind.slice(6).replace(/[-:]/g, " ")}`;
  if (kind === "inbox:suspicious")
    return "the newsletter inbox held an email that failed its sender checks";
  if (kind.startsWith("inbox:")) return "the newsletter inbox needs a look";
  if (kind.startsWith("sms:"))
    return "sign-in texts hit a limit or a Twilio problem";
  if (kind.startsWith("texts:"))
    return "the Weekend Pick texts flagged something";
  if (kind.startsWith("social:")) return "Instagram posting flagged something";
  if (kind.startsWith("news:")) return "the Thursday email flagged something";
  return kind.replace(/[:_-]/g, " ");
}

// --- What moved and why -----------------------------------------------------

export function whatMoved(cur: Snapshot, history: Snapshot[]): string[] {
  const prev = history.at(-1);
  const out: string[] = [];
  const d = cur.details;

  const vis = v(cur, "visitors");
  if (vis != null) {
    const ranked = rankedSources(cur).filter(
      (x) => x.key !== "direct" && x.key !== "other_site",
    );
    const direct = d.sources?.direct ?? 0;
    const visPrev = v(prev, "visitors");
    const trend =
      visPrev == null
        ? `${plural(vis, "visitor")}`
        : vis > visPrev
          ? `Visitors up ${fmt(vis - visPrev)}`
          : vis < visPrev
            ? `Visitors down ${fmt(visPrev - vis)}`
            : "Visitors flat";
    out.push(
      trend +
        (ranked.length
          ? `, led by ${ranked
              .slice(0, 3)
              .map((x) => `${sourceName(x.key)} (${fmt(x.n)})`)
              .join(", ")}.`
          : ".") +
        (direct && vis
          ? ` ${direct * 2 >= vis ? "Over half" : `${fmt(direct)}`} came with no referrer (texts, email apps, in-app browsers, typed), so sources are partial.`
          : ""),
    );
  }

  const spins = v(cur, "spins");
  if (spins)
    out.push(
      `The wheel: ${plural(spins, "spin")}, ${plural(v(cur, "stamps") ?? 0, "stamp")}${v(cur, "reviews") ? `, ${plural(v(cur, "reviews")!, "review")}` : ""}.`,
    );

  const parts = [
    ["families_new", "new family", "new families"],
    ["email_new", "email sign-up"],
    ["texts_new", "text sign-up"],
  ] as const;
  const su = parts
    .map(([k, one, many]) => ({ n: v(cur, k), one, many }))
    .filter((x) => x.n != null && x.n > 0);
  const bySource = { ...d.emailBySource };
  for (const [k, n] of Object.entries(d.textsBySource ?? {}))
    bySource[k] = (bySource[k] ?? 0) + n;
  const listTotal = Object.values(bySource).reduce((t, n) => t + n, 0);
  const topSignup = Object.entries(bySource).sort((a, b) => b[1] - a[1])[0];
  const share = topSignup
    ? topSignup[1] === listTotal
      ? listTotal === 1
        ? "The list sign-up came from"
        : `All ${fmt(listTotal)} list sign-ups (email and texts) came from`
      : `${fmt(topSignup[1])} of ${fmt(listTotal)} list sign-ups came from`
    : "";
  if (su.length)
    out.push(
      `Sign-ups: ${su.map((x) => plural(x.n!, x.one, x.many)).join(", ")}.` +
        (topSignup ? ` ${share} ${signupSource(topSignup[0])}.` : ""),
    );
  else out.push("Sign-ups: none this week.");

  const posts = (d.posts ?? []).filter((p) => p.reach != null);
  const best = [...posts].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))[0];
  if (best)
    out.push(
      `Top post: the ${POST_KINDS[best.kind] ?? best.kind} (${shortDate(best.day)}) reached ${plural(best.reach!, "account")}` +
        (best.saved ? `, ${plural(best.saved, "save")}` : "") +
        (best.shares ? `, ${plural(best.shares, "share")}` : "") +
        `. ${plural(v(cur, "posts_published") ?? posts.length, "post")} went out.`,
    );
  else if (v(cur, "posts_published"))
    out.push(`${plural(v(cur, "posts_published")!, "post")} went out.`);

  const issue = d.issue;
  if (issue) {
    const top = issue.links[0];
    out.push(
      `Newsletter: ${plural(issue.sent, "email")} sent, ${plural(v(cur, "email_clicks") ?? 0, "link tap")}` +
        (top
          ? `; the top link was ${linkName(top.slug)} (${fmt(top.clicks)})`
          : "") +
        ".",
    );
  }

  const fol = v(cur, "ig_followers");
  if (fol != null)
    out.push(
      `Instagram: ${withChange(fol, v(prev, "ig_followers"))} followers` +
        (v(cur, "ig_reach") != null
          ? `, ${plural(v(cur, "ig_reach")!, "account")} reached`
          : "") +
        (v(cur, "ig_link_taps")
          ? `, ${plural(v(cur, "ig_link_taps")!, "bio link tap")}`
          : "") +
        ".",
    );

  const alerts = d.alertKeys ?? [];
  if (alerts.length && !alerts.some(isProblem))
    out.push(
      `Health: no problems. ${plural(alerts.length, "routine notice")} (send reports and digests).`,
    );
  return out;
}

/** Alert kinds that mean something broke (not reports or done notices). */
export const isProblem = (kind: string) =>
  kind.startsWith("error:") ||
  /fail|cap|budget|token|skip|stale|guardrail|errors|lock|heartbeat|unreachable|signature|tempfail|suspicious|partial|twilio|stop-like|parse/.test(
    kind,
  );

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });

// --- The funnel -----------------------------------------------------------

export type FunnelStep = { label: string; n: number | null; note?: string };
export type Funnel = { name: string; steps: FunnelStep[] };

export function funnels(cur: Snapshot): Funnel[] {
  const e = cur.details.events;
  const ev = (name: string) => (e ? (e[name] ?? 0) : null);
  const ask = cur.details.askShownBy;
  const askN = (...ch: string[]) =>
    ask ? ch.reduce((t, c) => t + (ask[c] ?? 0), 0) : null;
  const footerShown = ev("Footer text shown");
  const textAsk = askN("text", "both");
  return [
    {
      name: "Families",
      steps: [
        { label: "Visitors", n: v(cur, "visitors") },
        { label: "Asked for a sign-in code", n: ev("Code requested") },
        { label: "Verified a phone", n: ev("Number verified") },
        { label: "Started a family", n: v(cur, "families_new") },
        { label: "Stamped a first park", n: v(cur, "first_stamps") },
      ],
    },
    {
      name: "Email",
      steps: [
        {
          label: "Saw an email ask",
          n: askN("email", "both"),
          note: "Pop-up only (not the footer form)",
        },
        { label: "Signed up", n: ev("Email signup") },
        { label: "New on the list", n: v(cur, "email_new") },
      ],
    },
    {
      name: "Texts",
      steps: [
        {
          label: "Saw a texts ask",
          n:
            textAsk == null && footerShown == null
              ? null
              : (textAsk ?? 0) + (footerShown ?? 0),
        },
        { label: "Said yes", n: ev("Text signup") },
        { label: "New on the list", n: v(cur, "texts_new") },
      ],
    },
  ];
}

/** Below this base a step's rate is a count only ("4 of 6"). */
export const RATE_MIN_BASE = 20;

/** "4 of 6", or "6 of 116 (5%)" on a big enough base. */
export function rate(n: number | null, of: number | null): string {
  if (n == null || of == null || of === 0) return "";
  const pct = of >= RATE_MIN_BASE ? ` (${Math.round((n / of) * 100)}%)` : "";
  return `${fmt(n)} of ${fmt(of)}${pct}`;
}

// --- Three things to try ------------------------------------------------------

export type Idea = { title: string; why: string; score: number };

const avg = (xs: (number | null)[]) => {
  const ok = xs.filter((x): x is number => x != null);
  return ok.length ? ok.reduce((t, x) => t + x, 0) / ok.length : null;
};

const SOURCE_PLAYS: Record<string, string> = {
  bulletin:
    "Say hello to Bulletin readers: share the Bulletin piece on Instagram and Facebook with the link, and keep the home page's sign-up front and center while it's fresh.",
  instagram:
    "Instagram is sending people: post the same kind of post again this week, and answer every comment the same day.",
  facebook:
    "Facebook is sending people: share this week's best post to a local parents' group (where its rules allow) and reply to comments.",
  google:
    "Google is sending searchers: check which pages they land on (the web view's top pages) and give those pages a clear sign-up and links to /events.",
  other_search:
    "Search engines beyond Google are sending people: make sure the top landing pages have clear titles and a sign-up.",
};

export function ideas(cur: Snapshot, history: Snapshot[]): Idea[] {
  const prev = history.at(-1);
  const out: Idea[] = [];
  const d = cur.details;
  const vis = v(cur, "visitors") ?? 0;
  const su = signups(cur) ?? 0;

  // Broken things first.
  const failed = (d.alertKeys ?? []).filter((k) => k.startsWith("error:cron-"));
  if (failed.length)
    out.push({
      score: 100,
      title: `Fix the failed job${failed.length > 1 ? "s" : ""}: ${failed.map((k) => k.replace("error:cron-", "")).join(", ")}`,
      why: "A scheduled job emailed a failure alert this week. Check the Vercel logs before Thursday's send.",
    });

  if (
    !d.partial &&
    (v(cur, "texts_list") ?? 0) > 0 &&
    v(cur, "texts_sent") === 0
  )
    out.push({
      score: 80,
      title: "Check why no Weekend Pick went out",
      why: `${plural(v(cur, "texts_list")!, "number")} are on the texts list but no Friday text was sent this week. Look at /admin (texts may be paused or in dry run).`,
    });

  // The one source that grew most against last week (one tip at most).
  const spike = Object.keys(SOURCE_PLAYS)
    .map((key) => ({
      key,
      now: v(cur, `src_${key}`) ?? 0,
      before: v(prev, `src_${key}`),
    }))
    .filter((x) => x.now >= 10 && x.now >= 2 * (x.before ?? 0))
    .sort((a, b) => b.now - (b.before ?? 0) - (a.now - (a.before ?? 0)))[0];
  if (spike)
    out.push({
      score: 60 + Math.min(spike.now, 30),
      title: `Lean into ${sourceName(spike.key)}`,
      why: `${capital(sourceName(spike.key))} sent ${plural(spike.now, "visitor")}${spike.before ? `, up from ${fmt(spike.before)} last week` : ", new this week"}. ${SOURCE_PLAYS[spike.key]}`,
    });

  // New families that haven't stamped a park.
  const fam = v(cur, "families_new") ?? 0;
  if (fam > 0 && (v(cur, "first_stamps") ?? 0) === 0)
    out.push({
      score: 58,
      title: "Get the new families to their first stamp",
      why: `${plural(fam, "family", "families")} joined and none stamped a park yet. Make Thursday's featured park an easy first stamp, and say how: "Spin, go, tap We went!"`,
    });

  // Traffic that doesn't turn into sign-ups.
  if (vis >= 30 && su / vis < 0.05) {
    const top = (d.pathGroups ?? []).find(
      (g) => g.group !== "Admin" && g.group !== "Passport and sign-in",
    );
    out.push({
      score: 55,
      title: top
        ? `Put a sign-up where people land: ${top.group.toLowerCase()}`
        : "Turn more visitors into sign-ups",
      why: `${plural(vis, "visitor")} and ${plural(su, "sign-up")} this week.${top ? ` ${top.group} had the most page views (${fmt(top.pageviews)}): make the email or texts ask the first thing there.` : ""}`,
    });
  }

  // Bio link taps that don't sign up.
  const taps = v(cur, "ig_link_taps") ?? 0;
  const igSignups =
    (d.emailBySource?.ig_bio ?? 0) +
    (d.textsBySource?.ig_bio ?? 0) +
    (d.emailBySource?.ig_dm ?? 0) +
    (d.textsBySource?.ig_dm ?? 0);
  if (taps >= 5 && igSignups === 0)
    out.push({
      score: 50,
      title: "Make the Instagram link page ask first",
      why: `${plural(taps, "tap")} on the bio link and no sign-ups from it. Put the sign-up at the top of /social and say what they'll get ("one park pick every Thursday").`,
    });

  // A post type pulling ahead.
  const posts = (d.posts ?? []).filter((p) => p.reach != null);
  if (posts.length >= 2) {
    const all = avg(posts.map((p) => p.reach))!;
    const byKind = new Map<string, number[]>();
    for (const p of posts)
      byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p.reach!]);
    const best = [...byKind]
      .map(([k, xs]) => ({ k, a: avg(xs)! }))
      .sort((a, b) => b.a - a.a)[0];
    if (best && best.a >= 1.5 * all && best.a - all >= 5)
      out.push({
        score: 45,
        title: `Make another ${POST_KINDS[best.k] ?? best.k}`,
        why: `It reached about ${fmt(Math.round(best.a))} accounts, against ${fmt(Math.round(all))} for the week's average post.`,
      });
  }

  // Lists that stalled.
  for (const [key, name, where] of [
    ["email_new", "email list", "Thursday's email"],
    ["texts_new", "texts list", "the Weekend Pick"],
  ] as const) {
    const a = v(cur, key);
    const b = v(prev, key);
    if (a === 0 && b === 0 && vis >= 10)
      out.push({
        score: 40,
        title: `Restart the ${name}`,
        why: `No new sign-ups for two weeks. Post a Story with a real example of ${where} and the sign-up link.`,
      });
  }

  // Spins that don't turn into stamps.
  const spins = v(cur, "spins") ?? 0;
  const stamps = v(cur, "stamps") ?? 0;
  if (spins >= 20 && stamps <= spins * 0.05)
    out.push({
      score: 35,
      title: "Turn spins into park visits",
      why: `${plural(spins, "spin")} and ${plural(stamps, "stamp")} this week. Try a "Spin, go, stamp it" challenge in Thursday's email, with a badge as the reward.`,
    });

  // Newsletter links nobody tapped.
  if ((v(cur, "email_sent") ?? 0) >= 3 && v(cur, "email_clicks") === 0)
    out.push({
      score: 30,
      title: "Give the newsletter one link worth tapping",
      why: "Nobody tapped a link in this week's issue. Lead with one clear button (the featured park's directions).",
    });

  // Families that don't come back.
  if (
    (v(cur, "families_total") ?? 0) >= 5 &&
    v(cur, "returning_families") === 0
  )
    out.push({
      score: 25,
      title: "Bring passport families back",
      why: `No family from before this week stamped or reviewed. Feature a "where to go next" park for stamp collectors in Thursday's email.`,
    });

  // Never a blank list: steady, specific defaults.
  if ((v(cur, "reviews") ?? 0) === 0)
    out.push({
      score: 10,
      title: "Ask for one review",
      why: "No reviews this week. Ask a family you know to rate the last park they visited: reviews make park pages worth finding.",
    });
  out.push({
    score: 5,
    title: "Share a family invite link",
    why: "Send your own passport's friend link to two families you know: invites are the cheapest new families.",
  });
  out.push({
    score: 4,
    title: "Post a weekend question Story",
    why: 'Ask "Where are you playing this weekend?" in a Story with a poll: replies and votes lift reach for next week\'s posts.',
  });

  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

/** What the data can't say (the footer). */
export function dataGaps(cur: Snapshot): string[] {
  const out = [...(cur.details.missing ?? [])];
  out.push(
    "Email opens: open tracking is off on purpose (no pixels), so opens aren't measured.",
    "Instagram Stories: Meta hides Story numbers until enough people view them.",
    "Facebook reach: Meta returns no Page insights for this Page yet; only followers.",
    "Search Console: not connected (no Google search clicks or impressions).",
    "Text replies other than STOP and HELP aren't stored.",
  );
  if (cur.backfilled)
    out.unshift(
      "This week was rebuilt later: live numbers (followers, listings) weren't saved.",
    );
  return out;
}

export type DigestView = {
  week: { start: string; label: string; partial: boolean };
  verdict: string;
  /** Problem alerts in plain words, or null. */
  problem: string | null;
  /** The audience tile's parts ("3 email · 5 texts · 54 Instagram"). */
  audienceParts: string;
  headlines: Headline[];
  moved: string[];
  funnels: Funnel[];
  ideas: Idea[];
  gaps: string[];
  rows: {
    group: string;
    key: string;
    label: string;
    value: number | null;
    prev: number | null;
    change: string;
    tone: ReturnType<typeof tone>;
    series: (number | null)[];
    definition: string;
    source: string;
    inEmail: boolean;
  }[];
};

/** Everything the email and the web view show, from the stored weeks. */
export function buildView(cur: Snapshot, history: Snapshot[]): DigestView {
  const prev = history.at(-1);
  return {
    week: {
      start: cur.weekStart,
      label: weekLabel(weekOf(cur.weekStart)),
      partial: !!cur.details.partial,
    },
    verdict: verdict(cur, history),
    problem: problemLine(cur),
    audienceParts: [
      ["email_list", "email"],
      ["texts_list", "texts"],
      ["ig_followers", "Instagram"],
    ]
      .map(([k, label]) => `${fmtNum(v(cur, k))} ${label}`)
      .join(" \u00b7 "),
    headlines: headlines(cur, history),
    moved: whatMoved(cur, history),
    funnels: funnels(cur),
    ideas: ideas(cur, history),
    gaps: dataGaps(cur),
    rows: METRICS.map((d) => ({
      group: d.group,
      key: d.key,
      label: d.label,
      value: v(cur, d.key),
      prev: v(prev, d.key),
      change: change(v(cur, d.key), v(prev, d.key)),
      tone: tone(d.key, v(cur, d.key), v(prev, d.key)),
      series: series(cur, history, d.key),
      definition: d.definition,
      source: d.source,
      inEmail:
        (EMAIL_ROWS as readonly string[]).includes(d.key) &&
        !(v(cur, d.key) === 0 && (v(prev, d.key) ?? 0) === 0),
    })),
  };
}

export function metricsFor(s: Snapshot | undefined): Metrics {
  return s?.metrics ?? {};
}

/**
 * An alert key's kind, without ids or dates ("report:123" -> "report",
 * "texts:skip:2026-11-20" -> "texts:skip"). Pure.
 */
export function alertKind(key: string): string {
  return key
    .split(":")
    .slice(0, 3)
    .filter((s) => s && !/^[0-9-]+$/.test(s))
    .join(":");
}
