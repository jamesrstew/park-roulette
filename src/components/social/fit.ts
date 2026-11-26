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

/**
 * The same card on a 9:16 Story frame (the Story echo, lib/social/echo.ts):
 * the same width, taller, and clear of the bands Instagram draws over (the
 * top and bottom 250 px). Slides.tsx Frame draws it.
 */
export const STORY_CONTENT = { width: 890, height: 1250 } as const;

/**
 * Story frames try a step or two larger type first (the taller card has
 * the room), then the feed's own sizes, so a frame never sets smaller
 * type than its feed slide.
 */
export const STORY_TYPE = {
  ideaBody: [64, 62, 60],
  eventBody: [74, 72, 70],
  eventTitle: [128, 122],
  itemWhat: [76, 72],
  itemName: [120, 116],
} as const;

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
  height: number = CONTENT.height,
): {
  body: number;
  title: number;
  fits: boolean;
} {
  const title = ideaTitleSize(s.title).size;
  for (const body of bodies)
    if (ideaHeight(s, body) <= height) return { body, title, fits: true };
  const body = bodies[bodies.length - 1];
  return { body, title, fits: ideaHeight(s, body) <= height };
}

// --- The roundup's event slide ------------------------------------------------

export const EVENT = {
  /**
   * Where the block's space starts, under the date block (which ends near
   * 205): about 50 px clear, matching the space to the footer's logo.
   */
  top: 256,
  title: [116, 104, 92, 80, 72, 68, 64],
  /** The descriptor, the venue, then "Hosted by" and "Also". */
  body: [68, 66, 64, 62, 60, 58, 56, 54, 52],
  chip: 48,
  /** Title to descriptor: tight, so they read as one thought. */
  descGap: 8,
  /** Venue to "Hosted by" (a pair), then to the chips. */
  hostGap: 14,
  chipGap: 24,
  /** The block keeps at least this far above the card's foot (clear of the footer). */
  foot: 24,
  /** A short crayon rule above the venue, so the space between reads as a pause. */
  rule: 30,
  /** Titles stop short of the right edge, matching the left margin. */
  titleWidth: 860,
  /** The descriptor (or title) to the short rule: a fixed gap, never a hole. */
  ruleGap: 32,
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

/** The venue line's size (ink), and the quieter host line's (gray, 0.85x the venue). */
export const venueSize = (body: number) => body + 2;
export const hostSize = (body: number) => Math.round(venueSize(body) * 0.85);

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
  return (
    EVENT.top + t + desc + EVENT.ruleGap + venue + foot + chips + EVENT.foot
  );
}

/** The descriptor is one or two lines, never three (a third reads as a paragraph). */
export const DESC_LINES = 2;
const descLines = (s: EventCopy, body: number) =>
  s.desc ? lines(s.desc, body, CONTENT.width) : 0;

/** A title always reads as the title: at least this much bigger than the body. */
export const TITLE_OVER_BODY = 1.35;

/**
 * The largest sizes that fit: the title gives way first, the body text
 * last, and the title never drops below 1.3x the body (if it would, the
 * body steps down instead).
 */
export function eventFit(
  s: EventCopy,
  bodies: readonly number[] = EVENT.body,
  titles: readonly number[] = EVENT.title,
  height: number = CONTENT.height,
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
        eventHeight(s, title, body) <= height
      )
        return { title, body, fits: true };
  const body = bodies[bodies.length - 1];
  const title =
    [...titles].reverse().find((t) => t >= body * TITLE_OVER_BODY) ?? titles[0];
  return {
    title,
    body,
    fits:
      descLines(s, body) <= DESC_LINES && eventHeight(s, title, body) <= height,
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

// --- The Unpack carousel's item slide -----------------------------------------

export const ITEM = {
  /** The number blob and the big icon. */
  header: 250,
  /** The "what kids do" line, largest first. */
  what: [68, 64, 60, 56, 52],
  name: [108, 92, 80, 72],
  chip: 48,
  /** Name to scribble to what; what to the where-and-who lines. */
  whatGap: 22,
  placeGap: 26,
  hostGap: 10,
  /** The middle column to the chips. */
  chipsGap: 24,
} as const;

/** An event item's venue line (ink) and host line (gray, 0.9x), from the what size. */
export const itemPlaceSize = (what: number) => Math.round(what * 0.85);
export const itemHostSize = (what: number) =>
  Math.round(itemPlaceSize(what) * 0.9);

export type ItemCopy = {
  name: string;
  what: string;
  place?: string;
  host?: string | null;
  facts: readonly string[];
};

export function itemHeight(s: ItemCopy, name: number, what: number): number {
  const middle =
    lines(s.name, name, CONTENT.width) * name * 1.04 +
    38 +
    ITEM.whatGap +
    lines(s.what, what, CONTENT.width) * what * 1.2 +
    (s.place
      ? ITEM.placeGap +
        lines(s.place, itemPlaceSize(what), CONTENT.width) *
          itemPlaceSize(what) *
          1.15
      : 0) +
    (s.host
      ? ITEM.hostGap +
        lines(`Hosted by ${s.host}`, itemHostSize(what), CONTENT.width) *
          itemHostSize(what) *
          1.15
      : 0);
  const chips = s.facts.length
    ? chipRows(s.facts) * (ITEM.chip * 1.2 + 26) +
      (chipRows(s.facts) - 1) * 16 +
      ITEM.chipsGap
    : 0;
  return ITEM.header + middle + chips;
}

/**
 * The item slide's sizes: the largest "what" that fits (the name gives way
 * first and stays 1.35x the "what"), so the where-and-who lines and the
 * chips never collide.
 */
export function itemFit(
  s: ItemCopy,
  {
    whats = ITEM.what,
    names = ITEM.name,
    height = CONTENT.height,
  }: {
    whats?: readonly number[];
    names?: readonly number[];
    height?: number;
  } = {},
): {
  name: number;
  what: number;
  fits: boolean;
} {
  for (const what of whats)
    for (const name of names)
      if (name >= what * TITLE_OVER_BODY && itemHeight(s, name, what) <= height)
        return { name, what, fits: true };
  const what = whats[whats.length - 1];
  const name = names[names.length - 1];
  return { name, what, fits: itemHeight(s, name, what) <= height };
}

// --- The park pairing slide (mashup) --------------------------------------------

export const PAIR = {
  /** The number blob and the two icons. */
  header: 200,
  /** The two names (the place, then "+ the park"), largest first. */
  name: [104, 96, 88, 80, 72, 66],
  /** The park's trait line, largest first. */
  body: [64, 60, 58, 56, 52, 48, 46],
  /** The "At the park" label over the trait. */
  label: 46,
  /** The "+" before the park's name, in ems of the name type. */
  plus: 0.62,
  chip: 48,
  /** Names to scribble; scribble to chips; chips to the park's line. */
  scribble: 38,
  chipsGap: 26,
  traitGap: 34,
} as const;

/** Story frames: a step larger first (the taller card), then the feed's sizes. */
export const STORY_PAIR = {
  name: [120, 112],
  body: [64, 60],
} as const;

export type PairCopy = {
  place: string;
  park: string;
  chips: readonly string[];
  trait: string;
};

/** A row of chips wraps when it's wider than the card (48 px type). */
function pairChipRows(chips: readonly string[]): number {
  let rows = 1;
  let x = 0;
  for (const c of chips) {
    const w = textWidth(c, PAIR.chip) + 44 + 10;
    if (x && x + 16 + w > CONTENT.width) {
      rows++;
      x = w;
    } else x += (x ? 16 : 0) + w;
  }
  return rows;
}

export function pairHeight(s: PairCopy, name: number, body: number): number {
  const names =
    (lines(s.place, name, CONTENT.width) +
      lines(s.park, name, CONTENT.width - name * PAIR.plus)) *
    name *
    1.04;
  const rows = pairChipRows(s.chips);
  const chips = rows * (PAIR.chip * 1.2 + 26) + (rows - 1) * 16;
  const trait =
    PAIR.label * 1.2 + 6 + lines(s.trait, body, CONTENT.width) * body * 1.2;
  return (
    PAIR.header +
    names +
    PAIR.scribble +
    PAIR.chipsGap +
    chips +
    PAIR.traitGap +
    trait
  );
}

/**
 * A pair slide's sizes: the largest trait line that fits, with names at
 * least 1.35 times it (the names give way first).
 */
export function pairFit(
  s: PairCopy,
  {
    names = PAIR.name,
    bodies = PAIR.body,
    height = CONTENT.height,
  }: {
    names?: readonly number[];
    bodies?: readonly number[];
    height?: number;
  } = {},
): { name: number; body: number; fits: boolean } {
  for (const body of bodies)
    for (const name of names)
      if (name >= body * TITLE_OVER_BODY && pairHeight(s, name, body) <= height)
        return { name, body, fits: true };
  const body = bodies[bodies.length - 1];
  const name = names[names.length - 1];
  return { name, body, fits: pairHeight(s, name, body) <= height };
}

/**
 * The cover's top row (Slides.tsx HeadlineSlide): the context label and
 * date chip on the left, the icon (or the pairings' icon, "+", icon) on
 * the right. What's left for the label block, px.
 */
export const COVER = {
  icon: 170,
  pairIcon: 160,
  plus: 100,
  gap: 24,
  /** The tape's padding, each side. */
  labelPad: 26,
  labelSizes: [56, 52, 48, 44] as const,
  /** A label that won't fit one line at the last size wraps to two at this. */
  wrapSize: 48,
  chipSizes: [52, 48, 44] as const,
  /** Chip padding (24 + 16), border (2 x 5) and the icon's gap (12). */
  chipChrome: 62,
} as const;

/** The label block's width beside the cover's icons. */
export function coverLabelWidth(pair: boolean): number {
  const icons = pair
    ? 2 * COVER.pairIcon + 8 + textWidth("+", COVER.plus)
    : COVER.icon;
  return CONTENT.width - icons - COVER.gap;
}

/** Words in lines no wider than `width` at `size` (greedy). */
function wrapWords(text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const w of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last && textWidth(`${last} ${w}`, size) <= width)
      lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  return lines;
}

/**
 * The cover label's type: the largest size that keeps it on one line,
 * else two lines at COVER.wrapSize; and the chip's (its icon the same
 * size). `fits`: false only when even that overflows (tests hold every
 * label code writes to true).
 */
export function coverFit(
  kicker: string,
  date: string | undefined,
  width: number,
): { label: number; lines: string[]; chip: number; fits: boolean } {
  const inner = width - 2 * COVER.labelPad;
  const one = COVER.labelSizes.find((z) => textWidth(kicker, z) <= inner);
  // Two lines break after a district's colon when they can ("Jefferson
  // County:" over "November break"), else wherever the words run out.
  const colon = kicker.indexOf(": ");
  const atColon =
    colon > 0 ? [kicker.slice(0, colon + 1), kicker.slice(colon + 2)] : [];
  const lines = one
    ? [kicker]
    : atColon.length &&
        atColon.every((l) => textWidth(l, COVER.wrapSize) <= inner)
      ? atColon
      : wrapWords(kicker, COVER.wrapSize, inner);
  const label = one ?? COVER.wrapSize;
  const chipW = (z: number) =>
    date ? textWidth(date, z) + z + COVER.chipChrome : 0;
  const chip = COVER.chipSizes.find((z) => chipW(z) <= width) ?? 44;
  return {
    label,
    lines,
    chip,
    fits:
      lines.length <= 2 &&
      lines.every((l) => textWidth(l, label) <= inner) &&
      chipW(chip) <= width,
  };
}
