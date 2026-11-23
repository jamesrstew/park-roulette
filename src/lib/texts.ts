/**
 * Weekend Pick: the words, frozen per consent version, and the reply
 * keywords. Pure (no server imports), so the browser and tests use it too.
 *
 * Program name (carrier filing, Terms): "Park Roulette Weekend Pick". In
 * the app it's "Weekend Pick" everywhere (the glossary in
 * lib/park-news.ts); every text starts "Park Roulette:".
 */

export const PROGRAM_NAME = "Park Roulette Weekend Pick";

/** The number park texts come from, once registered (E.164), or null. */
export const TEXTS_FROM: string | null =
  process.env.NEXT_PUBLIC_TEXTS_NUMBER || null;

/** "(541) 555-0199" */
export function prettyPhone(e164: string): string {
  const d = e164.replace(/^\+1/, "");
  return /^\d{10}$/.test(d)
    ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    : e164;
}

/** Bump with any change to the words below; old versions stay, frozen. */
export const TEXTS_CONSENT_VERSION = "sms-2026-11-21";

export type ConsentWords = {
  /** {number} is the number, or "this number" when typing one in. */
  checkbox: string;
  disclosure: string;
  button: string;
};

/**
 * The exact words someone saw when they said yes, by consent_version, so a
 * carrier or court can be shown them later. Never edit a version: add one.
 */
export const TEXTS_CONSENT_TEXT: Record<string, ConsentWords> = {
  "sms-2026-11-19": {
    checkbox:
      "Yes, text me a weekend park pick from Park Roulette at {number}.",
    disclosure:
      "About 1 automated text a week, on Fridays (up to 5 a month). Message and data rates may apply. Reply HELP for help, STOP to opt out. You don't have to agree to texts to use Park Roulette.",
    button: "Text me Fridays",
  },
  // The program name from the 10DLC filing, once, at the top.
  "sms-2026-11-20": {
    checkbox:
      "Yes, text me a weekend park pick from Park Roulette at {number}.",
    disclosure:
      "Park Roulette Weekend Pick: about 1 automated text a week, on Fridays (up to 5 a month). Message and data rates may apply. Reply HELP for help, STOP to opt out. You don't have to agree to texts to use Park Roulette.",
    button: "Text me Fridays",
  },
  // /texts v2: the program's own name in the checkbox.
  "sms-2026-11-21": {
    checkbox: "Yes, text me the Weekend Pick at {number}.",
    disclosure:
      "Park Roulette Weekend Pick: about 1 automated text a week, on Fridays (up to 5 a month). Message and data rates may apply. Reply HELP for help, STOP to opt out. You don't have to agree to texts to use Park Roulette.",
    button: "Text me Fridays",
  },
  // Batch 6: one wording per surface. The welcome sheet's picks page: the
  // same box and disclosure, under the sheet's own button.
  "sms-2026-11-22-sheet": {
    checkbox: "Yes, text me the Weekend Pick at {number}.",
    disclosure:
      "Park Roulette Weekend Pick: about 1 automated text a week, on Fridays (up to 5 a month). Message and data rates may apply. Reply HELP for help, STOP to opt out. You don't have to agree to texts to use Park Roulette.",
    button: "Let's spin!",
  },
  // The site footer's card for signed-in grown-ups with a fresh code: the
  // unchecked box, then the button (the filed CQXRMSG flow; never one tap).
  "sms-2026-11-22-footer": {
    checkbox: "Yes, text me the Weekend Pick at {number}.",
    disclosure:
      "Park Roulette Weekend Pick: about 1 automated text a week, on Fridays (up to 5 a month). Message and data rates may apply. Reply HELP for help, STOP to opt out. You don't have to agree to texts to use Park Roulette.",
    button: "Text me Fridays",
  },
};

/** Where a yes can come from (recorded as the consent's source). */
export const TEXT_SOURCES = [
  "texts_page",
  "settings",
  "welcome_sheet",
  // Ask moments (lib/asks.ts).
  "next_pick",
  "rainy_spin",
  "weekend_spin",
  // The Weekend Pick line in the email footer and welcome email.
  "email_footer",
  // The site footer's card (signed-in grown-ups with a fresh code).
  "site_footer",
  // An issue page reached from a Weekend Pick text, or a forward of one.
  "issue_text",
  "issue_page",
  // /social (was /ig): Instagram's link in bio, its keyword DM, Facebook.
  "ig_bio",
  "ig_dm",
  "fb",
] as const;
export type TextSource = (typeof TEXT_SOURCES)[number];

/**
 * The wording each surface shows today. A yes is accepted only with its
 * own surface's version: the sheet's words never count from the footer,
 * and the other way around.
 */
const SOURCE_VERSION: Partial<Record<TextSource, string>> = {
  welcome_sheet: "sms-2026-11-22-sheet",
  site_footer: "sms-2026-11-22-footer",
};

/** The consent version a surface shows (and the only one it accepts). */
export function consentVersionFor(source: string): string {
  return SOURCE_VERSION[source as TextSource] ?? TEXTS_CONSENT_VERSION;
}

/** What the browser says the person agreed to (recorded with the yes). */
export type Agreement = {
  agreed: true;
  version: string;
  /** The checkbox line and disclosure exactly as rendered. */
  checkbox: string;
  disclosure: string;
};

/**
 * Is this the exact wording `source` shows today, with the box checked?
 * The server refuses a yes that doesn't match what that surface shows,
 * including another surface's words.
 *
 * The limit: `source` is what the browser says, so this binds the words
 * to the surface they claim, not proof of where the tap happened. A
 * crafted request could claim the footer and send the footer's words.
 * That's still a checked box with the full disclosure (every version
 * shows the same box and disclosure), so the record stays truthful about
 * what was agreed to; only the surface is self-reported.
 */
export function agreementOk(
  a: unknown,
  number: string | null,
  source: string,
): boolean {
  if (!a || typeof a !== "object") return false;
  const x = a as Partial<Agreement>;
  const version = consentVersionFor(source);
  const w = TEXTS_CONSENT_TEXT[version];
  return (
    x.agreed === true &&
    x.version === version &&
    x.disclosure === w.disclosure &&
    (x.checkbox === checkboxLine(version, number) ||
      x.checkbox === checkboxLine(version, null))
  );
}

export const TEXTS_COPY = {
  headline: "Want a weekend park pick?",
  body: "One playground to try, every Friday afternoon.",
  unchecked: "Check the box first, so we know it's a yes.",
  stale: "This page changed since you opened it. Please reload the page.",
  failure: "That didn't go through. Try again?",
  codeFirst: "We'll text you a code first.",
  title: "Weekend Pick",
  subtitle: "One playground for the weekend, texted Friday afternoons.",
  firstLooksLike:
    "First we'll send a quick confirmation. Your Friday texts will look like this:",
  off: "One playground to try, every Friday, by text.",
  noNumber: "Add your number first, then you can turn on park texts.",
  borrowed: "Sign in with your own number to get park texts.",
  kids: "Ask a grown-up to turn on park texts.",
  usOnly: "Park texts are for US numbers only.",
  changed: "Texts are off because your number changed.",
  /** The site footer card, signed in with a fresh code (batch 6). */
  footerRather: "Rather get a text?",
  footerToo: "Want it by text too?",
  /** The link when the email is on but there's no fresh code. */
  footerTooLink: "Want the Weekend Pick by text too?",
  /** After a yes from the sheet or the footer (the confirmation goes now). */
  hello: "You're in! Watch for a hello text from Park Roulette.",
} as const;

/** The checkbox line with the number filled in. */
export function checkboxLine(version: string, number: string | null): string {
  const w =
    TEXTS_CONSENT_TEXT[version] ?? TEXTS_CONSENT_TEXT[TEXTS_CONSENT_VERSION];
  return w.checkbox.replace(
    "{number}",
    number ? prettyPhone(number) : "this number",
  );
}

// --- The texts we send (GSM-7) ----------------------------------------------

/**
 * Every text we send. All are one SMS segment except `confirmation`, an MMS
 * that carries our contact card (/park-roulette.vcf); if Twilio refuses the
 * media it goes as `confirmationSms` instead. iOS loads link previews only
 * from saved contacts (else "Tap to Load Preview"), hence "Save this
 * contact".
 */
export const TEXTS = {
  confirmation:
    "Park Roulette: You're in! One playground pick every Friday afternoon (up to 5/mo). Save this contact to see weekend previews. Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
  confirmationSms:
    "Park Roulette: You're in! 1 weekend playground pick a week, Fridays (up to 5/mo). Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
  help: "Park Roulette: Weekend Pick, about 1 text a week on Fridays. Help: hello@parkroulette.quest. Msg & data rates may apply. Reply STOP to opt out.",
  stop: "Park Roulette: You're unsubscribed and won't get more texts. Reply START to rejoin.",
  start:
    "Park Roulette: Welcome back! 1 weekend playground pick a week, Fridays (up to 5/mo). Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
} as const;

/**
 * A Weekend Pick as it looks (batch 6 sample 2), for the success state.
 * Its link is the December 3, 2026 issue; until that issue goes out it
 * lands on the home page.
 */
export const SAMPLE_TEXT =
  "Park Roulette: Sunny Sat and Sun, 47 and 49. Go Saturday: Wildflower Park, Bend. Fenced toddler area. Reply STOP to opt out. https://parkroulette.quest/w/5ljn";

/** GSM-7 only (one bad character makes a text Unicode: 70 a segment). */
export function isGsm7(s: string): boolean {
  return /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(
    s,
  );
}

/** GSM-7's extended characters: each takes two of a segment's 160. */
const GSM_EXTENDED = /[\^{}\\[~\]|€\f]/g;

/** A GSM-7 text's length in septets (what the 160 limit counts). */
export function septets(s: string): number {
  return s.length + (s.match(GSM_EXTENDED)?.length ?? 0);
}

/** Curly quotes, dashes, ellipses and odd spaces, as plain ASCII. */
export function toGsmAscii(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2000-\u200A\u202F]/g, " ");
}

// --- Replies ---------------------------------------------------------------

export type Keyword = "stop" | "start" | "help" | "stop_like" | "other";

const STOP_WORDS = new Set([
  "STOP",
  "STOPALL",
  "STOP ALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPT OUT",
  "OPTOUT",
]);
/** START only (never YES): and only from a number on our STOP list. */
const START_WORDS = new Set(["START", "UNSTOP"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

/**
 * What a reply means. Any reasonable way of saying no counts as a stop
 * (the FCC's revocation rule): "no more", "stop texting me", "wrong
 * number", "remove me"...
 */
export function classifyReply(body: string): Keyword {
  // iPhones type curly apostrophes ("Don’t text me").
  const t = toGsmAscii(body)
    .trim()
    .toUpperCase()
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "")
    .replace(/\s+/g, " ");
  if (STOP_WORDS.has(t)) return "stop";
  if (START_WORDS.has(t)) return "start";
  if (HELP_WORDS.has(t)) return "help";
  // END, short of a sentence like "the end of the trail": at the start or
  // end of a short reply ("Please end", "End it"), or ending texts.
  if (
    /^(PLEASE )?END\b|\bEND( IT| THIS| THEM)?( PLEASE)?$|\bEND (\w+ ){0,2}(TEXTS?|TEXTING|MESSAGES?|SUBSCRIPTION|PICKS?)\b/.test(
      t,
    ) &&
    !/\bTHE END\b|\bEND OF\b/.test(t)
  )
    return "stop_like";
  if (
    /\b(STOP|UNSUB(SCRIBE)?|CANCEL|QUIT|REVOKE|OPT ?OUT|NO MORE|WRONG NUMBER|REMOVE ME|TAKE ME OFF|NOT INTERESTED|DON'?T TEXT|DO NOT TEXT|LEAVE ME ALONE|BASTA|PARAR)\b/.test(
      t,
    )
  )
    return "stop_like";
  return "other";
}
