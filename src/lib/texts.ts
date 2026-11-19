/**
 * Weekend texts: the words, frozen per consent version, and the reply
 * keywords. Pure (no server imports), so the browser and tests use it too.
 *
 * Program name (carrier filings, Terms): "Park Roulette Weekend Pick". In
 * the app it's "Weekend texts" as a label and "a weekend park pick" in a
 * sentence (the glossary in lib/park-news.ts).
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
export const TEXTS_CONSENT_VERSION = "sms-2026-11-20";

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
};

/** What the browser says the person agreed to (recorded with the yes). */
export type Agreement = {
  agreed: true;
  version: string;
  /** The checkbox line and disclosure exactly as rendered. */
  checkbox: string;
  disclosure: string;
};

/**
 * Is this the current version's exact wording, with the box checked?
 * The server refuses a yes that doesn't match what we show.
 */
export function agreementOk(a: unknown, number: string | null): boolean {
  if (!a || typeof a !== "object") return false;
  const x = a as Partial<Agreement>;
  const w = TEXTS_CONSENT_TEXT[TEXTS_CONSENT_VERSION];
  return (
    x.agreed === true &&
    x.version === TEXTS_CONSENT_VERSION &&
    x.disclosure === w.disclosure &&
    (x.checkbox === checkboxLine(TEXTS_CONSENT_VERSION, number) ||
      x.checkbox === checkboxLine(TEXTS_CONSENT_VERSION, null))
  );
}

export const TEXTS_COPY = {
  headline: "Want a weekend park pick?",
  body: "One playground to try, every Friday afternoon.",
  unchecked: "Check the box first, so we know it's a yes.",
  failure: "That didn't go through. Try again?",
  codeFirst: "First we'll text you a code to check it's your phone.",
  off: "One playground to try, every Friday, by text.",
  noNumber: "Add your number first, then you can turn on park texts.",
  borrowed: "Sign in with your own number to get park texts.",
  kids: "Ask a grown-up to turn on park texts.",
  usOnly: "Park texts are for US numbers only.",
  changed: "Texts are off because your number changed.",
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

// --- The texts we send (GSM-7, one segment each) ---------------------------

export const TEXTS = {
  confirmation:
    "Park Roulette: You're in! 1 weekend playground pick a week, Fridays (up to 5/mo). Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
  help: "Park Roulette: About 1 weekend playground pick a week, Fridays. Help: hello@parkroulette.quest. Msg & data rates may apply. Reply STOP to opt out.",
  stop: "Park Roulette: You're unsubscribed and won't get more texts. Reply START to rejoin.",
  start:
    "Park Roulette: Welcome back! 1 weekend playground pick a week, Fridays (up to 5/mo). Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
} as const;

/** GSM-7 only (one bad character makes a text Unicode: 70 a segment). */
export function isGsm7(s: string): boolean {
  return /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(
    s,
  );
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
  const t = body
    .trim()
    .toUpperCase()
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, " ");
  if (STOP_WORDS.has(t)) return "stop";
  if (START_WORDS.has(t)) return "start";
  if (HELP_WORDS.has(t)) return "help";
  if (
    /\b(STOP|UNSUBSCRIBE|CANCEL|QUIT|REVOKE|OPT ?OUT|NO MORE|WRONG NUMBER|REMOVE ME|DON'?T TEXT|DO NOT TEXT|LEAVE ME ALONE)\b/.test(
      t,
    )
  )
    return "stop_like";
  return "other";
}
