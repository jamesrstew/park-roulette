/**
 * Passport math: stickers (badges) and fun stats. Pure functions, no DB, so
 * they're easy to test. Dates are "YYYY-MM-DD" strings (Postgres `date`).
 */
import type { CrayonName } from "./crayons";

export type BadgePark = {
  id: number;
  city: string;
  features: string[];
  /** "active", or a cross-off reason (no_playground, closed, private). */
  status: string;
};
export type BadgeVisit = { parkId: number; visitedOn: string };
export type BadgeReview = {
  parkId: number;
  explorerId: number;
  tenths: number;
  tags?: string[];
};

export type BadgeInput = {
  /** Every park on the bucket list, crossed-off ones included. */
  parks: BadgePark[];
  /** Every visit the crew has logged. */
  visits: BadgeVisit[];
  /** Every review written by someone in the crew. */
  reviews: BadgeReview[];
  /** Photos the crew has posted. */
  photoCount: number;
  /** Attribute keys that are heads-ups (busy_road, windy, ...). */
  headsUpKeys?: string[];
};

export type Badge = {
  id: string;
  emoji: string;
  title: string;
  /** Short line of sticker copy. */
  line: string;
  color: CrayonName;
  earned: boolean;
  /** How close a locked sticker is ("3 of 5"). Null when it's all-or-nothing. */
  progress: { have: number; need: number } | null;
};

export type Progress = {
  total: number;
  /** Visited and still a playground. */
  coloredIn: number;
  /** Not a playground after all (no_playground, closed, private). */
  crossedOff: number;
  /** coloredIn + crossedOff: resolved on the bucket list. */
  done: number;
};

export const isCrossedOff = (p: { status: string }) => p.status !== "active";

/** The bucket-list rule: done = visited (colored in) + crossed off. */
export function progressOf(
  parks: { id: number; status: string }[],
  visitedIds: Set<number>,
): Progress {
  let coloredIn = 0;
  let crossedOff = 0;
  for (const p of parks) {
    if (isCrossedOff(p)) crossedOff++;
    else if (visitedIds.has(p.id)) coloredIn++;
  }
  return {
    total: parks.length,
    coloredIn,
    crossedOff,
    done: coloredIn + crossedOff,
  };
}

const MILESTONES: {
  n: number;
  emoji: string;
  title: string;
  line: string;
  color: CrayonName;
}[] = [
  {
    n: 5,
    emoji: "🖐️",
    title: "High Five",
    line: "Five playgrounds down!",
    color: "orange",
  },
  {
    n: 10,
    emoji: "🔟",
    title: "Double Digits",
    line: "Ten parks. Big deal!",
    color: "teal",
  },
  {
    n: 25,
    emoji: "🏅",
    title: "Playground Pro",
    line: "25 parks and counting.",
    color: "blue",
  },
  {
    n: 50,
    emoji: "🌟",
    title: "Half Hundred",
    line: "50 parks. Legends.",
    color: "purple",
  },
  {
    n: 100,
    emoji: "💯",
    title: "Century Club",
    line: "100 playgrounds!!",
    color: "red",
  },
];

/** Parse "YYYY-MM-DD" as a UTC calendar day so time zones can't shift it. */
function day(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function seasonOf(iso: string): "winter" | "spring" | "summer" | "fall" {
  const m = day(iso).getUTCMonth();
  if (m === 11 || m <= 1) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "fall";
}

/** The Saturday that starts this date's weekend, or null on a weekday. */
export function weekendKey(iso: string): string | null {
  const d = day(iso);
  const dow = d.getUTCDay();
  if (dow !== 0 && dow !== 6) return null;
  if (dow === 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Largest number of distinct values grouped under one key. */
function maxDistinct<K, V>(rows: [K | null, V][]): number {
  const m = new Map<K, Set<V>>();
  let best = 0;
  for (const [k, v] of rows) {
    if (k == null) continue;
    const s = m.get(k) ?? new Set<V>();
    s.add(v);
    m.set(k, s);
    best = Math.max(best, s.size);
  }
  return best;
}

export function computeBadges(input: BadgeInput): Badge[] {
  const { parks, visits, reviews, photoCount, headsUpKeys = [] } = input;
  const visited = new Set(visits.map((v) => v.parkId));
  const prog = progressOf(parks, visited);
  const active = parks.filter((p) => !isCrossedOff(p));

  const byTown = new Map<
    string,
    { total: number; done: number; active: number }
  >();
  for (const p of parks) {
    const t = byTown.get(p.city) ?? { total: 0, done: 0, active: 0 };
    t.total++;
    if (!isCrossedOff(p)) t.active++;
    if (isCrossedOff(p) || visited.has(p.id)) t.done++;
    byTown.set(p.city, t);
  }
  const townsVisited = new Set(
    parks.filter((p) => visited.has(p.id)).map((p) => p.city),
  ).size;
  // A town with one real playground is too easy to count as "every park".
  const bigTowns = [...byTown.values()].filter((t) => t.active >= 2);
  const bestTown = bigTowns.reduce<{ total: number; done: number } | null>(
    (best, t) =>
      !best || t.done / t.total > best.done / best.total ? t : best,
    null,
  );

  const splashParks = active.filter((p) => p.features.includes("splash_pad"));
  const splashDone = splashParks.filter((p) => visited.has(p.id)).length;

  const seasons = new Set(visits.map((v) => seasonOf(v.visitedOn)));
  const bestWeekend = maxDistinct(
    visits.map((v) => [weekendKey(v.visitedOn), v.parkId]),
  );
  const bestDay = maxDistinct(
    visits.map((v) => [v.visitedOn.slice(0, 10), v.parkId]),
  );
  const mostDaysAtOnePark = maxDistinct(
    visits.map((v) => [v.parkId, v.visitedOn.slice(0, 10)]),
  );

  const duds = parks.filter((p) => isCrossedOff(p) && visited.has(p.id)).length;
  const taggedReviews = reviews.filter((r) => (r.tags?.length ?? 0) > 0).length;
  const headsUp = new Set(headsUpKeys);
  const scout = reviews.some((r) => r.tags?.some((t) => headsUp.has(t)));

  const badges: Badge[] = [
    {
      id: "first-stamp",
      emoji: "🎟️",
      title: "First Stamp",
      line: "Every quest starts here.",
      color: "yellow",
      earned: visits.length > 0,
      progress: null,
    },
  ];

  for (const m of MILESTONES) {
    if (m.n > active.length) continue;
    badges.push({
      id: `parks-${m.n}`,
      emoji: m.emoji,
      title: m.title,
      line: m.line,
      color: m.color,
      earned: prog.coloredIn >= m.n,
      progress: { have: Math.min(prog.coloredIn, m.n), need: m.n },
    });
  }

  badges.push(
    {
      id: "road-trip",
      emoji: "🚗",
      title: "Road Trip",
      line: "Played in 3 towns.",
      color: "blue",
      earned: townsVisited >= 3,
      progress: { have: Math.min(townsVisited, 3), need: 3 },
    },
    {
      id: "town-hero",
      emoji: "🏰",
      title: "Town Hero",
      line: "Every park in a town!",
      color: "purple",
      earned: bigTowns.some((t) => t.done === t.total),
      progress: bestTown ? { have: bestTown.done, need: bestTown.total } : null,
    },
    {
      id: "park-hopper",
      emoji: "🐇",
      title: "Park Hopper",
      line: "Two parks in one day.",
      color: "pink",
      earned: bestDay >= 2,
      progress: null,
    },
    {
      id: "weekend-warrior",
      emoji: "⚡",
      title: "Weekend Warrior",
      line: "3 parks, 1 weekend.",
      color: "orange",
      earned: bestWeekend >= 3,
      progress: { have: Math.min(bestWeekend, 3), need: 3 },
    },
    {
      id: "encore",
      emoji: "🔁",
      title: "Again! Again!",
      line: "Went back for more.",
      color: "teal",
      earned: mostDaysAtOnePark >= 2,
      progress: null,
    },
    {
      id: "every-season",
      emoji: "🍂",
      title: "Every Season",
      line: "Snow, mud, sun, leaves.",
      color: "brown",
      earned: seasons.size >= 4,
      progress: { have: seasons.size, need: 4 },
    },
  );

  if (splashParks.length > 0) {
    badges.push({
      id: "splash-master",
      emoji: "💦",
      title: "Splash Master",
      line: "Every splash pad. Soaked!",
      color: "blue",
      earned: splashDone === splashParks.length,
      progress: { have: splashDone, need: splashParks.length },
    });
  }

  badges.push(
    {
      id: "myth-buster",
      emoji: "🕵️",
      title: "Myth Buster",
      line: "Went. No playground. Ha!",
      color: "brown",
      earned: duds > 0,
      progress: null,
    },
    {
      id: "report-card",
      emoji: "📝",
      title: "Report Card",
      line: "5 reviews with details.",
      color: "green",
      earned: taggedReviews >= 5,
      progress: { have: Math.min(taggedReviews, 5), need: 5 },
    },
    {
      id: "safety-scout",
      emoji: "🦺",
      title: "Safety Scout",
      line: "Flagged a heads-up.",
      color: "orange",
      earned: scout,
      progress: null,
    },
    {
      id: "perfect",
      emoji: "⭐",
      title: "Perfect 5.0",
      line: "Found a perfect park.",
      color: "yellow",
      earned: reviews.some((r) => r.tenths === 50),
      progress: null,
    },
    {
      id: "tough-crowd",
      emoji: "🌧️",
      title: "Tough Crowd",
      line: "Gave one under 2 stars.",
      color: "teal",
      earned: reviews.some((r) => r.tenths < 20),
      progress: null,
    },
    {
      id: "shutterbug",
      emoji: "📸",
      title: "Shutterbug",
      line: "Snapped a park photo.",
      color: "pink",
      earned: photoCount > 0,
      progress: null,
    },
    {
      id: "whole-shebang",
      emoji: "👑",
      title: "The Whole Shebang",
      line: "Every playground. Done!",
      color: "red",
      earned: prog.total > 0 && prog.done >= prog.total,
      progress: { have: prog.done, need: prog.total },
    },
  );

  return badges;
}

// ---------------------------------------------------------------- fun stats

export type StatsMember = { id: number; name: string };
export type StatsPark = {
  id: number;
  slug: string;
  name: string;
  city: string;
};

export type PassportStats = {
  totalVisits: number;
  thisMonth: number;
  /** Consecutive calendar months with a visit, ending this month or last. */
  monthStreak: number;
  /** True when the streak counts last month but this month has no visit yet. */
  streakAtRisk: boolean;
  favorite: (StatsPark & { avgTenths: number; reviews: number }) | null;
  critics: { id: number; name: string; avgTenths: number; reviews: number }[];
};

function monthIndex(iso: string): number {
  const d = day(iso);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export function computeStats(args: {
  visits: BadgeVisit[];
  reviews: BadgeReview[];
  members: StatsMember[];
  parks: StatsPark[];
  /** Today, "YYYY-MM-DD", in the crew's local time. */
  today: string;
}): PassportStats {
  const { visits, reviews, members, parks, today } = args;
  const nowMonth = monthIndex(today);
  const months = new Set(visits.map((v) => monthIndex(v.visitedOn)));
  const thisMonth = visits.filter(
    (v) => monthIndex(v.visitedOn) === nowMonth,
  ).length;

  let start = months.has(nowMonth) ? nowMonth : nowMonth - 1;
  const streakAtRisk = !months.has(nowMonth) && months.has(nowMonth - 1);
  let monthStreak = 0;
  while (months.has(start)) {
    monthStreak++;
    start--;
  }

  const parkById = new Map(parks.map((p) => [p.id, p]));
  const perPark = new Map<number, number[]>();
  for (const r of reviews) {
    if (!perPark.has(r.parkId)) perPark.set(r.parkId, []);
    perPark.get(r.parkId)!.push(r.tenths);
  }
  let favorite: PassportStats["favorite"] = null;
  for (const [parkId, list] of perPark) {
    const park = parkById.get(parkId);
    if (!park) continue;
    const avg = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
    if (
      !favorite ||
      avg > favorite.avgTenths ||
      (avg === favorite.avgTenths && list.length > favorite.reviews)
    ) {
      favorite = { ...park, avgTenths: avg, reviews: list.length };
    }
  }

  const critics = members
    .map((m) => {
      const mine = reviews.filter((r) => r.explorerId === m.id);
      return {
        id: m.id,
        name: m.name,
        reviews: mine.length,
        avgTenths: mine.length
          ? Math.round(mine.reduce((a, r) => a + r.tenths, 0) / mine.length)
          : 0,
      };
    })
    .filter((c) => c.reviews > 0);

  return {
    totalVisits: visits.length,
    thisMonth,
    monthStreak,
    streakAtRisk,
    favorite,
    critics,
  };
}

/** A playful label for how someone rates. */
export function criticStyle(avgTenths: number): string {
  if (avgTenths >= 45) return "is easy to please";
  if (avgTenths >= 38) return "loves a good park";
  if (avgTenths >= 30) return "is a fair judge";
  return "is a tough critic";
}
