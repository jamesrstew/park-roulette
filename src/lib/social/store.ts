import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  kidEvents,
  newsIssues,
  newsSettings,
  parks,
  socialPhotoChecks,
  socialPosts,
} from "@/db/schema";
import { alertLater } from "@/lib/alerts";
import { toRow } from "@/lib/events/store";
import { listed } from "@/lib/events/state";
import { pacificAt, upcomingDates } from "@/lib/events/model";
import { CATALOG, type Catalog } from "@/lib/news/catalog";
import { fetchPage } from "@/lib/news/fetcher";
import { IssueSchema, type Issue } from "@/lib/news/issue";
import { addDays, pacific } from "@/lib/news/time";
import { normalizeText, type Fetcher } from "@/lib/news/validate";
import { SITE_URL } from "@/lib/site";
import { oneLinerFor, planProfile, postTraits } from "@/lib/park-profiles";
import { currentProfiles } from "@/lib/park-profiles-check";
import { type RecentIdea, themesFor } from "./at-home";
import { postCandidates } from "./candidates";
import {
  composeEventsWeek,
  composeStory,
  composeTeaser,
  type ParkInfo,
} from "./compose";
import { pickWeekEvents, roundupWindow } from "./roundup";
import {
  containerStatus,
  createContainer,
  facebookPost,
  GraphError,
  type GraphOpts,
  publishContainer,
  publishingQuota,
} from "./graph";
import { previewKey } from "./key";
import {
  COPY,
  CREATE_LEAD_MIN,
  DAILY_PUBLISH_LIMIT,
  DATED_LEAD_HOURS,
  EVENTS_MAKE_LEAD_MIN,
  HASHTAGS,
  IDEA_COOLDOWN_WEEKS,
  IDEA_ICONS,
  ITEM_ICONS,
  LATE_LIMIT_MIN,
  mondayOf,
  OVERLAP_POSTS,
  PARK_COOLDOWN_WEEKS,
  photoCredit,
  type PhotoRef,
  type PostKind,
  type PostSpec,
  slotFor,
  type WeekDraft,
} from "./model";
import type { MediaFile } from "./render";
import {
  dmsOn,
  envKilled,
  facebookOn,
  getSocialSettings,
  graphOpts,
  pageIdEnv,
} from "./settings";
import {
  holidayIn,
  type PostReport,
  type RecentPost,
  type SocialCtx,
  stillTrue,
  textProblems,
  validatePost,
} from "./validate";

/**
 * Instagram in the database: the plan the Sunday routine reads, storing
 * its drafts (rendered once, by hash), the vision check's verdicts, the
 * Thursday teaser and Friday Story made from the sent issue, and the
 * publisher (create in one run, publish in a later one). Rendering is
 * imported lazily, so nothing here pulls sharp into a page.
 */

const render = () => import("./render");

// --- Context -------------------------------------------------------------------

const LIVE = ["queued", "creating", "publishing", "published", "dry_run"];

async function parkInfos(): Promise<Map<string, ParkInfo>> {
  const rows = await db
    .select({
      slug: parks.slug,
      name: parks.name,
      city: parks.city,
      address: parks.address,
      status: parks.status,
      play: parks.play,
      features: parks.features,
      approvedAt: parks.approvedAt,
    })
    .from(parks);
  return new Map(
    rows.map(({ approvedAt, ...p }) => [
      p.slug,
      { ...p, approved: approvedAt != null },
    ]),
  );
}

async function eventRows() {
  const rows = await db.select().from(kidEvents);
  return new Map(rows.map((r) => [r.slug, toRow(r)]));
}

type PostRow = typeof socialPosts.$inferSelect;

async function recentPosts(limit = OVERLAP_POSTS): Promise<PostRow[]> {
  return db
    .select()
    .from(socialPosts)
    .where(inArray(socialPosts.status, LIVE))
    .orderBy(desc(socialPosts.publishAt))
    .limit(limit);
}

/** Parks on Instagram in the cooldown, not counting one slot (a re-draft). */
async function coolingParks(
  day: string,
  except?: { kind: PostKind; slotDate: string },
): Promise<Set<string>> {
  const rows = await db
    .select({
      kind: socialPosts.kind,
      slotDate: socialPosts.slotDate,
      spec: socialPosts.spec,
    })
    .from(socialPosts)
    .where(
      and(
        inArray(socialPosts.status, LIVE),
        gte(socialPosts.slotDate, addDays(day, -7 * PARK_COOLDOWN_WEEKS)),
      ),
    );
  return new Set(
    rows
      .filter(
        (r) =>
          !(except && r.kind === except.kind && r.slotDate === except.slotDate),
      )
      .flatMap((r) => (r.spec as PostSpec).facts.parks),
  );
}

/** "At home" ideas in the 12-week cooldown, not counting one slot (a re-draft). */
async function recentIdeas(
  day: string,
  exceptSlot: string,
): Promise<RecentIdea[]> {
  const rows = await db
    .select({ slotDate: socialPosts.slotDate, spec: socialPosts.spec })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.kind, "at_home"),
        inArray(socialPosts.status, LIVE),
        gte(socialPosts.slotDate, addDays(day, -7 * IDEA_COOLDOWN_WEEKS)),
      ),
    );
  return rows
    .filter((r) => r.slotDate !== exceptSlot)
    .flatMap((r) => {
      const f = (r.spec as PostSpec).facts;
      return (f.ideas ?? []).map((title, i) => ({
        title,
        text: f.ideaTexts?.[i] ?? title,
      }));
    });
}

type Verdicts = Map<
  string,
  { clearSha: string | null; flagged: boolean; checked: boolean }
>;

/**
 * Per photo URL: the sha256 of its latest "clear" look, and whether any
 * look ever said people or unsure. A flagged photo is never used again,
 * whatever a later look says (decision 13).
 */
async function photoVerdicts(): Promise<Verdicts> {
  const rows = await db
    .select()
    .from(socialPhotoChecks)
    .orderBy(desc(socialPhotoChecks.checkedAt));
  const out: Verdicts = new Map();
  for (const r of rows) {
    const v = out.get(r.src) ?? {
      clearSha: null,
      flagged: false,
      checked: true,
    };
    if (r.verdict === "clear") v.clearSha ??= r.sha256;
    else v.flagged = true;
    out.set(r.src, v);
  }
  return out;
}

const catalogPhoto = (catalog: Catalog, slug: string) =>
  catalog.parks.find((p) => p.slug === slug)?.photo;

/** A park's catalog photo, if its look said clear and nothing ever flagged it. */
function clearedFor(verdicts: Verdicts, slug: string): PhotoRef | null {
  const photo = catalogPhoto(CATALOG, slug);
  if (!photo) return null;
  const v = verdicts.get(photo.src);
  if (!v || v.flagged || !v.clearSha) return null;
  return { src: photo.src, sha256: v.clearSha, credit: photoCredit(photo) };
}

/** The last sent issue's featured park (not on Instagram the same week). */
async function lastFeatured(): Promise<string | null> {
  const [r] = await db
    .select({ body: newsIssues.sentBody })
    .from(newsIssues)
    .where(eq(newsIssues.status, "sent"))
    .orderBy(desc(newsIssues.issueDate))
    .limit(1);
  const body = IssueSchema.safeParse(r?.body);
  return body.success ? body.data.wheel_pick.park : null;
}

/**
 * Holiday-hours evidence: does the venue's own page (its host only, the
 * validator checked that) print the quote? Fetched live.
 */
export async function evidenceSeen(
  url: string,
  quote: string,
  fetcher: Fetcher = fetchPage,
): Promise<boolean> {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const page = await fetcher(url, [host]);
    return (
      page.status === 200 &&
      !page.blocked &&
      page.text.includes(normalizeText(quote))
    );
  } catch {
    return false;
  }
}

export async function socialCtx(
  weekOf: string,
  now: Date,
  opts: { evidence?: SocialCtx["evidence"] } = {},
): Promise<SocialCtx> {
  const [all, events, recent, verdicts, featured] = await Promise.all([
    parkInfos(),
    eventRows(),
    recentPosts(),
    photoVerdicts(),
    lastFeatured(),
  ]);
  const postSlot = slotFor("park_post", weekOf);
  const cooling = await coolingParks(postSlot.date, {
    kind: "park_post",
    slotDate: postSlot.date,
  });
  const photoFor = (slug: string) => clearedFor(verdicts, slug);
  const sat = slotFor("at_home", weekOf).date;
  const ideas = await recentIdeas(sat, sat);
  const profiles = await currentProfiles(now);
  return {
    now,
    catalog: CATALOG,
    parks: all,
    events,
    recent: recent.map((r): RecentPost => ({
      kind: r.kind as PostKind,
      slotDate: r.slotDate,
      modelText: (r.spec as PostSpec).modelText,
    })),
    profiles,
    planParks: postCandidates(
      all,
      cooling,
      new Set(featured ? [featured] : []),
      (s) => !!photoFor(s),
      weekOf,
      profiles,
      Number(postSlot.date.slice(5, 7)),
    ),
    cooling,
    photoFor,
    dms: dmsOn(),
    recentIdeas: ideas,
    evidence: opts.evidence ?? ((u, q) => evidenceSeen(u, q)),
  };
}

// --- The plan (GET /api/social/plan) -------------------------------------------

/** The Monday the Sunday routine plans for: the coming week. */
export function planWeek(now: Date): string {
  const today = pacific(now).date;
  return addDays(mondayOf(today), pacific(now).weekday === 1 ? 0 : 7);
}

export async function socialPlan(now: Date, weekOf = planWeek(now)) {
  const ctx = await socialCtx(weekOf, now);
  const verdicts = await photoVerdicts();
  const mon = slotFor("park_post", weekOf);
  const wed = slotFor("unpack", weekOf);
  const sun = slotFor("unpack", weekOf, true);
  const sat = slotFor("at_home", weekOf);
  const tue = slotFor("events_week", weekOf);
  const friday = slotFor("story", weekOf).date;
  const breaks = CATALOG.breaks.filter(
    (b) => b.verified && b.from <= friday && b.to >= weekOf,
  );
  const month = Number(weekOf.slice(5, 7));
  const windowFrom = new Date(
    sun.publishAt.getTime() + DATED_LEAD_HOURS * 3_600_000,
  );
  const windowTo = new Date(wed.publishAt.getTime() + 8 * 86_400_000);
  const events = [...ctx.events.values()]
    .filter((e) => listed(e, now))
    .flatMap((e) =>
      upcomingDates(e.data, now)
        .filter((d) => {
          const t = pacificAt(d.day, d.start ?? "00:00");
          return t >= windowFrom && t <= windowTo;
        })
        .map((d) => ({
          ref: `event:${e.slug}@${d.day}`,
          title: e.data.title,
          day: d.day,
          start: d.start ?? null,
          end: d.end ?? null,
          town: e.data.venue.town,
          ages: e.data.ages_text ?? null,
          what: e.data.what,
          url: e.data.url,
        })),
    )
    .sort((a, b) => a.day.localeCompare(b.day));
  const photoState = (src: string) => {
    const v = verdicts.get(src);
    if (!v) return "unchecked";
    if (v.flagged) return "people";
    return v.clearSha ? "clear" : "unchecked";
  };
  const photosToCheck = CATALOG.parks
    .filter((p) => p.photo && !verdicts.has(p.photo.src))
    .map((p) => ({
      park: p.slug,
      src: p.photo!.src,
      sourceUrl: p.photo!.sourceUrl,
    }));
  const park = (slug: string) => {
    const p = ctx.parks.get(slug)!;
    const photo = catalogPhoto(CATALOG, slug);
    return {
      slug,
      name: p.name,
      town: p.city,
      address: p.address,
      features: p.features,
      profile: planProfile(
        ctx.profiles.get(slug),
        Number(mon.date.slice(5, 7)),
      ),
      photo: photo ? { src: photo.src, check: photoState(photo.src) } : null,
    };
  };
  return {
    week_of: weekOf,
    slots: {
      park_post: { day: mon.date, publish_at: mon.publishAt.toISOString() },
      unpack: { day: wed.date, publish_at: wed.publishAt.toISOString() },
      at_home: { day: sat.date, publish_at: sat.publishAt.toISOString() },
      events_week: {
        day: tue.date,
        publish_at: tue.publishAt.toISOString(),
        note: "Made by code from the events listing that morning. Nothing to write.",
      },
      ...(breaks.length
        ? {
            unpack_sunday: {
              day: sun.date,
              publish_at: sun.publishAt.toISOString(),
              note: 'School-break week: the carousel may go Sunday 7:45 pm instead (slot: "sun", break_id).',
            },
          }
        : {}),
    },
    breaks: breaks.map((b) => ({
      id: b.id,
      label: b.label,
      district: b.district ?? null,
      from: b.from,
      to: b.to,
    })),
    holiday: holidayIn(weekOf, 7),
    post_parks: ctx.planParks.map(park),
    venues: CATALOG.venues
      .filter((v) => v.verified && v.months.includes(month))
      .map((v) => ({
        ref: `venue:${v.id}`,
        name: v.name,
        town: v.town,
        what: v.what,
        open_days: v.open_days,
        ages: v.ages_label,
        cost: v.cost,
        hours_url: v.hours_url,
      })),
    events,
    parks: [...ctx.parks.values()]
      .filter(
        (p) =>
          p.approved &&
          p.status === "active" &&
          p.play !== "none" &&
          !ctx.cooling.has(p.slug),
      )
      .map((p) => ({
        ref: `park:${p.slug}`,
        name: p.name,
        town: p.city,
        features: p.features,
        signature: oneLinerFor(ctx.profiles.get(p.slug), month),
        traits: postTraits(ctx.profiles.get(p.slug), month).map((t) => ({
          text: t.text,
          keys: t.keys,
          kind: t.kind,
        })),
      })),
    at_home: {
      day: sat.date,
      themes: themesFor(sat.date, CATALOG.season_themes),
      recent_ideas: (ctx.recentIdeas ?? []).map((i) => i.title),
      icons: IDEA_ICONS,
    },
    season_themes: CATALOG.season_themes,
    photos_to_check: photosToCheck,
    recent: ctx.recent.map((r) => ({
      kind: r.kind,
      day: r.slotDate,
      words: r.modelText,
    })),
    rules: {
      hashtags: HASHTAGS,
      icons: ITEM_ICONS,
      cta: dmsOn() ? COPY.comment : COPY.bio,
      headline_words:
        "4 to 8 (the carousel); the park post's hook 8 at most. A number in the headline must equal the items left after cuts.",
      what_lines:
        "A carousel item's what line may only use words from its own source (the venue's or event's what, or the park's features).",
      restrooms:
        month >= 11 || month <= 3
          ? "No restroom claims (November to March)."
          : "Restroom claims only when the park's features list restrooms.",
      first_person: "None: no I, we, my, our.",
      signature:
        "The park post leads with a signature trait: the hook and the what line (the caption's opening) each name one of post_parks[].profile.traits (by its key words). Generic lines are refused: built for ... fans, something for everyone, fun for all ages, great place.",
      dated: `Dated items start ${DATED_LEAD_HOURS}+ hours after the post goes out.`,
      school_out:
        "Saying school is out needs break_id from breaks, covering the post's days and the towns you name.",
      holiday_hours:
        "In a holiday week, a venue item needs holiday_evidence: a quote from the venue's own site that names the holiday or its date and prints the hours. Otherwise it is cut.",
      at_home:
        "Saturday's at home carousel: 3 to 5 ideas, each a short title (24 characters), ages {from, to}, need (1 to 4 lowercase household items, 48 characters together), 2 or 3 plain steps (8 to 56 characters), and a payoff (12 to 56 characters): what the kid ends up with or the moment it pays off, never another step or a bare 'Have fun!'. theme: one id from at_home.themes; every idea fits it. No brands or products, nothing to buy, print or watch, no links. Never knives, blades, glue guns, stove, oven, baking, boiling, microwave, anything hot, candles, fire, irons, cleaners or chemicals, batteries, magnets, plastic bags, ladders, or prep overnight. Scissors only from age 4; small parts (beads, buttons, coins, rice, beans, pasta, popcorn, nuts, grapes, pom-poms, googly eyes, pebbles, marshmallows) and string or ribbon only from age 3; balloons only from age 8. An idea whose title is like one in at_home.recent_ideas (12 weeks) is refused. Code adds a water-safety line for water ideas under 6.",
      photos:
        "Look at each photo in photos_to_check (vision) and POST /api/social/photo-checks: clear only when no person or child is visible at all. Then look at every stored post's preview slides and POST /api/social/posts/<id>/crayon if any person is visible.",
    },
  };
}

// --- Drafts (POST /api/social/drafts) -------------------------------------------

export type DraftOutcome = PostReport & {
  stored: boolean;
  id?: number;
  previews?: string[];
  error?: string;
};

function previewUrls(id: number, n: number): string[] {
  const k = previewKey(id);
  return Array.from(
    { length: n },
    (_, i) => `${SITE_URL}/social/${id}/${i + 1}.png?k=${k}`,
  );
}

/**
 * Validate each post on its own; store the good ones (rendered and in
 * Blob first), replacing a queued post in the same slot. A photo that
 * doesn't load with the hash the vision check saw is dropped before
 * anything is drawn (the post becomes the crayon card, with no credit).
 * Nothing is stored with `store: false` (POST /api/social/check).
 */
export async function handleDrafts(
  draft: WeekDraft,
  now: Date,
  { store }: { store: boolean },
): Promise<DraftOutcome[]> {
  const ctx = await socialCtx(draft.week_of, now);
  const out: DraftOutcome[] = [];
  for (const post of draft.posts) {
    let r = await validatePost(post, draft.week_of, ctx);
    if (!r.ok || !r.spec || !store) {
      out.push({ ...r, stored: false });
      continue;
    }
    try {
      const R = await render();
      let photos = await R.photosFor(r.spec);
      const missing = r.spec.slides.some(
        (s, i) => "photo" in s && s.photo && !photos[i],
      );
      if (missing) {
        r = await validatePost(post, draft.week_of, {
          ...ctx,
          photoFor: () => null,
        });
        r.warnings.push(
          "The checked photo didn't load with the bytes the vision check saw: the crayon card is used.",
        );
        photos = [];
      }
      if (!r.ok || !r.spec) {
        out.push({ ...r, stored: false });
        continue;
      }
      const media = await R.storeMedia(await R.renderPost(r.spec, photos));
      const id = await upsertPost({
        kind: r.type,
        slotDate: r.slotDate,
        publishAt: new Date(r.publishAt),
        origin: "writer",
        body: post,
        spec: r.spec,
        media,
        report: { errors: r.errors, warnings: r.warnings, cut: r.cut },
      });
      if (id == null)
        out.push({
          ...r,
          stored: false,
          error: "That slot is already being published (or done).",
        });
      else
        out.push({
          ...r,
          stored: true,
          id,
          previews: previewUrls(id, r.spec.slides.length),
        });
    } catch (e) {
      console.error("[social] draft render failed", (e as Error)?.message);
      out.push({ ...r, stored: false, error: "Rendering failed; try again." });
    }
  }
  return out;
}

/** Insert, or replace the queued post in the same slot. Null if the slot is taken. */
async function upsertPost(p: {
  kind: PostKind;
  slotDate: string;
  publishAt: Date;
  origin: "writer" | "code";
  body: unknown;
  spec: PostSpec;
  media: MediaFile[];
  report: unknown;
  status?: "queued" | "skipped";
  reason?: string;
}): Promise<number | null> {
  return db.transaction(async (tx) => {
    const [old] = await tx
      .select({ id: socialPosts.id, status: socialPosts.status })
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.kind, p.kind),
          eq(socialPosts.slotDate, p.slotDate),
          sql`${socialPosts.status} <> 'replaced'`,
        ),
      )
      .for("update");
    if (old && old.status !== "queued") return null;
    if (old)
      await tx
        .update(socialPosts)
        .set({ status: "replaced", updatedAt: sql`now()` })
        .where(eq(socialPosts.id, old.id));
    const [row] = await tx
      .insert(socialPosts)
      .values({
        kind: p.kind,
        slotDate: p.slotDate,
        publishAt: p.publishAt,
        origin: p.origin,
        status: p.status ?? "queued",
        reason: p.reason ?? null,
        body: p.body,
        spec: p.spec,
        media: p.media,
        caption: p.spec.caption,
        report: p.report,
      })
      .returning({ id: socialPosts.id });
    return row.id;
  });
}

/**
 * The routine saw a person in a stored post's rendered slides: the photo
 * is flagged for good (a "people" verdict on its bytes) and the post is
 * redrawn as the crayon card, with the credit taken out of the caption.
 * Only a queued post can change.
 */
export async function downgradeToCrayon(
  id: number,
  note: string | undefined,
): Promise<{ ok: boolean; error?: string; previews?: string[] }> {
  const post = await postById(id);
  if (!post) return { ok: false, error: "No such post." };
  if (post.status !== "queued")
    return { ok: false, error: `It's ${post.status}, not queued.` };
  const spec = post.spec as PostSpec;
  const refs = spec.slides.flatMap((s) =>
    "photo" in s && s.photo ? [s.photo] : [],
  );
  for (const ref of refs)
    await db
      .insert(socialPhotoChecks)
      .values({
        src: ref.src,
        sha256: ref.sha256,
        verdict: "people",
        note: (note ?? "person seen in the rendered slide").slice(0, 200),
      })
      .onConflictDoUpdate({
        target: [socialPhotoChecks.src, socialPhotoChecks.sha256],
        set: { verdict: "people", checkedAt: sql`now()` },
      });
  if (!refs.length)
    return { ok: true, previews: previewUrls(id, spec.slides.length) };
  const credits = new Set(refs.map((r) => r.credit).filter(Boolean));
  const next: PostSpec = {
    ...spec,
    slides: spec.slides.map((s) =>
      "photo" in s ? ({ ...s, photo: null } as typeof s) : s,
    ),
    caption: drop(spec.caption, credits),
    fbCaption: drop(spec.fbCaption, credits),
  };
  const { slideAlt } = await import("./compose");
  next.alts = next.kind === "story" ? [] : next.slides.map(slideAlt);
  const R = await render();
  const media = await R.storeMedia(await R.renderPost(next, []));
  const done = await db
    .update(socialPosts)
    .set({
      spec: next,
      media,
      caption: next.caption,
      reason: "Redrawn as the crayon card: a person was seen in the slide.",
      updatedAt: sql`now()`,
    })
    .where(and(eq(socialPosts.id, id), eq(socialPosts.status, "queued")))
    .returning({ id: socialPosts.id });
  if (!done.length) return { ok: false, error: "It left the queue meanwhile." };
  return { ok: true, previews: previewUrls(id, next.slides.length) };
}

function drop(text: string | null, lines: Set<string | null>): string | null {
  if (text == null) return null;
  return text
    .split("\n")
    .filter((l) => !lines.has(l))
    .join("\n");
}

// --- The vision check's verdicts ------------------------------------------------

/**
 * Store verdicts for catalog park photos (the only photos we use). A
 * photo that any look marked people or unsure is never upgraded to clear.
 */
export async function savePhotoChecks(
  checks: { src: string; sha256: string; verdict: string; note?: string }[],
): Promise<{ saved: number; refused: { src: string; why: string }[] }> {
  const known = new Set(
    CATALOG.parks.flatMap((p) => (p.photo ? [p.photo.src] : [])),
  );
  const verdicts = await photoVerdicts();
  const refused: { src: string; why: string }[] = [];
  let saved = 0;
  for (const c of checks) {
    if (!known.has(c.src)) {
      refused.push({ src: c.src, why: "not a catalog park photo" });
      continue;
    }
    if (c.verdict === "clear" && verdicts.get(c.src)?.flagged) {
      refused.push({
        src: c.src,
        why: "an earlier look saw a person (or wasn't sure): it stays out",
      });
      continue;
    }
    await db
      .insert(socialPhotoChecks)
      .values({
        src: c.src,
        sha256: c.sha256,
        verdict: c.verdict,
        note: c.note ?? null,
      })
      .onConflictDoUpdate({
        target: [socialPhotoChecks.src, socialPhotoChecks.sha256],
        // Same bytes looked at again: only ever toward "no".
        set: {
          verdict: sql`case when ${socialPhotoChecks.verdict} = 'clear' then excluded.verdict else ${socialPhotoChecks.verdict} end`,
          note: c.note ?? null,
          checkedAt: sql`now()`,
        },
      });
    if (c.verdict !== "clear") {
      const v = verdicts.get(c.src) ?? {
        clearSha: null,
        flagged: false,
        checked: true,
      };
      v.flagged = true;
      verdicts.set(c.src, v);
    }
    saved++;
  }
  return { saved, refused };
}

// --- Thursday's teaser and Friday's Story (code only) ---------------------------

async function sentIssue(date: string): Promise<Issue | null> {
  const [r] = await db
    .select({ body: newsIssues.sentBody, status: newsIssues.status })
    .from(newsIssues)
    .where(eq(newsIssues.issueDate, date));
  if (!r || r.status !== "sent") return null;
  const b = IssueSchema.safeParse(r.body);
  return b.success ? b.data : null;
}

async function slotTaken(kind: PostKind, day: string): Promise<boolean> {
  const [r] = await db
    .select({ id: socialPosts.id })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.kind, kind),
        eq(socialPosts.slotDate, day),
        sql`${socialPosts.status} <> 'replaced'`,
      ),
    );
  return !!r;
}

/**
 * Make Thursday's teaser or Friday's Story from the week's sent issue,
 * once, on the crayon park card (nobody looks at these slides before they
 * go out, so they carry no photo). No sent issue by the time the slot is 2
 * hours late: the slot is recorded as skipped and James hears.
 */
export async function ensureCodePost(
  kind: "teaser" | "story",
  now: Date,
): Promise<string> {
  const weekOf = mondayOf(pacific(now).date);
  const { date, publishAt } = slotFor(kind, weekOf);
  if (pacific(now).date !== date) return "not its day";
  if (await slotTaken(kind, date)) return "already made";
  const thursday = slotFor("teaser", weekOf).date;
  const issue = await sentIssue(thursday);
  const late = now.getTime() > publishAt.getTime() + LATE_LIMIT_MIN * 60_000;
  const skip = async (reason: string) => {
    await upsertPost({
      kind,
      slotDate: date,
      publishAt,
      origin: "code",
      body: { issue: thursday },
      spec: emptySpec(kind),
      media: [],
      report: null,
      status: "skipped",
      reason,
    });
    alertLater({
      key: `social:skip:${kind}:${date}`,
      subject: `Instagram ${kind} skipped`,
      text: `The ${kind} for ${date} was skipped: ${reason}`,
      everyMinutes: 24 * 60,
    });
    return reason;
  };
  if (!issue)
    return late
      ? skip("No issue went out this week.")
      : "waiting for the issue";
  const all = await parkInfos();
  const park = all.get(issue.wheel_pick.park);
  if (!park || !park.approved || park.status !== "active")
    return skip(
      `The featured park ${issue.wheel_pick.park} isn't open on the map.`,
    );
  const spec =
    kind === "teaser"
      ? composeTeaser(issue, park, dmsOn())
      : composeStory(issue, park, dmsOn());
  // The issue's words were checked when it was sent; the competitor,
  // emoji and safety rules run again on the headline.
  const problems = textProblems(spec.modelText, {
    month: Number(date.slice(5, 7)),
    label: kind,
  }).filter((p) => !/first person/.test(p));
  if ((spec.caption ?? "").length > 2200)
    problems.push("caption over 2,200 characters");
  if (problems.length) return skip(problems.join(" "));
  const R = await render();
  const media = await R.storeMedia(await R.renderPost(spec, []));
  await upsertPost({
    kind,
    slotDate: date,
    publishAt,
    origin: "code",
    body: { issue: thursday },
    spec,
    media,
    report: { errors: [], warnings: [], cut: [] },
  });
  return "made";
}

/**
 * Tuesday's "Family events this week", made by code from kid_events on
 * its morning (from 60 minutes before its slot, so the listing is that
 * morning's): 4 to 8 confirmed kids' events with printed ages, times and
 * cost, spread across towns and days, in date order. Fewer than 4: the
 * slot is skipped and James hears. `rebuild` redraws a queued roundup
 * whose events changed (a canceled date drops out; below 4, it's skipped).
 */
export async function ensureEventsWeek(
  now: Date,
  { rebuild = false }: { rebuild?: boolean } = {},
): Promise<string> {
  const weekOf = mondayOf(pacific(now).date);
  const { date, publishAt } = slotFor("events_week", weekOf);
  if (pacific(now).date !== date) return "not its day";
  if (!rebuild && (await slotTaken("events_week", date))) return "already made";
  if (now.getTime() < publishAt.getTime() - EVENTS_MAKE_LEAD_MIN * 60_000)
    return "not yet";
  const skip = async (reason: string) => {
    await upsertPost({
      kind: "events_week",
      slotDate: date,
      publishAt,
      origin: "code",
      body: { events: [] },
      spec: emptySpec("events_week"),
      media: [],
      report: null,
      status: "skipped",
      reason,
    });
    alertLater({
      key: `social:skip:events_week:${date}`,
      subject: "Instagram events roundup skipped",
      text: `The family events roundup for ${date} was skipped: ${reason}`,
      everyMinutes: 24 * 60,
    });
    return reason;
  };
  if (now.getTime() > publishAt.getTime() + LATE_LIMIT_MIN * 60_000)
    return skip("Over 2 hours late.");
  const window = roundupWindow(date, publishAt);
  const pick = pickWeekEvents((await eventRows()).values(), window, now);
  if (pick.skip) return skip(pick.skip);
  const spec = composeEventsWeek(pick.events, window, dmsOn());
  const R = await render();
  const media = await R.storeMedia(await R.renderPost(spec, []));
  const id = await upsertPost({
    kind: "events_week",
    slotDate: date,
    publishAt,
    origin: "code",
    body: { events: pick.events.map((e) => `${e.slug}@${e.day}`) },
    spec,
    media,
    report: { errors: [], warnings: [], cut: pick.left },
  });
  return id == null ? "slot already going out" : rebuild ? "remade" : "made";
}

function emptySpec(kind: PostKind): PostSpec {
  return {
    kind,
    size: kind === "story" ? "story" : "feed",
    slides: [],
    alts: [],
    caption: null,
    fbCaption: null,
    headline: "",
    modelText: "",
    facts: { parks: [], events: [], venues: [], issue: null },
  };
}

// --- The publisher ---------------------------------------------------------------

export type RunResult = {
  action: "paused" | "busy" | "ran";
  notes: string[];
};

async function takeLease(owner: string): Promise<boolean> {
  await getSocialSettings();
  const got = await db
    .update(newsSettings)
    .set({
      socialLockUntil: sql`now() + interval '10 minutes'`,
      socialLockOwner: owner,
    })
    .where(
      and(
        eq(newsSettings.id, 1),
        sql`(${newsSettings.socialLockUntil} is null or ${newsSettings.socialLockUntil} < now())`,
      ),
    )
    .returning({ id: newsSettings.id });
  return got.length > 0;
}

async function releaseLease(owner: string) {
  await db
    .update(newsSettings)
    .set({ socialLockUntil: null, socialLockOwner: null })
    .where(
      and(eq(newsSettings.id, 1), eq(newsSettings.socialLockOwner, owner)),
    );
}

const mediaUrl = (f: MediaFile) => `${SITE_URL}/social/m/${f.sha}.${f.ext}`;

async function setPost(
  id: number,
  patch: Partial<typeof socialPosts.$inferInsert>,
) {
  await db
    .update(socialPosts)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(socialPosts.id, id));
}

function tell(
  post: PostRow,
  what: string,
  text: string,
  everyMinutes = 24 * 60,
) {
  alertLater({
    key: `social:${what}:${post.id}`,
    subject: `Instagram ${post.kind} for ${post.slotDate}: ${what}`,
    text,
    everyMinutes,
  });
}

const tooLate = (post: PostRow, now: Date) =>
  now.getTime() - post.publishAt.getTime() > LATE_LIMIT_MIN * 60_000;

/** What the post sends Meta: one image, a Story, or a carousel. */
function containersFor(post: PostRow): {
  children: { imageUrl: string; altText: string }[];
  parent:
    | { kind: "image"; imageUrl: string; caption: string; altText: string }
    | { kind: "carousel"; caption: string }
    | { kind: "story"; imageUrl: string };
} {
  const media = post.media as MediaFile[];
  const caption = post.caption ?? "";
  if (post.kind === "story")
    return {
      children: [],
      parent: { kind: "story", imageUrl: mediaUrl(media[0]) },
    };
  if (media.length === 1)
    return {
      children: [],
      parent: {
        kind: "image",
        imageUrl: mediaUrl(media[0]),
        caption,
        altText: media[0].alt,
      },
    };
  return {
    children: media.map((m) => ({ imageUrl: mediaUrl(m), altText: m.alt })),
    parent: { kind: "carousel", caption },
  };
}

async function factsHold(post: PostRow, now: Date): Promise<string | null> {
  const [all, events] = await Promise.all([parkInfos(), eventRows()]);
  return stillTrue((post.spec as PostSpec).facts, {
    now,
    catalog: CATALOG,
    parks: all,
    events,
  });
}

/**
 * One cron run (every 15 minutes in each window). Kill switch and
 * SOCIAL_PUBLISH=off first; then make Thursday's and Friday's code posts;
 * then for each due post: re-check its facts, create its container 30
 * minutes ahead, and publish once Meta says FINISHED and its time has
 * come. Dry run (the default) stops before Meta and mails James the
 * preview instead. A post 2 hours late is skipped.
 */
export async function runSocial(
  now = new Date(),
  { fetchImpl }: { fetchImpl?: typeof fetch } = {},
): Promise<RunResult> {
  const settings = await getSocialSettings();
  if (envKilled() || !settings.enabled)
    return {
      action: "paused",
      notes: [
        envKilled() ? "SOCIAL_PUBLISH is off." : "The kill switch is on.",
      ],
    };
  const owner = randomUUID();
  if (!(await takeLease(owner)))
    return { action: "busy", notes: ["Another run has the lease."] };
  const notes: string[] = [];
  try {
    const wd = pacific(now).weekday;
    if (wd === 2)
      try {
        notes.push(`events_week: ${await ensureEventsWeek(now)}`);
      } catch (e) {
        notes.push(`events_week: failed (${(e as Error).message})`);
        alertLater({
          key: `social:make:events_week:${pacific(now).date}`,
          subject: "Instagram events roundup: making it failed",
          text: `Making the family events roundup threw an error (${(e as Error).message}). The next run tries again until the slot is 2 hours late.`,
          everyMinutes: 6 * 60,
        });
      }
    for (const kind of [wd === 4 ? "teaser" : null, wd === 5 ? "story" : null])
      if (kind)
        try {
          notes.push(
            `${kind}: ${await ensureCodePost(kind as "teaser" | "story", now)}`,
          );
        } catch (e) {
          notes.push(`${kind}: failed (${(e as Error).message})`);
          alertLater({
            key: `social:make:${kind}:${pacific(now).date}`,
            subject: `Instagram ${kind}: making it failed`,
            text: `Making the ${kind} from the sent issue threw an error (${(e as Error).message}). The next run tries again until the slot is 2 hours late.`,
            everyMinutes: 6 * 60,
          });
        }

    const live =
      !settings.dryRun && process.env.VERCEL_ENV === "production"
        ? graphOpts(fetchImpl)
        : null;
    if (!settings.dryRun && !live)
      notes.push(
        process.env.VERCEL_ENV === "production"
          ? "Dry run off but IG_ACCESS_TOKEN or IG_USER_ID is missing: treated as a dry run."
          : "Not production: treated as a dry run.",
      );

    const due = await db
      .select()
      .from(socialPosts)
      .where(
        and(
          inArray(socialPosts.status, ["queued", "creating", "publishing"]),
          lt(
            socialPosts.publishAt,
            new Date(now.getTime() + CREATE_LEAD_MIN * 60_000),
          ),
        ),
      )
      .orderBy(socialPosts.publishAt);
    let quota: number | null | undefined;
    for (const post of due) {
      const lateBy = now.getTime() - post.publishAt.getTime();
      if (post.status === "queued") {
        if (tooLate(post, now)) {
          await setPost(post.id, {
            status: "skipped",
            reason: post.reason
              ? `Over 2 hours late (${post.reason}).`
              : "Over 2 hours late.",
          });
          tell(
            post,
            "skipped",
            `It was over 2 hours late${post.reason ? ` (last error: ${post.reason})` : ""}, so it was skipped. Nothing went out.`,
          );
          notes.push(`${post.id}: skipped (late)`);
          continue;
        }
        const broken = await factsHold(post, now);
        if (broken && post.kind === "events_week") {
          // One event changed: redraw the roundup without it (the next run
          // publishes the new one), or skip it below 4 events.
          const made = await ensureEventsWeek(now, { rebuild: true }).catch(
            (e) => `failed (${(e as Error).message})`,
          );
          notes.push(`${post.id}: ${broken} Roundup: ${made}`);
          continue;
        }
        if (broken) {
          await setPost(post.id, { status: "skipped", reason: broken });
          tell(post, "skipped", `Skipped just before it went out: ${broken}`);
          notes.push(`${post.id}: skipped (${broken})`);
          continue;
        }
        if (!live) {
          await setPost(post.id, {
            status: "dry_run",
            reason: settings.dryRun
              ? "Dry run."
              : "Not live (no production token).",
          });
          const n = (post.spec as PostSpec).slides.length;
          tell(
            post,
            "dry run",
            [
              "Dry run: this post would have gone out now. Nothing was sent to Instagram.",
              "",
              ...previewUrls(post.id, n),
              "",
              post.caption ?? "(Story: no caption)",
            ].join("\n"),
          );
          notes.push(`${post.id}: dry run`);
          continue;
        }
        if (quota === undefined)
          quota = await publishingQuota(live).catch(() => null);
        if (quota != null && quota >= DAILY_PUBLISH_LIMIT) {
          await setPost(post.id, {
            status: "skipped",
            reason: "Daily publishing limit reached.",
          });
          tell(
            post,
            "skipped",
            `Meta's publishing limit is used up (${quota} in 24 hours).`,
          );
          notes.push(`${post.id}: skipped (quota)`);
          continue;
        }
        await createStep(post, live, notes, now);
        continue;
      }
      if (!live) continue; // a live post caught by a switch to dry run waits
      if (post.status === "creating") {
        if (tooLate(post, now)) {
          await setPost(post.id, {
            status: "skipped",
            reason: "Not ready 2 hours after its time.",
          });
          tell(
            post,
            "skipped",
            "Meta hadn't finished it 2 hours after its time, so it was skipped. Nothing went out.",
          );
          continue;
        }
        if (!post.containerId) {
          await createStep(post, live, notes, now);
          continue;
        }
        if (lateBy < 0) continue; // ready early: wait for its minute
        await publishStep(post, live, notes);
        continue;
      }
      if (post.status === "publishing")
        await resolvePublishing(post, live, notes, now);
    }
    return { action: "ran", notes };
  } finally {
    await releaseLease(owner);
  }
}

async function createStep(
  post: PostRow,
  o: GraphOpts,
  notes: string[],
  now: Date,
) {
  const plan = containersFor(post);
  try {
    let childIds = post.childIds ?? [];
    if (
      plan.parent.kind === "carousel" &&
      childIds.length !== plan.children.length
    ) {
      childIds = [];
      for (const c of plan.children)
        childIds.push(
          await createContainer(
            {
              kind: "carousel_item",
              imageUrl: c.imageUrl,
              altText: c.altText,
            },
            o,
          ),
        );
      await setPost(post.id, { status: "creating", childIds });
    }
    const containerId = await createContainer(
      plan.parent.kind === "carousel"
        ? { kind: "carousel", children: childIds, caption: plan.parent.caption }
        : plan.parent,
      o,
    );
    await setPost(post.id, { status: "creating", containerId, reason: null });
    notes.push(`${post.id}: container ${containerId}`);
  } catch (e) {
    const err = e as GraphError;
    if (err instanceof GraphError && err.retryable && !tooLate(post, now)) {
      // Nothing is public until media_publish: try again next run.
      await setPost(post.id, { reason: err.message });
      notes.push(`${post.id}: create retry (${err.message})`);
      return;
    }
    await setPost(post.id, {
      status: "failed",
      reason: (err?.message ?? "error").slice(0, 300),
    });
    tell(
      post,
      "failed",
      `Creating it on Instagram failed: ${err?.message}. Nothing went out.`,
    );
    notes.push(`${post.id}: failed`);
  }
}

async function publishStep(post: PostRow, o: GraphOpts, notes: string[]) {
  let status;
  try {
    status = await containerStatus(post.containerId!, o);
  } catch (e) {
    notes.push(`${post.id}: status unknown (${(e as Error).message})`);
    return;
  }
  if (status.code === "IN_PROGRESS") return;
  if (status.code === "ERROR" || status.code === "EXPIRED") {
    await setPost(post.id, {
      status: "failed",
      reason: `Meta: ${status.code} ${status.detail ?? ""}`.trim(),
    });
    tell(
      post,
      "failed",
      `Meta couldn't process it (${status.code}). Nothing went out.`,
    );
    return;
  }
  if (status.code === "PUBLISHED") {
    await setPost(post.id, { status: "published", publishedAt: new Date() });
    return;
  }
  // Claim it, so no other run ever publishes the same post.
  const claimed = await db
    .update(socialPosts)
    .set({ status: "publishing", updatedAt: sql`now()` })
    .where(and(eq(socialPosts.id, post.id), eq(socialPosts.status, "creating")))
    .returning({ id: socialPosts.id });
  if (!claimed.length) return;
  await publish(post, o, notes);
}

/**
 * media_publish, once. On any error, the container's status decides:
 * PUBLISHED means it went out; FINISHED with a retryable error goes back
 * to `creating` for the next run (a container can't publish twice);
 * anything else fails. If even the status can't be read, the post stays
 * `publishing` and the next run asks again.
 */
async function publish(post: PostRow, o: GraphOpts, notes: string[]) {
  try {
    const mediaId = await publishContainer(post.containerId!, o);
    await setPost(post.id, {
      status: "published",
      igMediaId: mediaId,
      publishedAt: new Date(),
      reason: null,
    });
    notes.push(`${post.id}: published ${mediaId}`);
    if (facebookOn()) await crossPost(post, notes);
  } catch (e) {
    const err = e as GraphError;
    const retryable = err instanceof GraphError && err.retryable;
    let status;
    try {
      status = await containerStatus(post.containerId!, o);
    } catch {
      await setPost(post.id, { reason: err?.message ?? "error" });
      notes.push(`${post.id}: publish unclear (${err?.message})`);
      return;
    }
    if (status.code === "PUBLISHED") {
      await setPost(post.id, {
        status: "published",
        publishedAt: new Date(),
        reason: null,
      });
      tell(
        post,
        "published (no media id)",
        "It went out, but Meta's answer was lost, so its media id isn't recorded (keyword DMs skip it).",
      );
      notes.push(`${post.id}: published (resolved)`);
      return;
    }
    if (
      err instanceof GraphError &&
      err.ambiguous &&
      status.code !== "ERROR" &&
      status.code !== "EXPIRED"
    ) {
      // Meta may still be acting on it: the next run asks the container.
      await setPost(post.id, { reason: err.message });
      notes.push(`${post.id}: publish unclear (${err.message})`);
      return;
    }
    if (status.code === "FINISHED" && retryable) {
      await setPost(post.id, { status: "creating", reason: err.message });
      notes.push(`${post.id}: publish retry (${err.message})`);
      return;
    }
    await setPost(post.id, {
      status: "failed",
      reason: (err?.message ?? "error").slice(0, 300),
    });
    tell(
      post,
      "failed",
      `Publishing failed: ${err?.message}. Nothing went out.`,
    );
  }
}

/** A publish that didn't answer: ask the container (it publishes once, ever). */
async function resolvePublishing(
  post: PostRow,
  o: GraphOpts,
  notes: string[],
  now: Date,
) {
  let status;
  try {
    status = await containerStatus(post.containerId!, o);
  } catch {
    if (tooLate(post, now)) {
      await setPost(post.id, {
        status: "failed",
        reason: "Publish never confirmed, and Meta's status can't be read.",
      });
      tell(
        post,
        "unclear",
        "Publishing didn't answer and its status still can't be read 2 hours later. Check @park_roulette: it may or may not be up.",
      );
    }
    return;
  }
  if (status.code === "PUBLISHED") {
    await setPost(post.id, {
      status: "published",
      publishedAt: new Date(),
      reason: null,
    });
    tell(
      post,
      "published (no media id)",
      "It went out, but Meta's answer was lost, so its media id isn't recorded (keyword DMs skip it).",
    );
    notes.push(`${post.id}: published (resolved)`);
    return;
  }
  if (status.code === "FINISHED" && !tooLate(post, now)) {
    await publish(post, o, notes);
    return;
  }
  await setPost(post.id, {
    status: "failed",
    reason: `Unclear publish, then ${status.code}.`,
  });
  tell(
    post,
    "failed",
    "Publishing didn't answer and the post never showed as published. Nothing went out.",
  );
}

async function crossPost(post: PostRow, notes: string[]) {
  const spec = post.spec as PostSpec;
  const page = pageIdEnv();
  const o = graphOpts();
  if (!spec.fbCaption || post.kind === "story" || !page || !o) return;
  try {
    const id = await facebookPost(
      page,
      {
        imageUrls: (post.media as MediaFile[]).map(mediaUrl),
        caption: spec.fbCaption,
      },
      o,
    );
    await setPost(post.id, { fbPostId: id });
    notes.push(`${post.id}: facebook ${id}`);
  } catch (e) {
    tell(
      post,
      "facebook failed",
      `The Facebook cross-post failed: ${(e as Error).message}. Instagram went out.`,
    );
  }
}

/**
 * /admin's preflight: create real containers for a queued post and read
 * their status, and never publish (an unpublished container expires in
 * 24 hours). It proves Meta can fetch our media and accepts the caption
 * and alt text. Nothing about the post changes.
 */
export async function preflight(
  id: number,
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; lines: string[] }> {
  const o = graphOpts(fetchImpl);
  if (!o) return { ok: false, lines: ["No IG_ACCESS_TOKEN or IG_USER_ID."] };
  const post = await postById(id);
  if (!post || !["queued", "dry_run"].includes(post.status))
    return { ok: false, lines: ["Pick a queued or dry-run post."] };
  const plan = containersFor(post);
  const lines: string[] = [];
  try {
    const children: string[] = [];
    for (const c of plan.children)
      children.push(await createContainer({ kind: "carousel_item", ...c }, o));
    if (children.length)
      lines.push(`${children.length} slide containers made.`);
    const parent = await createContainer(
      plan.parent.kind === "carousel"
        ? { kind: "carousel", children, caption: plan.parent.caption }
        : plan.parent,
      o,
    );
    const s = await containerStatus(parent, o);
    lines.push(
      `Container ${parent}: ${s.code}${s.detail ? ` (${s.detail})` : ""}. Not published; it expires in 24 hours.`,
    );
    return { ok: s.code !== "ERROR" && s.code !== "EXPIRED", lines };
  } catch (e) {
    lines.push(`Meta refused it: ${(e as Error).message}`);
    return { ok: false, lines };
  }
}

// --- Reads ---------------------------------------------------------------------

/** May Meta (or anyone) fetch this file? Only media of posts that passed the checks. */
export async function mediaAllowed(sha: string, ext: string): Promise<boolean> {
  const rows = await db
    .select({ id: socialPosts.id })
    .from(socialPosts)
    .where(
      and(
        inArray(socialPosts.status, LIVE),
        sql`${socialPosts.media} @> ${JSON.stringify([{ sha, ext }])}::jsonb`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function postById(id: number): Promise<PostRow | null> {
  const [r] = await db.select().from(socialPosts).where(eq(socialPosts.id, id));
  return r ?? null;
}
