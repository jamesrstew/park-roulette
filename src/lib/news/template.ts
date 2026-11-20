import { ageTags } from "@/lib/events/ages";
import type { Catalog } from "./catalog";
import {
  type WeatherDay,
  weatherAlt,
  weatherSize,
} from "@/components/news/WeatherCard";
import type { ForecastDay, Issue } from "./issue";
import { longDate, shortDay } from "./time";

/**
 * THE email template for Bend Playground Passport: issue JSON in, HTML and
 * plain text out. All styling lives in this file (the crayon palette and
 * table layout from the first mockup), so a designer can rework it without
 * touching the pipeline. Pure: no server imports.
 *
 * Every piece of text is escaped here; the issue JSON is never trusted as
 * HTML.
 */

export const NEWS_NAME = "Bend Playground Passport";

/**
 * The quiet Weekend Pick line in the issue footer and the welcome email
 * (James, November 2026). /texts records the yes's source as email_footer.
 */
export const TEXTS_CROSS_SELL = {
  lead: "Want the weekend's park by text?",
  text: "Get the Weekend Pick on Fridays",
  path: "/texts?from=email_footer",
} as const;
export const NEWS_TAGLINE = "Central Oregon playgrounds, rain or shine.";

// --- Palette and type (the crayon box) -----------------------------------

const C = {
  page: "#f4ecdc",
  paper: "#fffaf0",
  ink: "#2b2a33",
  soft: "#5c5a66",
  link: "#1f62b8",
  red: "#e5432f",
  orange: "#f08a24",
  yellow: "#f7c933",
  green: "#3aa35b",
  blue: "#2f78d4",
  purple: "#8b5cc6",
  pink: "#ee6aa7",
  teal: "#1fa4a8",
  note: "#fdf0c4",
  buttonBlue: "#1f62b8",
  buttonGreen: "#23794a",
  buttonRed: "#c4321f",
};
const BODY = "'Trebuchet MS',Arial,sans-serif";
const HAND = "'Chalkboard SE','Comic Neue','Trebuchet MS',Arial,sans-serif";
const STRIPE = [C.red, C.orange, C.yellow, C.green, C.blue, C.purple];

// --- Helpers -------------------------------------------------------------

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * What readers see as section names. Plain on purpose; the code keeps its
 * own names (wheel_pick, plan_b, ...).
 */
export const SECTIONS = {
  weather: "The weekend ahead",
  pick: "Featured park",
  backup: "Indoor pick",
  window: "Best time to go",
  headsUp: "Heads up",
  weekend: "This weekend",
  passport: "Passport challenge",
  meme: "Parents' corner",
} as const;

type PhotoCredit = {
  src: string;
  author?: string;
  license?: string;
  licenseUrl?: string;
  sourceUrl: string;
};

/** The caption under a featured-park photo, as HTML and as text. */
function photoCredit(p: PhotoCredit): { html: string; text: string } {
  if (new URL(p.src).hostname.endsWith("bendparksandrec.org"))
    return {
      html: `Photo: ${a(p.sourceUrl, "Bend Park & Recreation District")}`,
      text: `Photo: Bend Park & Recreation District, ${p.sourceUrl}`,
    };
  const license = p.license ?? "";
  return {
    html: `Photo: ${esc(p.author ?? "")}, ${p.licenseUrl ? a(p.licenseUrl, license) : esc(license)}, via ${a(p.sourceUrl, "Wikimedia Commons")}`,
    text: `Photo: ${p.author ?? ""}, ${license}, via Wikimedia Commons: ${p.sourceUrl}`,
  };
}

/** "Larkspur Park" -> "Larkspur"; "Hollinshead Barn" stays as it is. */
export function shortParkName(name: string): string {
  const short = name.trim().replace(/\s+park$/i, "");
  return short && short !== name.trim() ? short : name.trim();
}

/** "Featured park: Larkspur", never "park" twice. */
export function featuredHeading(name: string): string {
  return `${SECTIONS.pick}: ${shortParkName(name)}`;
}

/** How wide the email shows a Parents' corner card (CSS px). */
export const CARD_EMAIL_WIDTH = 600;

/** Where an issue's Parents' corner image lives, or null without a post. */
export function postImageUrl(
  site: string,
  issue: Issue,
  key?: string,
): string | null {
  return issue.meme?.snapshot?.card
    ? `${site}/newsletter/${issue.issue_date}/post.png${key ? `?k=${key}` : ""}`
    : null;
}

/** Where an issue's weather card lives, or null without enough forecast. */
export function weatherImageUrl(
  site: string,
  issue: Issue,
  key?: string,
): string | null {
  return hasWeatherCard(issue.weekend_ahead?.days)
    ? `${site}/newsletter/${issue.issue_date}/weather.png${key ? `?k=${key}` : ""}`
    : null;
}

/** The issue's stored forecast in the weather card's shape. */
export function cardDays(days: ForecastDay[]): WeatherDay[] {
  return days.map((d) => ({
    label: d.label,
    condition: d.condition,
    icon: d.icon,
    high: d.high ?? 0,
    low: d.low,
    pop: d.precip,
    missing: d.missing || d.high == null,
  }));
}

/**
 * The weekend ahead in words: the weather card's alt text, and what the
 * plain-text email says. The card's own wording.
 */
export function forecastWords(days: ForecastDay[]): string {
  return weatherAlt(cardDays(days));
}

/** The card is worth drawing only with at least 2 days of forecast. */
export function hasWeatherCard(days: ForecastDay[] | undefined): boolean {
  return (days ?? []).filter((d) => !d.missing && d.high != null).length >= 2;
}

/** The card's size in the email: half its 2x pixels (600 x 320 or 280). */
export function weatherImageSize(days: ForecastDay[]) {
  const s = weatherSize(cardDays(days));
  return { width: s.width / 2, height: s.height / 2 };
}

export const NWS_BEND =
  "https://forecast.weather.gov/MapClick.php?lat=44.0582&lon=-121.3153";
export const AIRNOW_BEND =
  "https://www.airnow.gov/?city=Bend&state=OR&country=USA";

export type RenderOptions = {
  catalog: Catalog;
  site: string;
  /** Issue number (1 for the first sent issue). */
  number: number;
  /** A park's name and town, by slug. */
  park: (slug: string) => { name: string; city: string } | undefined;
  /**
   * track: links go through /n/<issue>/<slug> (counted in total, the same
   * for everyone). direct: plain links (the archive page, dry runs).
   */
  links: "track" | "direct";
  /** This reader's one-click link. Null on the web archive. */
  unsubscribeUrl: string | null;
  postalAddress: string | null;
  dryRun?: boolean;
  /**
   * Show the weather card image (/newsletter/<date>/weather.png). The
   * sender sets it only after the image answered; the words always show.
   */
  weatherImage?: boolean;
  /** Show Parents' corner (its image answered at send time). */
  memeImage?: boolean;
  /** The draft-image key (dry runs only: the images aren't public yet). */
  imageKey?: string;
  /** The web archive: outings with an event page link there. */
  eventPages?: boolean;
  /**
   * The web archive: leave Parents' corner as an empty slot (the page
   * renders the Instagram card and its click-to-load embed there).
   */
  memeSlot?: boolean;
};

/** Where renderArchiveSplit cuts the card for the page's own slot. */
const SLOT = "<!--parents-corner-slot-->";
const TABLE_OPEN =
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">';

/**
 * An outing's ages: the age tags code maps from the printed words
 * ("Ages 0-3, Ages 4-7"), never free text. Old issues kept their words.
 */
export function outingAges(w: {
  ages_text?: string;
  ages?: string;
}): string | null {
  if (w.ages_text) {
    const a = ageTags(w.ages_text);
    return a?.kids && a.tags.length ? a.tags.join(", ") : null;
  }
  return w.ages ?? null;
}

type View = ReturnType<typeof view>;

/** "about 90 minutes", "about 2 hours", "about 2 and a half hours" */
export function visitLength(minutes: number): string {
  if (minutes < 120) return `about ${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const half = minutes % 60 >= 30;
  return `about ${h}${half ? " and a half" : ""} hours`;
}

const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * The Indoor pick as the template draws it (weather-season spec section
 * 2): name (linked to its own page), address, the day, the drive from
 * downtown Bend, then Why it works for kids, Ages, Open, Cost, How long,
 * Make it work and, on snow and ice days, Closer to home.
 */
export function indoorView(
  pb: NonNullable<Issue["plan_b"]>,
  venue: Catalog["venues"][number],
  href: string,
) {
  const [y, m, d] = (pb.for_day ?? "2000-01-01").split("-").map(Number);
  const day = pb.for_day
    ? WEEKDAY_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    : "the weekend";
  const mins = venue.drive_minutes_from_downtown;
  const lines: [string, string][] = [
    ["Why it works for kids", pb.why_kids ?? ""],
    ["Ages", venue.ages_label],
    ...(pb.hours ? [["Open", pb.hours] as [string, string]] : []),
    ...(pb.cost ? [["Cost", pb.cost] as [string, string]] : []),
    ["How long", visitLength(venue.visit_minutes)],
    ...(pb.tip ? [["Make it work", pb.tip] as [string, string]] : []),
    ...(pb.closer_to_home?.length
      ? [["Closer to home", pb.closer_to_home.join(", ")] as [string, string]]
      : []),
  ];
  return {
    name: venue.name,
    href,
    day,
    short: !!pb.short,
    where: venue.address ?? venue.town,
    drive:
      mins <= 5
        ? "In downtown Bend."
        : `${mins} minutes from downtown${venue.town === "Bend" ? "" : " Bend"}.`,
    // End each line with a period, unless it already ends a sentence.
    lines: lines.map(
      ([k, t]) =>
        [k, /[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`] as [
          string,
          string,
        ],
    ),
  };
}

/** The issue in the shape the template draws. */
function view(issue: Issue, o: RenderOptions) {
  const link = (slug: string, url: string) =>
    o.links === "track" ? `${o.site}/n/${issue.issue_date}/${slug}` : url;
  const pick = o.park(issue.wheel_pick.park);
  const venue =
    issue.plan_b?.kind === "venue"
      ? o.catalog.venues.find((v) => v.id === issue.plan_b?.venue_id)
      : undefined;
  return {
    date: issue.issue_date,
    dateLine: `${longDate(issue.issue_date).replace(/, \d{4}$/, "")} · Issue ${o.number}`,
    subject: issue.subject,
    preview: issue.preview,
    hello: issue.hello.text,
    weather: issue.weekend_ahead?.days
      ? {
          words: forecastWords(issue.weekend_ahead.days),
          image: o.weatherImage
            ? weatherImageUrl(o.site, issue, o.imageKey)
            : null,
          size: weatherImageSize(issue.weekend_ahead.days),
          smoky: issue.weekend_ahead.days.some((d) => d.icon === "smoke"),
        }
      : null,
    // The writer's one line ("Best park window: Sunday morning"), as text
    // below the card, never drawn into it.
    weatherNote: issue.weekend_ahead?.note ?? null,
    // Plan-around weekends: one catalog line, under its own label.
    dress: (() => {
      const t = issue.dress
        ? o.catalog.dress_tips.find((d) => d.id === issue.dress?.tip_id)
        : undefined;
      return t ? { label: t.label, text: t.text } : null;
    })(),
    bullets: issue.bullets ?? [],
    pick: {
      name: pick?.name ?? issue.wheel_pick.park,
      city: pick?.city ?? "",
      href: link("pick", `${o.site}/parks/${issue.wheel_pick.park}`),
      // A real Wikimedia Commons photo when there is one, else the crayon card.
      image:
        issue.wheel_pick.photo?.src ??
        `${o.site}/parks/${issue.wheel_pick.park}/opengraph-image`,
      alt:
        issue.wheel_pick.photo?.alt ??
        `${pick?.name ?? issue.wheel_pick.park} on Park Roulette`,
      credit: issue.wheel_pick.photo
        ? photoCredit(issue.wheel_pick.photo)
        : null,
      why: issue.wheel_pick.why_now,
      who: issue.wheel_pick.who_for,
      bring: issue.wheel_pick.bring,
    },
    indoor:
      issue.plan_b?.kind === "venue" && venue && issue.plan_b.why_kids
        ? indoorView(issue.plan_b, venue, link("plan-b", venue.url))
        : null,
    planB:
      issue.plan_b && !(issue.plan_b.kind === "venue" && issue.plan_b.why_kids)
        ? {
            title: issue.plan_b.title ?? "",
            text: issue.plan_b.text ?? "",
            label:
              issue.plan_b.kind === "venue" ? SECTIONS.backup : SECTIONS.window,
            place: venue
              ? [venue.name, venue.address ?? venue.town].join(", ")
              : null,
            href: venue ? link("plan-b", venue.url) : null,
          }
        : null,
    headsUp: (issue.heads_up ?? []).map((h, i) => {
      const p = o.park(h.park);
      return {
        title: p ? `${p.name}, ${p.city}` : null,
        text: h.text,
        href: link(`heads-up-${i + 1}`, `${o.site}/parks/${h.park}`),
      };
    }),
    weekend: (issue.weekend ?? []).map((w, i) => ({
      name: w.name,
      // The web archive links an outing to its event page (official link,
      // directions, weather there); the email goes to the official page.
      href:
        o.eventPages && w.event
          ? `${o.site}/events/${w.event}`
          : link(`weekend-${i + 1}`, w.url),
      line: [shortDay(w.day), w.time, outingAges(w), w.cost]
        .filter(Boolean)
        .join(" · "),
      place: `${w.place}, ${w.town}`,
      what: w.what,
    })),
    challenge: o.catalog.challenges.find(
      (c) => c.id === issue.passport.challenge_id,
    )?.title,
    passport: issue.passport.text,
    passportHref: link("passport", `${o.site}/passport`),
    // Parents' corner: one image of the post, linked to it. Shown only
    // when code fetched the post and the sender saw the image answer.
    meme:
      issue.meme?.snapshot?.card && o.memeImage
        ? {
            href: link("meme", issue.meme.url),
            image: postImageUrl(o.site, issue, o.imageKey)!,
            alt: issue.meme.snapshot.card.alt,
            // The card is 1200 wide (2x): the email shows it at half.
            width: CARD_EMAIL_WIDTH,
            height: Math.round(
              (CARD_EMAIL_WIDTH * issue.meme.snapshot.card.height) /
                issue.meme.snapshot.card.width,
            ),
          }
        : null,
    memeSlot: !!o.memeSlot && !!issue.meme?.snapshot,
    signoff: issue.signoff.text,
    site: o.site,
    unsubscribeUrl: o.unsubscribeUrl,
    postal: o.postalAddress,
    dryRun: !!o.dryRun,
  };
}

// --- HTML ----------------------------------------------------------------

function label(text: string, color: string) {
  return `<div class="txt" style="font-family:${BODY}; font-size:13px; line-height:18px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:${C.ink};"><span style="border-bottom:4px solid ${color}; padding-bottom:1px;">${esc(text)}</span></div>`;
}

function heading(text: string, size = 22) {
  return `<h2 class="txt" style="margin:4px 0 8px 0; font-family:${HAND}; font-size:${size}px; line-height:${size + 6}px; color:${C.ink};">${esc(text)}</h2>`;
}

function para(html: string, extra = "") {
  return `<p style="margin:0 0 10px 0;${extra}">${html}</p>`;
}

function button(href: string, text: string, color: string) {
  const width = Math.max(180, text.length * 10 + 60);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td>
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(href)}" style="height:44px;v-text-anchor:middle;width:${width}px;" arcsize="50%" strokecolor="${C.ink}" strokeweight="2px" fillcolor="${color}"><w:anchorlock/><center style="color:#ffffff;font-family:${BODY};font-size:16px;font-weight:bold;">${esc(text)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${esc(href)}" style="display:inline-block; background-color:${color}; border:2px solid ${C.ink}; border-radius:22px; color:#ffffff; font-family:${BODY}; font-size:16px; font-weight:bold; line-height:40px; padding:0 24px; text-decoration:none;">${esc(text)}</a><!--<![endif]-->
</td></tr></table>`;
}

const row = (html: string, pad = "32px 32px 0 32px", cls = "px") =>
  `<tr><td class="${cls}" style="padding:${pad};">${html}</td></tr>`;
const bodyRow = (html: string, pad = "0 32px") =>
  `<tr><td class="px txt" style="padding:${pad}; font-family:${BODY}; font-size:16px; line-height:25px; color:${C.ink};">${html}</td></tr>`;
const a = (href: string, text: string) =>
  `<a class="link" href="${esc(href)}" style="color:${C.link};">${esc(text)}</a>`;

/** The card: everything inside the crayon frame (the web archive uses this too). */
export function renderCard(v: View): string {
  const parts: string[] = [];
  if (v.dryRun)
    parts.push(
      bodyRow(
        `<div style="background-color:${C.note}; border:2px dashed ${C.ink}; border-radius:10px; padding:10px 14px; font-size:14px; line-height:20px;"><b>Dry run.</b> Only James gets this copy. Links go straight to their pages.</div>`,
        "20px 32px 0 32px",
      ),
    );
  // Header
  parts.push(
    row(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:14px;"><a href="${esc(v.site)}" style="text-decoration:none;"><img src="${esc(v.site)}/icon/512" width="56" height="56" alt="Park Roulette" style="width:56px; height:56px; border-radius:12px; font-family:${BODY}; font-size:12px; color:${C.ink};"></a></td>
<td valign="middle"><div class="txt" style="font-family:${HAND}; font-size:26px; line-height:30px; font-weight:bold; color:${C.ink};">${esc(NEWS_NAME)}</div>
<div class="txt-soft" style="font-family:${BODY}; font-size:14px; line-height:20px; color:${C.soft};">${esc(v.dateLine)}</div></td>
</tr></table>`,
      "24px 32px 8px 32px",
    ),
  );
  // Hello and forecast
  parts.push(
    bodyRow(
      para(esc(v.hello)) +
        (v.bullets.length
          ? `<ul style="margin:4px 0 0 0; padding-left:22px;">${v.bullets.map((b) => `<li style="margin:0 0 4px 0;">${esc(b)}</li>`).join("")}</ul>`
          : ""),
      "16px 32px 0 32px",
    ),
  );
  // The weekend ahead (up top: in Central Oregon the weather is the plan).
  // The card image carries the whole forecast in its alt text; without
  // the image, the same words show as text.
  if (v.weather || v.weatherNote || v.dress)
    parts.push(
      row(label(SECTIONS.weather, C.blue), "24px 32px 6px 32px") +
        bodyRow(
          (v.weather?.image
            ? `<img src="${esc(v.weather.image)}" width="${v.weather.size.width}" height="${v.weather.size.height}" alt="${esc(v.weather.words)}" style="display:block; width:100%; max-width:${v.weather.size.width}px; height:auto; margin:0 0 10px 0; font-family:${BODY}; font-size:15px; line-height:22px; color:${C.ink};">`
            : v.weather
              ? para(esc(v.weather.words))
              : "") +
            (v.weatherNote ? para(`<b>${esc(v.weatherNote)}</b>`) : "") +
            (v.dress
              ? para(`<b>${esc(v.dress.label)}:</b> ${esc(v.dress.text)}`)
              : "") +
            (v.weather
              ? para(
                  `Forecast: ${a(NWS_BEND, "National Weather Service")}${v.weather.smoky ? ` &middot; Air quality: ${a(AIRNOW_BEND, "AirNow")}` : ""}`,
                  ` color:${C.soft}; font-size:13px;`,
                )
              : ""),
        ),
    );
  // Featured park (the Wheel Pick)
  parts.push(
    row(
      `<h1 class="h1 txt" style="margin:4px 0 2px 0; font-family:${HAND}; font-size:30px; line-height:36px; color:${C.ink};">${esc(featuredHeading(v.pick.name))}</h1>` +
        (v.pick.city
          ? `<div class="txt-soft" style="margin:0 0 12px 0; font-family:${BODY}; font-size:15px; line-height:22px; color:${C.soft};">${esc(v.pick.city)}</div>`
          : `<div style="height:10px; line-height:10px; font-size:0;">&nbsp;</div>`) +
        `<a href="${esc(v.pick.href)}" style="text-decoration:none;"><img src="${esc(v.pick.image)}" width="536" alt="${esc(v.pick.alt)}" style="width:100%; max-width:536px; height:auto; border-radius:12px; font-family:${BODY}; font-size:14px; color:${C.ink};"></a>`,
    ),
  );
  if (v.pick.credit)
    parts.push(
      bodyRow(
        `<div class="txt-soft" style="font-size:12px; line-height:18px; color:${C.soft};">${v.pick.credit.html}</div>`,
        "6px 32px 0 32px",
      ),
    );
  parts.push(
    bodyRow(
      para(`<b>Why now.</b> ${esc(v.pick.why)}`) +
        para(`<b>Who it's for.</b> ${esc(v.pick.who)}`) +
        para(`<b>Bring.</b> ${esc(v.pick.bring)}`),
      "12px 32px 0 32px",
    ),
  );
  parts.push(
    row(
      button(v.pick.href, `See ${v.pick.name}`, C.buttonGreen),
      "4px 32px 0 32px",
    ),
  );
  // The Indoor pick: each field on its own line, led by its plain label.
  if (v.indoor)
    parts.push(
      v.indoor.short
        ? bodyRow(
            para(
              `<b>${SECTIONS.backup}:</b> ${a(v.indoor.href, v.indoor.name)}, for ${esc(v.indoor.day)}.`,
            ),
            "20px 32px 0 32px",
          )
        : row(
            label(`${SECTIONS.backup}, for ${v.indoor.day}`, C.orange) +
              `<div style="margin:4px 0 6px 0; font-family:${BODY}; font-size:17px; line-height:25px; color:${C.ink};"><b>${a(v.indoor.href, v.indoor.name)}</b>${v.indoor.where ? `, ${esc(v.indoor.where)}` : ""}.${v.indoor.drive ? ` ${esc(v.indoor.drive)}` : ""}</div>`,
          ) +
            bodyRow(
              v.indoor.lines
                .map(([k, t]) => para(`<b>${esc(k)}:</b> ${esc(t)}`))
                .join(""),
            ),
    );
  // Plan B
  if (v.planB)
    parts.push(
      row(label(v.planB.label, C.orange) + heading(v.planB.title)) +
        bodyRow(
          para(esc(v.planB.text)) +
            (v.planB.place
              ? para(
                  v.planB.href
                    ? a(v.planB.href, v.planB.place)
                    : esc(v.planB.place),
                  ` color:${C.soft}; font-size:14px;`,
                )
              : ""),
        ),
    );
  // Heads up
  if (v.headsUp.length)
    parts.push(
      row(label(SECTIONS.headsUp, C.yellow) + heading("What changed")) +
        bodyRow(
          v.headsUp
            .map((h) =>
              para(
                (h.title
                  ? `<b>${h.href ? a(h.href, h.title) : esc(h.title)}.</b> `
                  : "") +
                  esc(h.text) +
                  (!h.title && h.href ? ` ${a(h.href, "Details")}` : ""),
              ),
            )
            .join(""),
        ),
    );
  // This weekend
  if (v.weekend.length)
    parts.push(
      row(label(SECTIONS.weekend, C.green) + heading("Out and about")) +
        bodyRow(
          v.weekend
            .map((w) =>
              para(
                `<b>${a(w.href, w.name)}</b><br>` +
                  `<span style="color:${C.soft}; font-size:14px;">${esc(w.line)}</span><br>` +
                  `${esc(w.place)}<br>${esc(w.what)}`,
                " margin-bottom:14px;",
              ),
            )
            .join(""),
        ),
    );
  // Passport
  parts.push(
    row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${C.note}" style="background-color:${C.note}; border:2px dashed ${C.ink}; border-radius:12px; padding:20px 22px;">
${label(SECTIONS.passport, C.pink)}
<div style="margin:4px 0 8px 0; font-family:${HAND}; font-size:22px; line-height:28px; font-weight:bold; color:${C.ink};">${esc(v.challenge ?? "This week's stamp")}</div>
<div style="font-family:${BODY}; font-size:16px; line-height:25px; color:${C.ink};">${esc(v.passport)}</div>
<div style="margin-top:14px;">${button(v.passportHref, "Open your passport", C.buttonRed)}</div>
</td></tr></table>`,
    ),
  );
  // Parents' corner: the post as one image, linked to it. No caption.
  if (v.memeSlot) parts.push(SLOT);
  else if (v.meme)
    parts.push(
      row(label(SECTIONS.meme, C.purple), "32px 32px 10px 32px") +
        row(
          `<a href="${esc(v.meme.href)}" style="text-decoration:none;"><img src="${esc(v.meme.image)}" width="${v.meme.width}" height="${v.meme.height}" alt="${esc(v.meme.alt)}" style="display:block; width:100%; max-width:${v.meme.width}px; height:auto; margin:0 auto; border-radius:12px; font-family:${BODY}; font-size:15px; line-height:22px; color:${C.ink};"></a>`,
          "0 32px 0 32px",
        ),
    );
  // Sign-off
  parts.push(
    bodyRow(
      `${esc(v.signoff)}<br><br>See you at the park,<br><span style="font-family:${HAND}; font-size:20px; font-weight:bold;">James</span>`,
      "28px 32px 28px 32px",
    ),
  );
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${parts.join("\n")}</table>`;
}

function footer(v: View): string {
  const links = [
    v.unsubscribeUrl ? a(v.unsubscribeUrl, "Unsubscribe") : null,
    a(`${v.site}/newsletter/${v.date}`, "View online"),
    a(`${v.site}/privacy`, "Privacy"),
  ]
    .filter(Boolean)
    .join(" &middot; ");
  return `<tr><td class="px txt-soft" style="padding:20px 32px 8px 32px; font-family:${BODY}; font-size:13px; line-height:20px; color:${C.soft}; text-align:center;">
You're getting ${esc(NEWS_NAME)} because you signed up at parkroulette.quest and confirmed your email. Every Thursday morning.<br>
${esc(TEXTS_CROSS_SELL.lead)} ${a(`${v.site}${TEXTS_CROSS_SELL.path}`, TEXTS_CROSS_SELL.text)}.<br>
Park Roulette is free, has no ads and never sells your data.<br>
${links}<br>
True Craft Ventures LLC${v.postal ? ` &middot; ${esc(v.postal)}` : ""}
</td></tr>`;
}

export function renderHtml(issue: Issue, o: RenderOptions): string {
  const v = view(issue, o);
  const title = esc(`${v.dryRun ? "[Dry run] " : ""}${v.subject}`);
  const spacer = "&#8199;&#65279;&#847; ".repeat(30);
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>td,th,div,p,a,h1,h2,h3{font-family:'Trebuchet MS',Arial,sans-serif !important;}</style><![endif]-->
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; display:block; height:auto; }
a { color:${C.link}; }
p { margin:0; }
@media screen and (max-width:620px) {
  .container { width:100% !important; }
  .px { padding-left:20px !important; padding-right:20px !important; }
  .h1 { font-size:26px !important; line-height:32px !important; }
}
@media (prefers-color-scheme: dark) {
  .bg-page { background-color:#1d1c22 !important; }
  .bg-card { background-color:#2b2a33 !important; }
  .txt { color:#f3efe6 !important; }
  .txt-soft { color:#cfc9bd !important; }
  .link { color:#8fbaf0 !important; }
}
[data-ogsb] .bg-page { background-color:#1d1c22 !important; }
[data-ogsb] .bg-card { background-color:#2b2a33 !important; }
[data-ogsc] .txt { color:#f3efe6 !important; }
[data-ogsc] .txt-soft { color:#cfc9bd !important; }
[data-ogsc] .link { color:#8fbaf0 !important; }
</style>
</head>
<body class="bg-page" style="margin:0; padding:0; background-color:${C.page};">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${C.page}; opacity:0;">${esc(v.preview)} ${spacer}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-page" bgcolor="${C.page}" style="background-color:${C.page};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
<tr><td style="font-size:0; line-height:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${STRIPE.map((c) => `<td height="8" bgcolor="${c}" style="background-color:${c}; height:8px; font-size:0;">&nbsp;</td>`).join("")}</tr></table></td></tr>
<tr><td class="bg-card" bgcolor="${C.paper}" style="background-color:${C.paper}; border:3px solid ${C.ink}; border-top:0;">
${renderCard(v)}
</td></tr>
${footer(v)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/** The same issue as plain text (every email carries both). */
export function renderText(issue: Issue, o: RenderOptions): string {
  const v = view(issue, o);
  const out: string[] = [];
  if (v.dryRun) out.push("DRY RUN. Only James gets this copy.", "");
  out.push(`${NEWS_NAME}`, v.dateLine, "", v.hello);
  if (v.bullets.length) out.push("", ...v.bullets.map((b) => `* ${b}`));
  if (v.weather || v.weatherNote || v.dress)
    out.push(
      "",
      SECTIONS.weather.toUpperCase(),
      ...(v.weather ? [v.weather.words] : []),
      ...(v.weatherNote ? [v.weatherNote] : []),
      ...(v.dress ? [`${v.dress.label}: ${v.dress.text}`] : []),
      ...(v.weather
        ? [
            `Forecast: ${NWS_BEND}`,
            ...(v.weather.smoky ? [`Air quality: ${AIRNOW_BEND}`] : []),
          ]
        : []),
    );
  out.push(
    "",
    `${featuredHeading(v.pick.name)}${v.pick.city ? ` (${v.pick.city})` : ""}`,
    ...(v.pick.credit ? [`(${v.pick.credit.text})`] : []),
    `Why now. ${v.pick.why}`,
    `Who it's for. ${v.pick.who}`,
    `Bring. ${v.pick.bring}`,
    v.pick.href,
  );
  if (v.indoor) {
    if (v.indoor.short)
      out.push(
        "",
        `${SECTIONS.backup}: ${v.indoor.name}, for ${v.indoor.day}. ${v.indoor.href}`,
      );
    else
      out.push(
        "",
        `${SECTIONS.backup.toUpperCase()}, FOR ${v.indoor.day.toUpperCase()}`,
        `${v.indoor.name}${v.indoor.where ? `, ${v.indoor.where}` : ""}.${v.indoor.drive ? ` ${v.indoor.drive}` : ""}`,
        v.indoor.href,
        ...v.indoor.lines.map(([k, t]) => `${k}: ${t}`),
      );
  }
  if (v.planB) {
    out.push("", v.planB.label.toUpperCase(), v.planB.title, v.planB.text);
    if (v.planB.place) out.push(v.planB.place);
    if (v.planB.href) out.push(v.planB.href);
  }
  if (v.headsUp.length) {
    out.push("", SECTIONS.headsUp.toUpperCase());
    for (const h of v.headsUp)
      out.push(
        `* ${h.title ? `${h.title}. ` : ""}${h.text}${h.href ? ` ${h.href}` : ""}`,
      );
  }
  if (v.weekend.length) {
    out.push("", SECTIONS.weekend.toUpperCase());
    for (const w of v.weekend)
      out.push(
        `* ${w.name}`,
        `  ${w.line}`,
        `  ${w.place}`,
        `  ${w.what}`,
        `  ${w.href}`,
      );
  }
  out.push(
    "",
    `${SECTIONS.passport.toUpperCase()}: ${v.challenge ?? "This week's stamp"}`,
    v.passport,
    v.passportHref,
  );
  if (v.meme)
    out.push("", SECTIONS.meme.toUpperCase(), v.meme.alt, v.meme.href);
  out.push(
    "",
    v.signoff,
    "",
    "See you at the park,",
    "James",
    "",
    "--",
    `You're getting ${NEWS_NAME} because you signed up at parkroulette.quest and confirmed your email. Every Thursday morning.`,
    `${TEXTS_CROSS_SELL.lead} ${TEXTS_CROSS_SELL.text}: ${v.site}${TEXTS_CROSS_SELL.path}`,
    "Park Roulette is free, has no ads and never sells your data.",
  );
  if (v.unsubscribeUrl) out.push(`Unsubscribe: ${v.unsubscribeUrl}`);
  out.push(`View online: ${v.site}/newsletter/${v.date}`);
  out.push(`True Craft Ventures LLC${v.postal ? `, ${v.postal}` : ""}`);
  return out.join("\n");
}

/** The card alone, for the web archive (/newsletter/<date>). */
export function renderArchiveCard(issue: Issue, o: RenderOptions): string {
  return renderCard(view(issue, o));
}

/**
 * The archive card in two halves around Parents' corner, so the page can
 * render its own slot there (the Instagram click-to-load embed).
 */
export function renderArchiveSplit(
  issue: Issue,
  o: RenderOptions,
): { before: string; after: string | null } {
  const html = renderCard(view(issue, { ...o, memeSlot: true }));
  const i = html.indexOf(SLOT);
  if (i < 0) return { before: html, after: null };
  return {
    before: `${html.slice(0, i)}</table>`,
    after: `${TABLE_OPEN}${html.slice(i + SLOT.length)}`,
  };
}

/** Parents' corner's section name (for a page's own slot). */
export const MEME_SECTION = SECTIONS.meme;

// --- The confirmation email ----------------------------------------------

/** A short, plain email in the crayon frame (confirmations and notices). */
function shortMail(o: {
  subject: string;
  heading: string;
  lines: string[];
  button?: { href: string; text: string };
  small?: string;
  /** A small line ending in a link ("Didn't sign up? Unsubscribe anytime"). */
  smallLink?: { lead: string; href: string; text: string };
  /** One more quiet line with a link, above the signature (welcome). */
  quietLink?: { lead: string; href: string; text: string };
  site: string;
  postalAddress: string | null;
}): { subject: string; html: string; text: string } {
  const text = [
    "Hi there,",
    "",
    ...o.lines.flatMap((l) => [l, ""]),
    ...(o.button ? [`${o.button.text}: ${o.button.href}`, ""] : []),
    ...(o.small ? [o.small, ""] : []),
    ...(o.quietLink
      ? [`${o.quietLink.lead} ${o.quietLink.text}: ${o.quietLink.href}`, ""]
      : []),
    ...(o.smallLink
      ? [`${o.smallLink.lead} ${o.smallLink.text}: ${o.smallLink.href}`, ""]
      : []),
    "James, Park Roulette",
    `True Craft Ventures LLC${o.postalAddress ? `, ${o.postalAddress}` : ""}`,
  ].join("\n");
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(o.subject)}</title></head>
<body style="margin:0; padding:0; background-color:${C.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr><td style="font-size:0; line-height:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${STRIPE.map((c) => `<td height="8" bgcolor="${c}" style="background-color:${c}; height:8px; font-size:0;">&nbsp;</td>`).join("")}</tr></table></td></tr>
<tr><td bgcolor="${C.paper}" style="background-color:${C.paper}; border:3px solid ${C.ink}; border-top:0; padding:24px 28px; font-family:${BODY}; font-size:16px; line-height:25px; color:${C.ink};">
<div style="font-family:${HAND}; font-size:24px; line-height:30px; font-weight:bold; margin-bottom:12px;">${esc(o.heading)}</div>
${o.lines.map((l) => para(esc(l))).join("")}
${o.button ? `<div style="margin:16px 0;">${button(o.button.href, o.button.text, C.buttonBlue)}</div>` : ""}
${o.small ? para(esc(o.small), ` color:${C.soft}; font-size:14px;`) : ""}
${o.quietLink ? para(`${esc(o.quietLink.lead)} ${a(o.quietLink.href, o.quietLink.text)}.`, ` color:${C.soft}; font-size:14px;`) : ""}
${o.smallLink ? para(`${esc(o.smallLink.lead)} ${a(o.smallLink.href, o.smallLink.text)}`, ` color:${C.soft}; font-size:14px;`) : ""}
${para(`James, ${a(o.site, "Park Roulette")}`)}
</td></tr>
<tr><td style="padding:14px 8px; font-family:${BODY}; font-size:12px; line-height:18px; color:${C.soft}; text-align:center;">True Craft Ventures LLC${o.postalAddress ? ` &middot; ${esc(o.postalAddress)}` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: o.subject, html, text };
}

/**
 * The welcome email (single opt-in, James, November 2026): what arrives
 * and when, the latest issue if there is one, and the way out.
 */
export function renderWelcome(o: {
  site: string;
  unsubscribeUrl: string;
  latestIssueUrl: string | null;
  postalAddress: string | null;
}): { subject: string; html: string; text: string } {
  return shortMail({
    subject: `You're in: ${NEWS_NAME}`,
    heading: "You're in!",
    lines: [
      `${NEWS_NAME} lands Thursday mornings: the weekend forecast, one Central Oregon playground to try, and an indoor backup if it pours.`,
    ],
    button: o.latestIssueUrl
      ? { href: o.latestIssueUrl, text: "Read the latest issue" }
      : undefined,
    quietLink: {
      lead: TEXTS_CROSS_SELL.lead,
      href: `${o.site}${TEXTS_CROSS_SELL.path}`,
      text: TEXTS_CROSS_SELL.text,
    },
    smallLink: {
      lead: "Didn't sign up?",
      href: o.unsubscribeUrl,
      text: "Unsubscribe anytime",
    },
    site: o.site,
    postalAddress: o.postalAddress,
  });
}

export function renderConfirmation(o: {
  url: string;
  site: string;
  postalAddress: string | null;
  /** link: the address is already on the list; the tap connects it to an account. */
  purpose?: "subscribe" | "link";
}): { subject: string; html: string; text: string } {
  if (o.purpose === "link")
    return shortMail({
      subject: `Connect your ${NEWS_NAME} emails to your family`,
      heading: "Connect this email to your family",
      lines: [
        `Someone signed in to Park Roulette asked to connect this address to their family account. Tap the button and ${NEWS_NAME} shows up in that account's Family & settings, where they can turn it off.`,
      ],
      button: { href: o.url, text: "Connect it to my family" },
      small:
        "The link works for 7 days. Didn't ask for this? Ignore this email and nothing changes.",
      site: o.site,
      postalAddress: o.postalAddress,
    });
  return shortMail({
    subject: `Confirm your ${NEWS_NAME} emails`,
    heading: "One tap and you're in",
    lines: [
      `Tap the button to start getting ${NEWS_NAME}: weekly park picks for the forecast, closures and indoor backups, every Thursday morning.`,
    ],
    button: { href: o.url, text: "Confirm" },
    small:
      "The link works for 7 days. Didn't ask for this? Ignore this email and you won't hear from us.",
    site: o.site,
    postalAddress: o.postalAddress,
  });
}
