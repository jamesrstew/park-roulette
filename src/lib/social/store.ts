import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  kidEvents,
  newsIssues,
  newsSettings,
  parks,
  placesUsage,
  socialPhotoChecks,
  socialPosts,
} from "@/db/schema";
import { alertLater } from "@/lib/alerts";
import { toRow } from "@/lib/events/store";
import { listed } from "@/lib/events/state";
import { pacificAt, statusOn, upcomingDates } from "@/lib/events/model";
import { fetchForecast, weekendForecast } from "@/lib/news/weather";
import { CATALOG, type Catalog, isClosedPark } from "@/lib/news/catalog";
import { fetchPage } from "@/lib/news/fetcher";
import { UA } from "@/lib/news/ua";
import { IssueSchema, type Issue } from "@/lib/news/issue";
import { addDays, pacific } from "@/lib/news/time";
import { normalizeText, type Fetcher } from "@/lib/news/validate";
import { SITE_URL } from "@/lib/site";
import { oneLinerFor, planProfile, postTraits } from "@/lib/park-profiles";
import { currentProfiles } from "@/lib/park-profiles-check";
import { type RecentIdea, themesFor } from "./at-home";
import { listableParks, postCandidates } from "./candidates";
import { composeStory, composeTeaser, type ParkInfo } from "./compose";
import { type EchoFrame, runEchoes } from "./echo";
import {
  eventAnchors,
  indoorAnchors,
  mashupCopy,
  PAIRS_MIN,
  type Weather,
  weekendWeather,
  holidayBreak,
  type MashupHistory,
  type MashupTheme,
  MASHUP_THEMES,
  mashupParity,
  postableParks,
  THEME_LABEL,
} from "./mashup";
import { makeMashup } from "./mashup-make";
import { eventInputs } from "./mashup-events";
import { PlacesError, placeHours, placesKey, themePlaces } from "./places";
import {
  composeMashup,
  type MashupRow,
  rowFacts,
  rowsOf,
  rowTags,
} from "./compose";
import {
  fitRoundup,
  pickWeekEvents,
  roundupWindow,
  withHostTags,
} from "./roundup";
import {
  type Tag,
  igLinksIn,
  mentionProblems,
  parkTag,
  publishCaption,
  REGISTRY,
  postHandles,
  siteDomain,
  withoutMentions,
} from "./handles";
import {
  businessDiscovery,
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
  fbCaptionFor,
  photoClear,
  type PhotoVerdicts,
  withPostLink,
} from "./links";
import { expireSocial } from "./public";
import {
  COPY,
  CREATE_LEAD_MIN,
  DAILY_PUBLISH_LIMIT,
  DATED_LEAD_HOURS,
  EVENTS_MAKE_LEAD_MIN,
  HASHTAGS,
  IDEA_COOLDOWN_WEEKS,
  IDEA_ICONS,
  MASHUP_MAKE_LEAD_MIN,
  ideaLimitsText,
  ITEM_ICONS,
  LATE_LIMIT_MIN,
  mondayOf,
  OVERLAP_POSTS,
  PARK_COOLDOWN_WEEKS,
  SENTENCE_MAX_WORDS,
  STORY_LIMITS,
  photoCredit,
  type PhotoRef,
  type PostKind,
  type PostSpec,
  slotFor,
  type WeekDraft,
} from "./model";
import { PostDraft } from "./model";
import type { MediaFile, Rendered } from "./render";
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
  mashupProblems,
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
  // Every other week the Wednesday carousel is code's park pairings; the
  // holiday Unpack (Sunday) may still take a school-break week.
  const mashupWeek = mashupParity(weekOf);
  // Either way, only a whole-district break of 3 or more weekdays.
  const sundayOk = !!holidayBreak(CATALOG, weekOf);
  return {
    week_of: weekOf,
    slots: {
      park_post: { day: mon.date, publish_at: mon.publishAt.toISOString() },
      ...(mashupWeek
        ? {
            mashup: {
              day: wed.date,
              publish_at: wed.publishAt.toISOString(),
              note: "Park pairings week: code makes Wednesday's carousel from Google Places and our parks, indoor places and this weekend's events. Write no Unpack this week, unless unpack_sunday is offered and the school break makes it the better post (then there's no park pairings post this week).",
            },
          }
        : {
            unpack: { day: wed.date, publish_at: wed.publishAt.toISOString() },
          }),
      at_home: { day: sat.date, publish_at: sat.publishAt.toISOString() },
      events_week: {
        day: tue.date,
        publish_at: tue.publishAt.toISOString(),
        note: "Made by code from the events listing that morning. Nothing to write.",
      },
      ...(sundayOk
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
    parks: listableParks(ctx.parks, ctx.catalog, ctx.cooling).map((p) => ({
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
      // Code writes it per post: "Comment PARK" only on Unpack with DMs on.
      cta: dmsOn()
        ? `Unpack: ${COPY.comment} Every other post: ${COPY.bio}`
        : COPY.bio,
      headline_words:
        "4 to 8 (the carousels). A number in the headline must equal the items left after cuts.",
      voice: `Warm, plain, specific: one parent to another. Short sentences (${SENTENCE_MAX_WORDS} words at most each), everyday words, a small scene, then the useful bits. One exclamation point at most per post. No cliches: must-see, will love it, magical, make memories, adventure awaits, nestled, boasts, amenities, don't miss, tag a friend, hidden gem, perfect for, something for everyone.`,
      story: `The park post's story: ${STORY_LIMITS.minSentences} to ${STORY_LIMITS.sentences} short sentences, ${STORY_LIMITS.min} to ${STORY_LIMITS.max} characters. The first (${STORY_LIMITS.first} characters at most, it shows before "more") names the park exactly as post_parks[].name has it, and a signature trait. The scene is weather and season only. Story, who and bring name nothing but the park, its town and words in its traits, and state no weekday, time, price, free, hours, superlative ("the only ... in"), safety promise or event. who and bring are short lowercase fragments with no period, 120 characters at most; code labels them "Best for:" and "Bring:" and adds "Where:". Never ice or frozen water.`,
      intro:
        "The Unpack and at home carousels take an intro: 1 or 2 short sentences above the list, setting the week or the morning. A town is the only name. No price, free, hours, holiday or indoor/heated claims; any number is the item count after cuts (or the idea count). An Unpack intro makes no place claims (the items do); an at home intro follows the hazard and household rules for the youngest idea.",
      what_lines:
        "A carousel item's what line may only use words from its own source (the venue's or event's what, or the park's features).",
      restrooms:
        month >= 11 || month <= 3
          ? "No restroom claims (November to March)."
          : "Restroom claims only when the park's features list restrooms.",
      first_person:
        'No I, me or my. "We", "our" and "us" only as Park Roulette in these frames: we\'re featuring, this week we\'re featuring, we picked, our pick, this week\'s pick, we send, our free Thursday email. Every other we, our or us is refused.',
      signature:
        "The park post leads with a signature trait: the story's first sentence names the park and one of post_parks[].profile.traits (by its key words). Generic lines are refused: built for ... fans, something for everyone, fun for all ages, great place.",
      dated: `Dated items start ${DATED_LEAD_HOURS}+ hours after the post goes out.`,
      school_out:
        "Saying school is out needs break_id from breaks, covering the post's days and the towns you name.",
      holiday_hours:
        "In a holiday week, a venue item needs holiday_evidence: a quote from the venue's own site that names the holiday or its date and prints the hours. Otherwise it is cut.",
      at_home: `Saturday's at home carousel: 3 to 5 ideas, ${ideaLimitsText()}: what the kid ends up with or the moment it pays off, never another step or a bare 'Have fun!'. theme: one id from at_home.themes; every idea fits it. No brands or products, nothing to buy, print or watch, no links. Never knives, blades, glue guns, stove, oven, baking, boiling, microwave, anything hot, candles, fire, irons, cleaners or chemicals, batteries, magnets, plastic bags, ladders, or prep overnight. Scissors only from age 4; small parts (beads, buttons, coins, rice, beans, pasta, popcorn, nuts, grapes, pom-poms, googly eyes, pebbles, marshmallows) and string or ribbon only from age 3; balloons only from age 8. An idea whose title is like one in at_home.recent_ideas (12 weeks) is refused. Code adds a water-safety line for water ideas under 6.`,
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
export async function upsertPost(p: {
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
    // The id first, so the Facebook caption can carry the post's own page
    // (Unpack, at home: lib/social/links.ts) from the moment it's stored.
    const [{ id }] = await tx.execute<{ id: number }>(
      sql`select nextval(pg_get_serial_sequence('social_posts', 'id'))::int as id`,
    );
    const spec = withPostLink(p.spec, id, p.slotDate);
    const [row] = await tx
      .insert(socialPosts)
      .values({
        id,
        kind: p.kind,
        slotDate: p.slotDate,
        publishAt: p.publishAt,
        origin: p.origin,
        status: p.status ?? "queued",
        reason: p.reason ?? null,
        body: p.body,
        spec,
        media: p.media,
        caption: spec.caption,
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
      // Kept for good (publishing clears `reason`): a downgraded post never
      // shows on /social, even as its crayon card (lib/social/links.ts).
      report: sql`coalesce(${socialPosts.report}, '{}'::jsonb) || jsonb_build_object('downgraded', ${(note ?? "person seen").slice(0, 200)}::text)`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(socialPosts.id, id), eq(socialPosts.status, "queued")))
    .returning({ id: socialPosts.id });
  if (!done.length) return { ok: false, error: "It left the queue meanwhile." };
  expireSocial();
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
  // A new verdict can take a published post off /social.
  if (saved) expireSocial();
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
  if (
    !park ||
    !park.approved ||
    park.status !== "active" ||
    isClosedPark(park.slug)
  )
    return skip(
      `The featured park ${issue.wheel_pick.park} isn't open on the map.`,
    );
  const operator = parkTag(park.slug);
  let spec =
    kind === "teaser"
      ? composeTeaser(issue, park, dmsOn(), operator ? [operator] : [])
      : composeStory(issue, park, dmsOn());
  if (mentionProblems(spec.caption, postHandles(spec)).length)
    spec = composeTeaser(issue, park, dmsOn());
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
  const rows = await eventRows();
  const pick = pickWeekEvents(rows.values(), window, now);
  if (pick.skip) return skip(pick.skip);
  // The hosts' verified handles ride along; a tag that fails a check is
  // dropped (the roundup goes out without it), never the post.
  let fit = fitRoundup(withHostTags(pick.events, rows), window, dmsOn());
  if (
    !("skip" in fit) &&
    mentionProblems(fit.spec.caption, postHandles(fit.spec)).length
  )
    fit = fitRoundup(pick.events, window, dmsOn());
  if ("skip" in fit) return skip(fit.skip);
  const { spec } = fit;
  const R = await render();
  const media = await R.storeMedia(await R.renderPost(spec, []));
  const id = await upsertPost({
    kind: "events_week",
    slotDate: date,
    publishAt,
    origin: "code",
    body: { events: fit.events.map((e) => `${e.slug}@${e.day}`) },
    spec,
    media,
    report: { errors: [], warnings: [], cut: [...pick.left, ...fit.cut] },
  });
  return id == null ? "slot already going out" : rebuild ? "remade" : "made";
}

/** The park pairings already made (live), for the rotation and the cycles. */
async function mashupHistory(exceptSlot: string): Promise<MashupHistory[]> {
  const rows = await db
    .select({ slotDate: socialPosts.slotDate, spec: socialPosts.spec })
    .from(socialPosts)
    .where(
      and(eq(socialPosts.kind, "mashup"), inArray(socialPosts.status, LIVE)),
    );
  return rows.flatMap((r) => {
    const m = (r.spec as PostSpec).facts?.mashup;
    if (r.slotDate === exceptSlot || !m) return [];
    if (!(MASHUP_THEMES as readonly string[]).includes(m.theme)) return [];
    return [
      {
        slotDate: r.slotDate,
        theme: m.theme as MashupTheme,
        cycle: m.cycle,
        placeIds: m.pairs.map((p) => p.placeId),
      },
    ];
  });
}

/**
 * The weekend's weather in Bend from the National Weather Service (the
 * forecast the newsletter uses): bad at 50% rain or snow, or a high of
 * 35°F or less, on Saturday or Sunday. No forecast: not bad.
 */
async function weekendWeatherNow(
  wed: string,
  fetchImpl?: typeof fetch,
): Promise<Weather> {
  try {
    const byTown = await fetchForecast(fetchImpl);
    const days = weekendForecast(addDays(wed, 1), byTown.Bend) ?? [];
    return weekendWeather(days, wed);
  } catch {
    return { bad: false };
  }
}

/**
 * Just before a park pairings post goes out: is each event anchor still
 * on, at the same time? A canceled, removed or moved event drops only its
 * slide, and the post is redrawn; under 3 pairs left, it's skipped and
 * James hears. Null when every event still holds.
 */
export async function pruneMashup(
  post: PostRow,
  now: Date,
): Promise<string | null> {
  const spec = post.spec as PostSpec;
  const m = spec.facts.mashup;
  if (!m?.pairs.some((p) => p.event)) return null;
  const rows = await eventRows();
  // Still on, the same day and time, at the same venue, with the same title.
  const holds = (ev: NonNullable<MashupRow["event"]>) => {
    const e = rows.get(ev.slug);
    if (!e || e.confirm !== "ok" || !listed(e, now)) return false;
    if (statusOn(e.data, ev.day, e.status) !== "scheduled") return false;
    if (ev.venue != null && e.data.venue.name !== ev.venue) return false;
    if (ev.title != null && e.data.title !== ev.title) return false;
    if (!e.data.point) return false;
    return e.data.dates.find((d) => d.day === ev.day)?.start === ev.start;
  };
  const all = rowsOf(spec);
  const keep = all.filter((r) => !r.event || holds(r.event));
  if (keep.length === all.length) return null;
  const dropped = all.length - keep.length;
  const skip = async (why: string) => {
    await setPost(post.id, { status: "skipped", reason: why });
    tell(post, "skipped", `Skipped just before it went out: ${why}`);
    return "skipped (events changed)";
  };
  if (keep.length < PAIRS_MIN)
    return skip(
      `${dropped} of its events were canceled, removed or changed, leaving under ${PAIRS_MIN} pairs.`,
    );
  const theme = m.theme as MashupTheme;
  const month = Number(post.slotDate.slice(5, 7));
  const facts = rowFacts(keep, m);
  const copy = mashupCopy(theme, facts, month, m.variant ?? 0);
  const compose = (tags: readonly Tag[]) =>
    withPostLink(
      composeMashup(theme, keep, copy, {
        month,
        cycle: m.cycle,
        dms: dmsOn(),
        tags,
        variant: m.variant ?? 0,
        weather: facts.weather,
        shops: m.shops ?? null,
        slotDate: post.slotDate,
      }),
      post.id,
      post.slotDate,
    );
  // Checked again like any post (a bad tag drops, never the post).
  const o = { month, recent: [], slotDate: post.slotDate };
  let next = compose(rowTags(keep));
  let problems = mashupProblems(next, null, o);
  if (problems.length) {
    next = compose([]);
    problems = mashupProblems(next, null, o);
  }
  if (problems.length)
    return skip(
      `the redraw without its changed events failed a check: ${problems.join(" ")}`,
    );
  const R = await render();
  const media = await R.storeMedia(await R.renderPost(next, []));
  const done = await db
    .update(socialPosts)
    .set({
      spec: next,
      media,
      caption: next.caption,
      body: next.facts.mashup ?? { pairs: [] },
      reason: `Redrawn without ${dropped} event${dropped === 1 ? "" : "s"} that changed.`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(socialPosts.id, post.id), eq(socialPosts.status, "queued")))
    .returning({ id: socialPosts.id });
  expireSocial();
  // Not queued any more (skipped meanwhile): never publish the old one.
  return done.length
    ? `redrawn without ${dropped} changed event(s)`
    : "no longer queued";
}

/** Places requests at most per make, and per Pacific day (the key's quota is about 100). */
export const PLACES_PER_MAKE = 15;
export const PLACES_PER_DAY = 60;

/**
 * The Places budget for one make: each request takes one of the make's 15
 * and one of the day's 60 (counted in places_usage, atomically, so runs
 * at once can't overspend). Spent: a fatal PlacesError (the week skips).
 */
export function placesBudget(now: Date, perMake = PLACES_PER_MAKE) {
  let left = perMake;
  const day = pacific(now).date;
  return async () => {
    if (left <= 0)
      throw new PlacesError(
        `Places: this make's ${perMake} requests are used`,
        false,
        true,
      );
    left--;
    const got = await db
      .insert(placesUsage)
      .values({ day, requests: 1 })
      .onConflictDoUpdate({
        target: placesUsage.day,
        set: { requests: sql`${placesUsage.requests} + 1` },
        setWhere: sql`${placesUsage.requests} < ${PLACES_PER_DAY}`,
      })
      .returning({ requests: placesUsage.requests });
    if (!got.length)
      throw new PlacesError(
        `Places: today's ${PLACES_PER_DAY} requests are used`,
        false,
        true,
      );
  };
}

/** Parks with their points (the pairings measure from them). */
export async function parkPoints() {
  return db
    .select({
      slug: parks.slug,
      name: parks.name,
      city: parks.city,
      lat: parks.lat,
      lng: parks.lng,
      status: parks.status,
      play: parks.play,
      features: parks.features,
      approvedAt: parks.approvedAt,
    })
    .from(parks);
}

/**
 * Wednesday's park pairings, made by code on a mashup week (the weeks
 * alternate with the Unpack: lib/social/mashup.ts mashupParity), from 105
 * minutes before its slot (6 pm Pacific), with Places fetched then. A
 * holiday Unpack handed in for the week wins: then there's no pairings
 * post. Fewer than 3 pairs in every theme, or no key: skipped, and James
 * hears. A Places error throws: the next run tries again until it's late.
 */
export async function ensureMashup(
  now: Date,
  {
    placesFetch,
    placesBackoffMs,
    forecastFetch,
  }: {
    placesFetch?: typeof fetch;
    placesBackoffMs?: number;
    /** The National Weather Service (tests stub it). */
    forecastFetch?: typeof fetch;
  } = {},
): Promise<string> {
  const weekOf = mondayOf(pacific(now).date);
  const { date, publishAt } = slotFor("mashup", weekOf);
  if (pacific(now).date !== date) return "not its day";
  if (!mashupParity(weekOf)) return "an Unpack week";
  if (await slotTaken("mashup", date)) return "already made";
  // The week's Unpack, if the routine handed one in: the holiday Unpack
  // (the Sunday before) or a Wednesday one stored before the alternation
  // began. Only this week's: never next week's Sunday.
  const [unpack] = await db
    .select({ id: socialPosts.id })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.kind, "unpack"),
        inArray(socialPosts.status, LIVE),
        gte(socialPosts.slotDate, addDays(weekOf, -1)),
        lte(socialPosts.slotDate, date),
      ),
    );
  if (unpack) return "the week's Unpack has the slot";
  if (now.getTime() < publishAt.getTime() - MASHUP_MAKE_LEAD_MIN * 60_000)
    return "not yet";
  const skip = async (reason: string) => {
    await upsertPost({
      kind: "mashup",
      slotDate: date,
      publishAt,
      origin: "code",
      body: { pairs: [] },
      spec: emptySpec("mashup"),
      media: [],
      report: null,
      status: "skipped",
      reason,
    });
    alertLater({
      key: `social:skip:mashup:${date}`,
      subject: "Instagram park pairings skipped",
      text: `The park pairings carousel for ${date} was skipped: ${reason}`,
      everyMinutes: 24 * 60,
    });
    return reason;
  };
  if (now.getTime() > publishAt.getTime() + LATE_LIMIT_MIN * 60_000)
    return skip("Over 2 hours late.");
  let key: string;
  try {
    key = placesKey();
  } catch {
    return skip("GOOGLE_PLACES_KEY isn't set, so no places could be checked.");
  }
  const month = Number(date.slice(5, 7));
  const spend = placesBudget(now);
  // Well inside the cron's 300 s: rendering and storing come after.
  const deadline = Date.now() + 120_000;
  const [points, profiles, history, recent, cooling] = await Promise.all([
    parkPoints(),
    currentProfiles(now),
    mashupHistory(date),
    recentPosts(),
    coolingParks(date, { kind: "mashup", slotDate: date }),
  ]);
  const vetted = postableParks(
    points.map((p) => ({
      ...p,
      approved: p.approvedAt != null,
    })),
    profiles,
    CATALOG,
    month,
    cooling,
  );
  const [rows, weather] = await Promise.all([
    eventRows(),
    weekendWeatherNow(date, forecastFetch),
  ]);
  const events = eventAnchors(eventInputs(rows.values(), date, now), date);
  const anchors = [...vetted, ...indoorAnchors(cooling), ...events];
  // Places are searched in the parks' towns (the indoor places and events
  // are in the same towns): the budget stays small.
  const searchIn = vetted;
  const made = await makeMashup({
    month,
    slotDate: date,
    parks: anchors,
    weather,
    // An indoor place's hours: any trouble (a stale id, the budget) means
    // "not open" for this make, never a skipped week; a stale id tells James.
    indoorHours: (id) =>
      placeHours(id, { key, fetchImpl: placesFetch, spend, deadline }).catch(
        (e) => {
          if (
            !/requests are used|out of time|daily quota|429/.test(
              (e as Error).message,
            )
          )
            alertLater({
              key: `social:indoor-hours:${id}`,
              subject: "An indoor place's hours didn't load",
              text: `Places couldn't read the hours for ${id} (${(e as Error).message}). If it keeps failing, rebuild data/indoor-places.json (scripts/indoor-places.mts).`,
              everyMinutes: 7 * 24 * 60,
            });
          return null;
        },
      ),
    history,
    recent: recent.map((r) => ({
      kind: r.kind as PostKind,
      slotDate: r.slotDate,
      modelText: (r.spec as PostSpec).modelText ?? "",
    })),
    dms: dmsOn(),
    places: (theme) =>
      themePlaces(theme, searchIn, month, {
        key,
        fetchImpl: placesFetch,
        backoffMs: placesBackoffMs,
        spend,
        deadline,
      }),
    deadline,
  });
  // The day's quota, our cap, a refused key or the run's time: skip once
  // and tell James, never throw and start over next run.
  if (!made.ok && made.fatal) return skip(made.fatal);
  if (!made.ok)
    return skip(
      `No theme had 3 good pairs: ${made.tried.map((t) => `${THEME_LABEL[t.theme]}: ${t.why}`).join("; ")}`,
    );
  const R = await render();
  const media = await R.storeMedia(await R.renderPost(made.spec, []));
  const id = await upsertPost({
    kind: "mashup",
    slotDate: date,
    publishAt,
    origin: "code",
    // Place ids and our parks only: nothing else of Google's is kept.
    body: made.spec.facts.mashup ?? { pairs: [] },
    spec: made.spec,
    media,
    report: {
      errors: [],
      warnings: [],
      cut: made.tried.map((t) => `${THEME_LABEL[t.theme]}: ${t.why}`),
    },
  });
  return id == null ? "slot already going out" : `made (${made.theme})`;
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
  // A post went out (or didn't): the public grid and pages follow.
  if (patch.status) expireSocial();
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
  {
    fetchImpl,
    placesFetch,
    placesBackoffMs,
    forecastFetch,
  }: {
    fetchImpl?: typeof fetch;
    placesFetch?: typeof fetch;
    placesBackoffMs?: number;
    forecastFetch?: typeof fetch;
  } = {},
): Promise<RunResult> {
  const settings = await getSocialSettings();
  if (envKilled() || !settings.enabled)
    return {
      action: "paused",
      notes: [
        envKilled() ? "SOCIAL_PUBLISH is off." : "The kill switch is on.",
      ],
    };
  const startedAt = Date.now();
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
    if (wd === 3)
      try {
        notes.push(
          `mashup: ${await ensureMashup(now, { placesFetch, placesBackoffMs, forecastFetch })}`,
        );
      } catch (e) {
        notes.push(`mashup: failed (${(e as Error).message})`);
        alertLater({
          key: `social:make:mashup:${pacific(now).date}`,
          subject: "Instagram park pairings: making it failed",
          text: `Making the park pairings carousel threw an error (${(e as Error).message}). The next run tries again until the slot is 2 hours late.`,
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
        if (post.kind === "mashup") {
          // An event anchor that changed drops its slide (or the post).
          const pruned = await pruneMashup(post, now).catch((e) => {
            tell(
              post,
              "event re-check failed",
              `Re-checking its events before it goes out failed (${(e as Error).message}). The next run tries again until it's 2 hours late.`,
              6 * 60,
            );
            return `prune failed (${(e as Error).message})`;
          });
          if (pruned) {
            notes.push(`${post.id}: ${pruned}`);
            continue;
          }
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
    // After the feed posts, never before: an echo can't hold one up.
    await runEchoes(now, live, notes, startedAt).catch((e) =>
      notes.push(`echo: failed (${(e as Error).message})`),
    );
    return { action: "ran", notes };
  } finally {
    await releaseLease(owner);
  }
}

/**
 * The handles an organization's site links right now (its registry
 * entry's forward page, fetched plainly with our honest User-Agent), for
 * a renamed account. Any trouble: none.
 */
async function forwardHandlesNow(
  domain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const entry = REGISTRY.entries[domain];
  if (!entry) return [];
  const res = await fetchImpl(entry.forward, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!res.ok || siteDomain(res.url || entry.forward) !== domain) return [];
  return igLinksIn((await res.text()).slice(0, 3_000_000));
}

async function createStep(
  post: PostRow,
  o: GraphOpts,
  notes: string[],
  now: Date,
) {
  const final = await publishCaption(post, {
    // Fresh answers (each post publishes once), within a small budget.
    discover: (h) => businessDiscovery(h, o),
    forwardHandles: (d) => forwardHandlesNow(d, o.fetchImpl),
  });
  for (const n of final.notes) notes.push(`${post.id}: ${n}`);
  if (final.caption !== post.caption)
    await setPost(post.id, { caption: final.caption });
  const plan = containersFor({ ...post, caption: final.caption });
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
        // Never an Instagram handle on Facebook.
        caption: withoutMentions(
          fbCaptionFor(spec.fbCaption, { ...post, spec })!,
        ),
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

/**
 * May Meta (or anyone) fetch this file? Only media of posts that passed
 * the checks: a slide while every photo of its post is still clear, a
 * Story echo frame while its own photo is (a photo-free frame always).
 */
export async function mediaAllowed(sha: string, ext: string): Promise<boolean> {
  const rows = await db
    .select({
      id: socialPosts.id,
      spec: socialPosts.spec,
      media: socialPosts.media,
      echoMedia: socialPosts.echoMedia,
      echoFrames: socialPosts.echoFrames,
    })
    .from(socialPosts)
    .where(
      and(
        inArray(socialPosts.status, LIVE),
        or(
          sql`${socialPosts.media} @> ${JSON.stringify([{ sha, ext }])}::jsonb`,
          sql`${socialPosts.echoMedia} @> ${JSON.stringify({ sha, ext })}::jsonb`,
          sql`${socialPosts.echoFrames} @> ${JSON.stringify([{ sha, ext }])}::jsonb`,
        ),
      ),
    )
    .limit(20);
  if (!rows.length) return false;
  const photosOf = (spec: unknown): PhotoRef[] =>
    ((spec as PostSpec | null)?.slides ?? []).flatMap((s) =>
      "photo" in s && s.photo ? [s.photo] : [],
    );
  // The looks at these posts' photos only (never the whole table).
  const frameOf = (r: (typeof rows)[number]) =>
    Array.isArray(r.echoFrames)
      ? (r.echoFrames as EchoFrame[]).find(
          (f) => f.sha === sha && f.ext === ext,
        )
      : undefined;
  const srcs = [
    ...new Set(
      rows.flatMap((r) => [
        ...photosOf(r.spec).map((p) => p.src),
        ...(frameOf(r)?.photo ? [frameOf(r)!.photo!.src] : []),
      ]),
    ),
  ];
  const verdicts: PhotoVerdicts = { clear: new Set(), flagged: new Set() };
  if (srcs.length)
    for (const c of await db
      .select({
        src: socialPhotoChecks.src,
        sha256: socialPhotoChecks.sha256,
        verdict: socialPhotoChecks.verdict,
      })
      .from(socialPhotoChecks)
      .where(inArray(socialPhotoChecks.src, srcs)))
      if (c.verdict === "clear") verdicts.clear.add(`${c.src} ${c.sha256}`);
      else verdicts.flagged.add(c.src);
  for (const r of rows) {
    // A Story echo frame: photo-free is always fine; else its own photo
    // must still be clear on its exact bytes, as the echo itself judges.
    const frame = frameOf(r);
    if (frame) {
      if (!frame.photo || photoClear(frame.photo, verdicts)) return true;
      continue;
    }
    // An echo from before frames (one card from the cover): the same rule,
    // with the cover's photo.
    const echo = r.echoMedia as {
      sha?: string;
      ext?: string;
      photoFree?: boolean;
    } | null;
    if (echo?.sha === sha && echo.ext === ext) {
      const cover = photosOf({
        slides: (r.spec as PostSpec | null)?.slides?.slice(0, 1) ?? [],
      });
      if (echo.photoFree || cover.every((p) => photoClear(p, verdicts)))
        return true;
      continue;
    }
    // A slide: every photo of the post still clear on its exact bytes, and
    // never flagged since (the same rule as /social, links.ts publicMedia).
    if (photosOf(r.spec).every((p) => photoClear(p, verdicts))) return true;
  }
  return false;
}

/**
 * Redraw a queued writer post (park post, Unpack, at home) with the current
 * layout: its stored draft is validated again exactly as on hand-in (today's
 * facts, cuts and checks), drawn again, and its spec, media and caption are
 * replaced in place, only while it's still queued (the publisher hasn't
 * claimed it). Without `apply`, nothing is stored or uploaded: the new
 * slides come back for review.
 */
export async function redrawQueued(
  id: number,
  { apply, now = new Date() }: { apply: boolean; now?: Date },
): Promise<
  | {
      ok: true;
      applied: boolean;
      report: { errors: string[]; warnings: string[]; cut: string[] };
      caption: string | null;
      slides: Rendered[];
      previews?: string[];
    }
  | { ok: false; error: string; errors?: string[]; cut?: string[] }
> {
  const post = await postById(id);
  if (!post) return { ok: false, error: "No such post." };
  if (post.status !== "queued")
    return { ok: false, error: `It's ${post.status}, not queued.` };
  const draft = PostDraft.safeParse(post.body);
  if (!draft.success)
    return {
      ok: false,
      error: `It's a ${post.kind}, made by code (not a writer draft): it can't be redrawn this way.`,
    };
  // The week the draft was for: a Sunday school-break carousel is the day
  // before its week's Monday.
  const weekOf =
    draft.data.type === "unpack" && draft.data.slot === "sun"
      ? addDays(post.slotDate, 1)
      : mondayOf(post.slotDate);
  const ctx = { ...(await socialCtx(weekOf, now)), redraw: true };
  let r = await validatePost(draft.data, weekOf, ctx);
  if (!r.ok || !r.spec)
    return {
      ok: false,
      error: "The draft no longer passes today's checks: nothing changed.",
      errors: r.errors,
      cut: r.cut,
    };
  if (r.slotDate !== post.slotDate)
    return { ok: false, error: "Its slot moved: nothing changed." };
  const R = await render();
  let photos = await R.photosFor(r.spec);
  if (r.spec.slides.some((s, i) => "photo" in s && s.photo && !photos[i])) {
    r = await validatePost(draft.data, weekOf, {
      ...ctx,
      photoFor: () => null,
    });
    if (!r.ok || !r.spec)
      return {
        ok: false,
        error: "The crayon-card version fails: nothing changed.",
      };
    r.warnings.push(
      "The checked photo didn't load with the bytes the vision check saw: the crayon card is used.",
    );
    photos = [];
  }
  const spec = withPostLink(r.spec, id, post.slotDate);
  const slides = await R.renderPost(spec, photos);
  const report = { errors: r.errors, warnings: r.warnings, cut: r.cut };
  if (!apply)
    return { ok: true, applied: false, report, caption: spec.caption, slides };
  const media = await R.storeMedia(slides);
  const done = await db
    .update(socialPosts)
    .set({
      spec,
      media,
      caption: spec.caption,
      // A downgrade mark is kept for good (the post never shows on /social).
      report: sql`${JSON.stringify(report)}::jsonb || case when ${socialPosts.report} ? 'downgraded' then jsonb_build_object('downgraded', ${socialPosts.report} -> 'downgraded') else '{}'::jsonb end`,
      reason: "Redrawn with the current layout.",
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(socialPosts.id, id),
        eq(socialPosts.status, "queued"),
        // Not yet in the publisher's hands: more than 35 minutes to go
        // (containers are made 30 minutes ahead), and no container made.
        sql`${socialPosts.publishAt} > now() + interval '35 minutes'`,
        sql`${socialPosts.containerId} is null`,
        sql`${socialPosts.childIds} is null`,
      ),
    )
    .returning({ id: socialPosts.id });
  if (!done.length)
    return {
      ok: false,
      error:
        "It left the queue, or is within 35 minutes of going out, meanwhile: nothing changed.",
    };
  console.info(`[social] post ${id} redrawn (${spec.slides.length} slides)`);
  return {
    ok: true,
    applied: true,
    report,
    caption: spec.caption,
    slides,
    previews: previewUrls(id, spec.slides.length),
  };
}

export async function postById(id: number): Promise<PostRow | null> {
  const [r] = await db.select().from(socialPosts).where(eq(socialPosts.id, id));
  return r ?? null;
}
