import { addDays, daysBetween, holidays, weekdayOf } from "@/lib/news/time";
import type { PostKind } from "./model";

/**
 * The caption's warm first line (James, November 2026: "I'd prefer the
 * warm newsletter tone also permeates into social copy as well"). Pure:
 * code's own words, from the same holiday calendar as the newsletter's
 * hello (news/time.ts) and the catalog's verified school breaks, so a
 * redraw of the same post always opens the same way.
 *
 * - A holiday or school-break window: every caption opens with a short
 *   greeting for it ("Happy Thanksgiving week."), whatever its kind.
 * - An ordinary week: the code-made captions (the events roundup, the
 *   park pairings and Thursday's teaser) open with a warm, plain line of
 *   their own; the writer's posts open with the writer's own words.
 *
 * Each window has a few variants, picked by the day within it, so posts on
 * days next to each other (or two days apart) never open alike; windows
 * share no lines, and `previous` (the last post's opener, from the post
 * history) guards a repeat anyway: an ordinary week's line steps to the
 * next, a holiday line (it belongs to its day) gives way to none. Short and genuine, never gushing:
 * at most one exclamation point, and only on the day itself (code calms
 * it when the post's own words already spend one).
 */

export type GreetingBreak = {
  id?: string;
  label: string;
  district?: string | null;
  from: string;
  to: string;
  verified?: boolean;
};

/** One stretch of days with its own greeting lines. */
type Window = { occasion: string; from: string; to: string; lines: string[] };

const pad = (n: number) => String(n).padStart(2, "0");
const md = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The day a named holiday falls on in a year (time.ts's calendar). */
function dayOf(year: number, name: string): string | null {
  const hol = holidays(year);
  return Object.keys(hol).find((d) => hol[d] === name) ?? null;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Bend-La Pine's verified winter or spring break (the largest district,
 * and the others' match it): the only breaks a greeting names.
 */
function bigBreaks(breaks: readonly GreetingBreak[]) {
  return breaks.filter(
    (b) =>
      b.verified === true &&
      /bend-la pine/i.test(`${b.district ?? ""} ${b.label}`) &&
      /\b(winter|spring) break\b/i.test(b.label),
  );
}

/** Every window that could hold this day, in priority order. */
function windows(day: string, breaks: readonly GreetingBreak[]): Window[] {
  const y = Number(day.slice(0, 4));
  const out: Window[] = [];
  // New Year's runs across the year's turn: this year's and last year's.
  for (const ny of [y, y + 1]) {
    out.push(
      {
        occasion: "New Year",
        from: md(ny - 1, 12, 31),
        to: md(ny, 1, 1),
        lines: [
          // New Year's Eve, then the day.
          `Here's to more park days in ${ny}.`,
          `Happy New Year! Here's to more park days in ${ny}.`,
        ],
      },
      {
        occasion: "New Year",
        from: md(ny, 1, 2),
        to: md(ny, 1, 6),
        lines: [
          "Happy New Year, Central Oregon.",
          "A new year of park days starts now.",
          "We hope the new year is off to a gentle start.",
        ],
      },
      {
        occasion: "New Year",
        from: md(ny - 1, 12, 28),
        to: md(ny - 1, 12, 30),
        lines: [
          "Wishing you a slow end to the year.",
          "Almost a new year. We hope the week is a quiet one.",
          `A few quiet days left in ${ny - 1}.`,
        ],
      },
    );
  }
  out.push(
    {
      occasion: "Christmas",
      from: md(y, 12, 24),
      to: md(y, 12, 25),
      // Christmas Eve, then the day.
      lines: [
        "Merry Christmas Eve, Central Oregon.",
        "Merry Christmas! We hope today is warm and slow.",
      ],
    },
    {
      occasion: "Christmas",
      from: md(y, 12, 26),
      to: md(y, 12, 27),
      lines: [
        "We hope Christmas was a good one.",
        "We hope the house is warm and the leftovers are good.",
      ],
    },
    {
      occasion: "Christmas",
      from: md(y, 12, 22),
      to: md(y, 12, 23),
      lines: ["Christmas is almost here.", "Happy holidays, Central Oregon."],
    },
  );
  const thanks = dayOf(y, "Thanksgiving");
  if (thanks)
    out.push(
      {
        occasion: "Thanksgiving",
        from: thanks,
        to: thanks,
        // Not the email's own hello: the teaser goes out beside it.
        lines: ["Happy Thanksgiving! The weekend plan is ready when you are."],
      },
      {
        occasion: "Thanksgiving",
        from: addDays(thanks, 1),
        to: addDays(thanks, 3),
        lines: [
          // Friday, Saturday, Sunday. No pie or leftovers: the writer's
          // words reach for those.
          "We hope your Thanksgiving was a cozy one.",
          "We hope the long weekend is treating you well.",
          "One more day of the long weekend.",
        ],
      },
      {
        // From the Sunday before (a school-break Unpack goes out then).
        occasion: "Thanksgiving",
        from: addDays(thanks, -4),
        to: addDays(thanks, -1),
        // Sunday, Monday, Tuesday, Wednesday.
        lines: [
          "Thanksgiving week starts tomorrow.",
          "Thanksgiving is almost here.",
          "We hope Thanksgiving week is off to an easy start.",
          "Thanksgiving is tomorrow. We hope the kitchen stays calm.",
        ],
      },
    );
  out.push(
    {
      occasion: "Halloween",
      from: md(y, 10, 31),
      to: md(y, 10, 31),
      lines: ["Happy Halloween!"],
    },
    {
      occasion: "Halloween",
      from: md(y, 10, 27),
      to: md(y, 10, 30),
      lines: [
        "Happy Halloween week.",
        "Costumes ready? Halloween is almost here.",
        "Halloween week is here, Central Oregon.",
      ],
    },
    {
      occasion: "Fourth of July",
      from: md(y, 7, 4),
      to: md(y, 7, 4),
      lines: ["Happy Fourth of July!"],
    },
    {
      occasion: "Fourth of July",
      from: md(y, 7, 5),
      to: md(y, 7, 5),
      lines: ["We hope the Fourth was a fun one."],
    },
    {
      occasion: "Fourth of July",
      from: md(y, 7, 1),
      to: md(y, 7, 3),
      lines: [
        "Happy Fourth of July week.",
        "The Fourth is almost here.",
        "Fourth of July week is here, Central Oregon.",
      ],
    },
  );
  // Long weekends: the Monday holiday, its weekend, and the days before.
  for (const [name, said] of [
    ["Memorial Day", "Memorial Day weekend"],
    ["Labor Day", "Labor Day weekend"],
    ["Martin Luther King Jr. Day", null],
    ["Presidents' Day", null],
  ] as const) {
    const mon = dayOf(y, name);
    if (!mon) continue;
    out.push(
      {
        occasion: said ?? "long weekend",
        from: addDays(mon, -2),
        to: mon,
        lines: said
          ? [
              // Memorial Day is a day of remembrance: no "Happy" (Nov 26).
              said === "Memorial Day weekend"
                ? "Memorial Day weekend is here."
                : `Happy ${said}.`,
              "Here's to a good long weekend.",
              "We hope the long weekend is a slow one.",
            ]
          : [
              "Happy long weekend.",
              "Here's to a good long weekend.",
              "We hope the long weekend is a slow one.",
            ],
      },
      {
        occasion: said ?? "long weekend",
        from: addDays(mon, -4),
        to: addDays(mon, -3),
        lines: said
          ? [`${said} is almost here.`, "A long weekend is almost here."]
          : ["A long weekend is almost here.", "The long weekend is close."],
      },
    );
  }
  // School breaks last: a holiday inside one greets the holiday.
  for (const b of bigBreaks(breaks)) {
    const kind = /\bwinter break\b/i.test(b.label) ? "winter" : "spring";
    const Kind = kind === "winter" ? "Winter" : "Spring";
    out.push(
      {
        occasion: `${kind} break`,
        from: b.from,
        to: b.from,
        lines: [`Happy ${kind} break.`],
      },
      {
        occasion: `${kind} break`,
        from: addDays(b.from, 1),
        to: b.to,
        lines: [
          `${Kind} break is here.`,
          `Wishing you a good ${kind} break.`,
          `We hope ${kind} break is off to a good start.`,
        ],
      },
      // The weekend after it, only when the break ends on a Friday (then
      // that Saturday and Sunday are still time off).
      ...(weekdayOf(b.to) === 5
        ? [
            {
              occasion: `${kind} break`,
              from: addDays(b.to, 1),
              to: addDays(b.to, 2),
              lines: [
                `One more weekend of ${kind} break.`,
                `The last weekend of ${kind} break is here.`,
              ],
            },
          ]
        : []),
      {
        occasion: `${kind} break`,
        from: addDays(b.from, -3),
        to: addDays(b.from, -1),
        // Filled per day below ("starts Monday", "starts tomorrow").
        lines: [],
      },
    );
  }
  // The days before a break, by how many are left: 3, 2, then 1.
  return out.map((w) => {
    if (w.lines.length) return w;
    const name = `${w.occasion[0].toUpperCase()}${w.occasion.slice(1)}`;
    const starts = addDays(w.to, 1);
    return {
      ...w,
      lines: [
        `${name} is almost here.`,
        `${name} starts ${WEEKDAY_NAMES[weekdayOf(starts)]}.`,
        `${name} starts tomorrow.`,
      ],
    };
  });
}

/** The window a day falls in (holidays first, then breaks), or null. */
export function occasionOn(
  day: string,
  breaks: readonly GreetingBreak[],
): { occasion: string; lines: string[]; index: number } | null {
  const w = windows(day, breaks).find((x) => x.from <= day && day <= x.to);
  if (!w) return null;
  return {
    occasion: w.occasion,
    lines: w.lines,
    index: daysBetween(w.from, day) % w.lines.length,
  };
}

/**
 * An ordinary week's first line, for the posts code writes by itself.
 * Never a claim: no count, no weather, no place, nothing the post's own
 * facts don't already say. They rotate week by week.
 */
export const EVERYDAY: Partial<Record<PostKind, readonly string[]>> = {
  events_week: [
    "Need a plan for an afternoon this week? Here's the list.",
    "Here's the list, so you don't have to dig for it.",
    "If the week needs a plan or two, start here.",
    "A few reasons to get out of the house, all in one place.",
  ],
  mashup: [
    "Looking for an easy outing this weekend?",
    "Two stops close together make an easy outing.",
    "Here's a weekend outing with two short stops.",
    "Need somewhere to go this weekend? Try a pair.",
  ],
  teaser: [
    "The weekend email is out.",
    "It's Thursday, so here's the weekend plan.",
    "Thursday means a fresh weekend plan.",
    "Here's the plan for the weekend, if you want one.",
  ],
};

/** Days since 1970-01-01 (for the weekly rotation). */
function dayNumber(day: string): number {
  return daysBetween("1970-01-01", day);
}

/**
 * The caption's opener for a post, or null. `previous`: the opener of the
 * post just before it (the history), never repeated.
 */
export function openerFor(
  kind: PostKind,
  slotDate: string,
  o: {
    breaks?: readonly GreetingBreak[];
    previous?: string | null;
  } = {},
): string | null {
  if (kind === "story") return null;
  const hit = occasionOn(slotDate, o.breaks ?? []);
  const lines = hit?.lines ?? EVERYDAY[kind] ?? [];
  if (!lines.length) return null;
  const start = hit
    ? hit.index
    : Math.floor(dayNumber(slotDate) / 7) % lines.length;
  // A holiday window's line is the day's own ("Thanksgiving is tomorrow"):
  // never borrow another day's. The same line just before it (two posts
  // that day): no opener rather than a repeat or a false one.
  if (hit) return lines[start] === o.previous ? null : lines[start];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[(start + i) % lines.length];
    if (line !== o.previous) return line;
  }
  return null;
}

/**
 * A holiday or school-break greeting. Code's opener says it, so the
 * writer's words never greet one too (validate.ts voiceProblems), and a
 * caption whose words already greet (a sent issue's preview) gets no
 * opener. "Happy fourth birthday" and "fourth graders" aren't greetings.
 */
export const HOLIDAY_GREETING =
  /\b(?:happy|merry)\s+(?:thanksgiving|christmas|xmas|holidays|new year|halloween|hanukkah|easter|fourth of july|4th of july|independence day|memorial day|labor day|mlk day|presidents'? day|long weekend|(?:winter|spring|fall|summer|thanksgiving) break)\b|\bseason'?s greetings\b/i;

/**
 * The opener as the post prints it: with its one exclamation point only
 * when the post's own words have none ("Happy Thanksgiving." otherwise).
 */
export function calmOpener(opener: string, rest: string): string {
  return rest.includes("!") ? opener.replace(/!/g, ".") : opener;
}

/**
 * The caption with its opener: its own first line (right above the
 * headline), or for the park post, the start of the story's paragraph.
 * A caption whose words already greet (a sent issue's preview) gets none.
 * `words`: every word of the post's own, for the exclamation point
 * (default: the lines).
 */
export function withOpener(
  opener: string | null | undefined,
  lines: readonly string[],
  { inline = false, words }: { inline?: boolean; words?: string } = {},
): string[] {
  if (!opener || !lines.length) return [...lines];
  const rest = [lines.join("\n"), words ?? ""].join("\n");
  if (HOLIDAY_GREETING.test(rest)) return [...lines];
  const line = calmOpener(opener, rest);
  // Its own line straight above the headline (no blank line), so both
  // show before Instagram's "more".
  return inline ? [`${line} ${lines[0]}`, ...lines.slice(1)] : [line, ...lines];
}

/**
 * The opener of the post just before a day, from the post history (any
 * order; posts without one count as none).
 */
export function previousOpener(
  recent: readonly { slotDate: string; opener?: string | null }[],
  slotDate: string,
): string | null {
  let best: { slotDate: string; opener?: string | null } | null = null;
  for (const r of recent)
    if (r.slotDate < slotDate && (!best || r.slotDate > best.slotDate))
      best = r;
  return best?.opener ?? null;
}
