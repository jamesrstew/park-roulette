/**
 * Will the words fit? A conservative estimate of wrapped lines and block
 * heights for the idea and event slides, so each slide can pick the
 * largest type that fits, and tests can prove the longest allowed copy
 * never overflows the 4:5 card. Pure: no Satori here.
 *
 * Widths are Gochi Hand's own advance widths (em, read from
 * public/fonts/GochiHand-Regular.ttf's hmtx table for printable ASCII),
 * with a 6% margin so the estimate errs toward more lines. Other
 * characters count as a wide 0.75 em.
 */

const ADVANCE = [
  0.237, 0.254, 0.415, 0.454, 0.449, 0.644, 0.461, 0.254, 0.283, 0.283, 0.345,
  0.486, 0.314, 0.314, 0.314, 0.24, 0.568, 0.404, 0.49, 0.519, 0.473, 0.526,
  0.507, 0.52, 0.548, 0.501, 0.314, 0.314, 0.327, 0.454, 0.327, 0.503, 0.988,
  0.59, 0.511, 0.542, 0.652, 0.623, 0.512, 0.631, 0.571, 0.24, 0.53, 0.551,
  0.366, 0.694, 0.653, 0.602, 0.552, 0.672, 0.524, 0.464, 0.385, 0.577, 0.556,
  0.85, 0.53, 0.464, 0.647, 0.336, 0.294, 0.336, 0.447, 0.513, 0.424, 0.555,
  0.528, 0.34, 0.586, 0.516, 0.306, 0.569, 0.537, 0.217, 0.291, 0.446, 0.22,
  0.71, 0.475, 0.519, 0.492, 0.598, 0.354, 0.368, 0.408, 0.469, 0.441, 0.775,
  0.526, 0.492, 0.441, 0.359, 0.25, 0.359, 0.474,
];
const MARGIN = 1.06;

/** A text's width in px at this size. */
export function textWidth(text: string, size: number, margin = MARGIN): number {
  let em = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    em += c >= 32 && c < 127 ? ADVANCE[c - 32] : 0.75;
  }
  return em * size * margin;
}

/** The card's content box (Frame: left 90, right 100, top 92, bottom 170). */
export const CONTENT = { width: 890, height: 1088 } as const;

/** Lines a text wraps to at this size in this width (greedy, by words). */
export function lines(text: string, size: number, width: number): number {
  const space = textWidth(" ", size);
  let n = 1;
  let cur = 0;
  for (const w of text.trim().split(/\s+/)) {
    const ww = textWidth(w, size);
    if (cur === 0) cur = ww;
    else if (cur + space + ww <= width) cur += space + ww;
    else {
      n++;
      cur = ww;
    }
  }
  return n;
}

// --- The "at home" idea slide -------------------------------------------------

export const IDEA = {
  /** Body type, largest first: steps, what you need, the payoff. */
  body: [58, 56, 54, 52, 50],
  /** The title on one line if it can be, else two at the smallest. */
  title: [96, 88, 80, 72],
  needLabelW: 170,
  stepIndent: 76,
  payoffIndent: 80,
  gap: 16,
  /** The kicker row: "Idea 1 of 4", the ages chip, the icon. */
  header: 100,
} as const;

export type IdeaCopy = {
  title: string;
  need: string;
  steps: readonly string[];
  /** Old queued posts have none: then no payoff box. */
  payoff?: string;
  safety: string | null;
};

export function ideaTitleSize(title: string): { size: number; lines: number } {
  for (const size of IDEA.title)
    if (lines(title, size, CONTENT.width) === 1) return { size, lines: 1 };
  const size = IDEA.title[IDEA.title.length - 1];
  return { size, lines: lines(title, size, CONTENT.width) };
}

/** The idea slide's estimated height at one body size. */
export function ideaHeight(s: IdeaCopy, body: number): number {
  const t = ideaTitleSize(s.title);
  const header = IDEA.header + 8 + t.lines * t.size * 1.08 + 26;
  const needW = CONTENT.width - 2 * 24 - 8 - IDEA.needLabelW - 16;
  const need = lines(s.need, body, needW) * body * 1.18 + 30;
  const stepW = CONTENT.width - IDEA.stepIndent;
  const steps =
    s.steps.reduce(
      (h, st) => h + Math.max(60, lines(st, body, stepW) * body * 1.16),
      0,
    ) +
    16 * (s.steps.length - 1);
  const pw = CONTENT.width - IDEA.payoffIndent - 2 * 22 - 8;
  const payoff = s.payoff
    ? 40 * 1.25 + lines(s.payoff, body + 2, pw) * (body + 2) * 1.16 + 32
    : 0;
  const safety = s.safety ? 46 * 1.3 + 20 : 0;
  const blocks = 2 + (s.payoff ? 1 : 0) + (s.safety ? 1 : 0);
  return header + need + steps + payoff + safety + IDEA.gap * blocks;
}

/** The largest body size whose estimate fits the card (the smallest, else). */
export function ideaFit(
  s: IdeaCopy,
  bodies: readonly number[] = IDEA.body,
): {
  body: number;
  title: number;
  fits: boolean;
} {
  const title = ideaTitleSize(s.title).size;
  for (const body of bodies)
    if (ideaHeight(s, body) <= CONTENT.height)
      return { body, title, fits: true };
  const body = bodies[bodies.length - 1];
  return { body, title, fits: ideaHeight(s, body) <= CONTENT.height };
}

// --- The roundup's event slide ------------------------------------------------

export const EVENT = {
  /** Where the title block starts, under the date block. */
  top: 270,
  title: [116, 104, 92, 80, 72, 68, 64],
  /** The descriptor, the venue, then "Hosted by" and "Also". */
  body: [68, 66, 64, 62, 60, 58, 56, 54, 52],
  chip: 48,
  /** Title to descriptor: tight, so they read as one thought. */
  descGap: 8,
  /** Venue to "Hosted by" (a pair), then to the chips. */
  hostGap: 14,
  chipGap: 24,
  /** The facts group sits this far above the card's foot (clear of the footer). */
  foot: 24,
  /** A short crayon rule above the venue, so the space between reads as a pause. */
  rule: 30,
  /** Titles stop short of the right edge, matching the left margin. */
  titleWidth: 860,
  /**
   * At least this much air between what it is (top) and where (foot),
   * plus the rule's own 30 px above the venue.
   */
  split: 24,
} as const;

export type EventCopy = {
  title: string;
  desc: string | null;
  /** "At Sisters Library", "At Fir Street Park, Sisters". */
  place: string;
  chips: readonly string[];
  host: string | null;
  also: string | null;
};

/** Chip rows: chips wrap across the width (each about its text plus 64 px). */
function chipRows(chips: readonly string[]): number {
  let rows = 1;
  let x = 0;
  for (const c of chips) {
    const w = textWidth(c, EVENT.chip) + 64;
    if (x && x + 18 + w > CONTENT.width) {
      rows++;
      x = w;
    } else x += (x ? 18 : 0) + w;
  }
  return rows;
}

/** The venue line's size (ink), and the quieter host line's (gray, 0.9x). */
export const venueSize = (body: number) => body + 2;
export const hostSize = (body: number) => Math.round(body * 0.9);

export function eventHeight(s: EventCopy, title: number, body: number): number {
  // What it is, from the top: the title, its scribble, the descriptor.
  const t = lines(s.title, title, EVENT.titleWidth) * title * 1.06 + 32;
  const desc = s.desc
    ? lines(s.desc, body, CONTENT.width) * body * 1.2 + EVENT.descGap
    : 0;
  // Where and for whom, from the foot: rule, venue, host, chips.
  const v = venueSize(body);
  const venue = EVENT.rule + lines(s.place, v, CONTENT.width) * v * 1.15;
  // A chip: its line, 16 px of padding and a 5 px border top and bottom.
  const chips =
    chipRows(s.chips) * (EVENT.chip * 1.2 + 26) +
    (chipRows(s.chips) - 1) * 18 +
    EVENT.chipGap;
  // "Also Sat, Sun" sits up top under the time, so only the host is here.
  const h = hostSize(body);
  const foot = s.host
    ? lines(`Hosted by ${s.host}`, h, CONTENT.width) * h * 1.15 + EVENT.hostGap
    : 0;
  return EVENT.top + t + desc + EVENT.split + venue + foot + chips + EVENT.foot;
}

/** The descriptor is one or two lines, never three (a third reads as a paragraph). */
export const DESC_LINES = 2;
const descLines = (s: EventCopy, body: number) =>
  s.desc ? lines(s.desc, body, CONTENT.width) : 0;

/** A title always reads as the title: at least this much bigger than the body. */
export const TITLE_OVER_BODY = 1.3;

/**
 * The largest sizes that fit: the title gives way first, the body text
 * last, and the title never drops below 1.3x the body (if it would, the
 * body steps down instead).
 */
export function eventFit(
  s: EventCopy,
  bodies: readonly number[] = EVENT.body,
  titles: readonly number[] = EVENT.title,
): {
  title: number;
  body: number;
  fits: boolean;
} {
  for (const body of bodies)
    for (const title of titles)
      if (
        title >= body * TITLE_OVER_BODY &&
        descLines(s, body) <= DESC_LINES &&
        eventHeight(s, title, body) <= CONTENT.height
      )
        return { title, body, fits: true };
  const body = bodies[bodies.length - 1];
  const title =
    [...titles].reverse().find((t) => t >= body * TITLE_OVER_BODY) ?? titles[0];
  return {
    title,
    body,
    fits:
      descLines(s, body) <= DESC_LINES &&
      eventHeight(s, title, body) <= CONTENT.height,
  };
}

/**
 * One body size for a whole carousel, so its slides read as a set: the
 * largest that fits every slide.
 */
export function commonBody(
  fits: readonly { body: number }[],
): number | undefined {
  return fits.length ? Math.min(...fits.map((f) => f.body)) : undefined;
}

/** The event slide's top row, beside the date block: the time and "Also". */
export const TOP_ROW = {
  width: CONTENT.width - 250 - 40,
  time: 68,
  also: 50,
} as const;

/** The largest size, up to `max`, at which a text stays on one line in `width`. */
export function oneLine(text: string, max: number, width: number): number {
  let size = max;
  while (size > 30 && textWidth(text, size) > width) size -= 2;
  return size;
}
