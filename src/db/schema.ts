import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * A crew is a household on the quest (e.g. the two of you). Visits belong to
 * a crew: the passport is shared. Reviews belong to individual explorers.
 */
export const crews = pgTable("crews", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  /** Secret code in the "join my crew" link. */
  joinCode: text("join_code").notNull().unique(),
  /** Secret code in the "come play too" link: lets a friend start their own crew. */
  friendCode: text("friend_code").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const explorers = pgTable(
  "explorers",
  {
    id: serial("id").primaryKey(),
    crewId: integer("crew_id")
      .notNull()
      .references(() => crews.id),
    name: text("name").notNull(),
    color: text("color").notNull(),
    avatar: text("avatar").notNull(),
    /** US mobile in E.164 ("+15415551234"), verified by text. How you sign in. */
    phone: text("phone").unique(),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    /**
     * Signed into every session cookie. Bumping it signs this explorer out
     * everywhere (done when their phone number is added, changed or removed).
     */
    sessionEpoch: integer("session_epoch").notNull().default(0),
    /**
     * A kid's explorer, made by a grown-up in the family. Kids give stars
     * and tap tags; only grown-ups write words or add photos.
     */
    isKid: boolean("is_kid").notNull().default(false),
    /**
     * Park news by email (optional, never at sign-up). Grown-ups in a
     * trusted session only. Not used for sign-in or recovery (yet).
     */
    email: text("email"),
    emailOptIn: boolean("email_opt_in").notNull().default(false),
    /**
     * Set when they tap the link in our confirmation email (double opt-in).
     * Only confirmed addresses get Bend Playground Passport.
     */
    emailConfirmedAt: timestamp("email_confirmed_at", { withTimezone: true }),
    /**
     * Random, per subscriber: the unsubscribe link in every email. Made at
     * confirmation, cleared when they stop (so an old link does nothing).
     */
    emailToken: text("email_token").unique(),
    /** Answered the one-time park news card (yes or no thanks). */
    parkNewsAskedAt: timestamp("park_news_asked_at", { withTimezone: true }),
    /**
     * "No thanks" to the weekly picks, per channel, from an ask moment
     * (lib/asks.ts): never offered that channel again, on any phone.
     */
    picksEmailDeclinedAt: timestamp("picks_email_declined_at", {
      withTimezone: true,
    }),
    picksTextDeclinedAt: timestamp("picks_text_declined_at", {
      withTimezone: true,
    }),
    /** Can moderate: hide reviews, settle park fixes. Set by hand. */
    isAdmin: boolean("is_admin").notNull().default(false),
    /** When this grown-up agreed to the Terms and Privacy Policy. */
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("explorers_crew_name").on(t.crewId, sql`lower(${t.name})`),
    // Bounces and complaints are matched by address.
    index("explorers_email").on(t.email),
  ],
);

/**
 * Every code we text, and every wrong code typed: the app's own rate limits
 * (Twilio has more of its own). Holds phones and IPs, so rows are deleted
 * after two days.
 */
export const smsEvents = pgTable(
  "sms_events",
  {
    id: serial("id").primaryKey(),
    /**
     * send; quiet (over a daily budget, answered as if sent); refused (over
     * a per-number or per-network limit); attempt (Twilio failed, refunded);
     * check; bad_code; ok (a code that worked)
     */
    kind: text("kind").notNull(),
    phone: text("phone").notNull(),
    ip: text("ip").notNull(),
    /** Did the number belong to an explorer when we texted it? */
    known: boolean("known").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sms_events_phone").on(t.phone, t.createdAt),
    index("sms_events_ip").on(t.ip, t.createdAt),
    index("sms_events_created").on(t.createdAt),
  ],
);

export const parks = pgTable(
  "parks",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    address: text("address"),
    kind: text("kind").notNull().default("park"),
    /** playground | nature (natural play, no structure) | none (a park, no playground). */
    play: text("play").notNull().default("playground"),
    features: text("features")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    confidence: text("confidence").notNull().default("unverified"),
    sources: text("sources")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text("notes"),
    /** active | no_playground | closed. Soft states so history survives. */
    status: text("status").notNull().default("active"),
    statusNote: text("status_note"),
    addedBy: integer("added_by").references(() => explorers.id, {
      onDelete: "set null",
    }),
    /**
     * When the park counts for everyone. A family-added park waits for a
     * second family (or an admin) to confirm it's real.
     */
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("parks_city").on(t.city)],
);

export const visits = pgTable(
  "visits",
  {
    id: serial("id").primaryKey(),
    parkId: integer("park_id")
      .notNull()
      .references(() => parks.id),
    crewId: integer("crew_id")
      .notNull()
      .references(() => crews.id),
    loggedBy: integer("logged_by")
      .notNull()
      .references(() => explorers.id),
    visitedOn: date("visited_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("visits_crew").on(t.crewId), index("visits_park").on(t.parkId)],
);

export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    parkId: integer("park_id")
      .notNull()
      .references(() => parks.id),
    explorerId: integer("explorer_id")
      .notNull()
      .references(() => explorers.id),
    /** Stars in tenths: 0..50 means 0.0..5.0. Integers keep the math exact. */
    ratingTenths: integer("rating_tenths").notNull(),
    body: text("body").notNull().default(""),
    /** Fun one-tap tags: "big kid approved", "windy", ... */
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Who can read the words, tags and photos: public (everyone, even
     * signed out), members (signed-in families), family (just us). Stars
     * always count toward the park's average.
     */
    visibility: text("visibility").notNull().default("members"),
    /** Hidden by reports or an admin. Only the author's family still sees it. */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("reviews_park_explorer").on(t.parkId, t.explorerId),
    check("reviews_rating_range", sql`${t.ratingTenths} between 0 and 50`),
    check(
      "reviews_visibility",
      sql`${t.visibility} in ('public', 'members', 'family')`,
    ),
  ],
);

/** "Something's not right with this review." One per family per review. */
export const reviewReports = pgTable(
  "review_reports",
  {
    id: serial("id").primaryKey(),
    reviewId: integer("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    reporterId: integer("reporter_id")
      .notNull()
      .references(() => explorers.id, { onDelete: "cascade" }),
    reporterCrewId: integer("reporter_crew_id")
      .notNull()
      .references(() => crews.id, { onDelete: "cascade" }),
    /** my_kid | not_ok | spam | other */
    reason: text("reason").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("review_reports_once").on(t.reviewId, t.reporterCrewId),
    index("review_reports_open").on(t.resolvedAt),
  ],
);

/**
 * A family's say on a fact about a park ("the splash pad is gone", "it's
 * closed"). A change applies when two families agree, or an admin says so.
 * topic: feature:<key> (yes|no), play (playground|nature|none),
 * status (active|closed|private), exists (yes|no: a family-added park).
 */
export const parkVotes = pgTable(
  "park_votes",
  {
    id: serial("id").primaryKey(),
    parkId: integer("park_id")
      .notNull()
      .references(() => parks.id, { onDelete: "cascade" }),
    crewId: integer("crew_id")
      .notNull()
      .references(() => crews.id, { onDelete: "cascade" }),
    explorerId: integer("explorer_id")
      .notNull()
      .references(() => explorers.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    value: text("value").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("park_votes_once").on(t.parkId, t.crewId, t.topic),
    index("park_votes_park").on(t.parkId),
  ],
);

/** Things that happened to parks, for the feed: "Swings added, thanks to 2 families". */
export const parkChanges = pgTable(
  "park_changes",
  {
    id: serial("id").primaryKey(),
    parkId: integer("park_id")
      .notNull()
      .references(() => parks.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    value: text("value").notNull(),
    /** How many families agreed (0 = an admin decided). */
    families: integer("families").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("park_changes_created").on(t.createdAt)],
);

export const media = pgTable(
  "media",
  {
    id: serial("id").primaryKey(),
    reviewId: integer("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("media_review").on(t.reviewId)],
);

/**
 * When we last emailed James about something (a report, a cap, an error),
 * so a bad hour sends one email instead of a hundred.
 */
export const alertLog = pgTable("alert_log", {
  key: text("key").primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  /** How many times it happened since the last email. */
  suppressed: integer("suppressed").notNull().default(0),
});

/**
 * Every park news yes/no, append-only: when, where in the app, and which
 * version of the words people saw (CONSENT_TEXT in lib/park-news.ts).
 * Deleted with the explorer (email needs no long-term proof).
 */
export const contactConsents = pgTable(
  "contact_consents",
  {
    id: serial("id").primaryKey(),
    /**
     * The account that said it, when signed in. Null for an email signup
     * with no account, and always null for texts (those are keyed by the
     * phone number and outlive the account; see Privacy).
     */
    explorerId: integer("explorer_id").references(() => explorers.id, {
      onDelete: "cascade",
    }),
    /** The email subscriber row this is about (email only). */
    subscriberId: integer("subscriber_id").references(
      (): AnyPgColumn => emailSubscribers.id,
      { onDelete: "cascade" },
    ),
    /** email | sms */
    channel: text("channel").notNull(),
    /** opt_in | opt_out | change | confirm (tapped the confirmation link) */
    action: text("action").notNull(),
    address: text("address").notNull(),
    consentVersion: text("consent_version").notNull(),
    /**
     * stamp_card | passport_card | settings, or for stops and confirms:
     * email_link (the confirmation or unsubscribe page), one_click (the
     * mail app's unsubscribe button), bounce, complaint (Resend webhook)
     */
    source: text("source").notNull(),
    /**
     * Texts: the proof a carrier or court asks for. The page path, IP,
     * browser, when the number last passed a code and that code's Verify
     * SID, Twilio message SIDs. The words shown are frozen per
     * consent_version (lib/texts.ts). Email (batch 6): {prechecked, path}
     * where the surface records them (lib/park-news.ts EMAIL_CONSENT_TEXT).
     */
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("contact_consents_explorer").on(t.explorerId),
    index("contact_consents_address").on(t.channel, t.address),
  ],
);

/**
 * Who gets Bend Playground Passport: one row per address, with or without
 * an account (the footer and /newsletter sign people up signed out).
 * Single opt-in: a sign-up is confirmed at once and gets the email
 * (pending rows are only from before, and were carried over by migration
 * 0015); stopped keeps only a fingerprint of the address (email is null).
 */
export const emailSubscribers = pgTable(
  "email_subscribers",
  {
    id: serial("id").primaryKey(),
    /** Lowercased and trimmed. Null once stopped. */
    email: text("email"),
    /** "sha256:<hex>" of the address: kept after a stop, to prove it. */
    emailHash: text("email_hash").notNull(),
    /** pending | confirmed | stopped */
    status: text("status").notNull().default("pending"),
    /** The account it belongs to, once a confirmation tap joined them. */
    explorerId: integer("explorer_id").references(() => explorers.id, {
      onDelete: "set null",
    }),
    /** The unsubscribe link in every email (cleared when stopped). */
    token: text("token").unique(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    /** footer | newsletter | issue_page | welcome_sheet | settings | ... */
    source: text("source").notNull(),
    consentVersion: text("consent_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One live row per address; stopped rows don't count.
    uniqueIndex("email_subscribers_live")
      .on(t.email)
      .where(sql`${t.status} in ('pending', 'confirmed')`),
    index("email_subscribers_explorer").on(t.explorerId),
    index("email_subscribers_status").on(t.status, t.createdAt),
    check(
      "email_subscribers_status",
      sql`${t.status} in ('pending', 'confirmed', 'stopped')`,
    ),
    check(
      "email_subscribers_stopped_no_email",
      sql`${t.status} <> 'stopped' or ${t.email} is null`,
    ),
  ],
);

/**
 * The salt for IP fingerprints in signup rate limits, one per 30-day
 * period. Old salts are deleted, so an old fingerprint can't be reversed.
 */
export const newsSalts = pgTable("news_salts", {
  period: integer("period").primaryKey(),
  salt: text("salt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Numbers that texted STOP (or stopped in the app): STOP belongs to the
 * phone, not the account. Kept for as long as we text anyone. START
 * deletes the row.
 */
export const smsOptOuts = pgTable("sms_opt_outs", {
  phone: text("phone").primaryKey(),
  /** stop (a reply) | settings | texts_page | number_changed | account_deleted */
  source: text("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The last text we sent each number (any text: confirmation, HELP, STOP,
 * a weekend pick). Text consent records are kept 4 years from this.
 */
export const smsLastTexts = pgTable("sms_last_texts", {
  phone: text("phone").primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
});

/**
 * Links and sign-up emails for park news: connect-to-family links, old
 * confirmation links, and a "welcome" row per welcome email (never a
 * usable link; it's what the daily caps count). Only a sha256 of the token
 * and of the address are kept. Stopping expires rows; only the 30-day
 * purge deletes them.
 */
export const emailConfirmations = pgTable(
  "email_confirmations",
  {
    id: serial("id").primaryKey(),
    /** Who asked, when signed in (the account a "link" attaches to). */
    explorerId: integer("explorer_id").references(() => explorers.id, {
      onDelete: "cascade",
    }),
    /** The subscriber row the link confirms. */
    subscriberId: integer("subscriber_id").references(
      (): AnyPgColumn => emailSubscribers.id,
      { onDelete: "cascade" },
    ),
    /** subscribe (a new address) | link (attach an existing one to an account) */
    purpose: text("purpose").notNull().default("subscribe"),
    /** sha256 of the IP with this month's salt (rate limits only). */
    ipHash: text("ip_hash"),
    tokenHash: text("token_hash").notNull().unique(),
    addressHash: text("address_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("email_confirmations_explorer").on(t.explorerId, t.createdAt),
    index("email_confirmations_address").on(t.addressHash, t.createdAt),
    index("email_confirmations_ip").on(t.ipHash, t.createdAt),
  ],
);

/**
 * One row per Thursday issue of Bend Playground Passport. The writer posts
 * a draft; the sender re-validates it and sends it, or skips the week.
 * Only `sent` issues are public (/newsletter/<date>) and only they count
 * as history for cooldowns and repeats.
 */
export const newsIssues = pgTable(
  "news_issues",
  {
    id: serial("id").primaryKey(),
    /** The Thursday it goes out (Pacific). */
    issueDate: date("issue_date").notNull().unique(),
    /**
     * draft | sent (at least one email went out) | skipped (nothing was
     * sent: no valid draft, the kill switch, a holiday, nobody to send to)
     * | failed (a send started but not one email went out)
     */
    status: text("status").notNull().default("draft"),
    /** The issue JSON as the writer submitted it. */
    body: jsonb("body"),
    /** The latest validation report (errors, warnings, cut items). */
    report: jsonb("report"),
    /** The code-made plan the draft was written from (pick, venues, deltas). */
    plan: jsonb("plan"),
    /** What actually went out: the body with any cut items removed. */
    sentBody: jsonb("sent_body"),
    /**
     * The email as rendered at snapshot time ({subject, html, text}, with a
     * placeholder for each reader's unsubscribe token), so every retry of a
     * chunk sends exactly the same bytes.
     */
    rendered: jsonb("rendered"),
    /** Why a week was skipped (no valid draft, kill switch, holiday). */
    skipReason: text("skip_reason"),
    /** The dry-run copy went to ALERT_EMAIL (never marks it sent). */
    dryRunAt: timestamp("dry_run_at", { withTimezone: true }),
    /** The audience was snapshotted; later runs resume, never restart. */
    sendStartedAt: timestamp("send_started_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "news_issues_status",
      sql`${t.status} in ('draft', 'sent', 'skipped', 'failed')`,
    ),
  ],
);

/**
 * Who an issue went to: the audience snapshot, sent in chunks of 100.
 * No addresses here (the address is read at send time, so a stop between
 * chunks is honored). Deleted with the explorer, and after 12 months.
 */
export const newsSends = pgTable(
  "news_sends",
  {
    id: serial("id").primaryKey(),
    issueId: integer("issue_id")
      .notNull()
      .references(() => newsIssues.id, { onDelete: "cascade" }),
    /** Kept for sends from before email_subscribers; null on new ones. */
    explorerId: integer("explorer_id").references(() => explorers.id, {
      onDelete: "cascade",
    }),
    subscriberId: integer("subscriber_id").references(
      (): AnyPgColumn => emailSubscribers.id,
      { onDelete: "cascade" },
    ),
    chunk: integer("chunk").notNull(),
    /** queued | sending | sent | skipped (stopped before their chunk) | failed */
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    /**
     * Which Idempotency-Key this chunk is on (news-<issue>-<chunk>-a<n>).
     * Bumped only when Resend clearly didn't take the last one (a 5xx).
     */
    keyAttempt: integer("key_attempt").notNull().default(0),
    /** Resend's id for this email, for matching bounces in its dashboard. */
    resendId: text("resend_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("news_sends_once").on(t.issueId, t.explorerId),
    uniqueIndex("news_sends_once_subscriber").on(t.issueId, t.subscriberId),
    check(
      "news_sends_status",
      sql`${t.status} in ('queued', 'sending', 'sent', 'skipped', 'failed')`,
    ),
    index("news_sends_chunk").on(t.issueId, t.chunk),
    index("news_sends_created").on(t.createdAt),
  ],
);

/**
 * Per chunk of a send: which readers each Idempotency-Key attempt went to
 * (so a "Resend already took this key" answer only counts for exactly
 * those readers), and whether the chunk switched to one email at a time
 * (kept, so a resumed run never goes back to a batch).
 */
export const newsChunkState = pgTable(
  "news_chunk_state",
  {
    issueId: integer("issue_id")
      .notNull()
      .references(() => newsIssues.id, { onDelete: "cascade" }),
    chunk: integer("chunk").notNull(),
    /** { "<keyAttempt>": [news_sends ids, sorted] } */
    attempts: jsonb("attempts")
      .$type<Record<string, number[]>>()
      .notNull()
      .default({}),
    oneByOne: boolean("one_by_one").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.chunk] })],
);

/**
 * The one settings row (id = 1): the kill switch, the dry-run flag, and
 * the sender's heartbeat (checked by the daily cleanup cron).
 */
export const newsSettings = pgTable(
  "news_settings",
  {
    id: integer("id").primaryKey().default(1),
    /** On: the sender sends nothing (it still records its heartbeat). */
    paused: boolean("paused").notNull().default(false),
    /** On: each issue goes only to ALERT_EMAIL, subject "[Dry run] ...". */
    dryRun: boolean("dry_run").notNull().default(true),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    /**
     * The sender's lease: one run at a time. Taken by compare-and-set for
     * 10 minutes and renewed between chunks, so a crashed run frees it.
     */
    lockUntil: timestamp("lock_until", { withTimezone: true }),
    lockOwner: text("lock_owner"),
    /** Weekend Pick (Friday texts): its own kill switch and dry run. */
    textsPaused: boolean("texts_paused").notNull().default(false),
    /** On: texts go only to admins' numbers (or the log). Starts on. */
    textsDryRun: boolean("texts_dry_run").notNull().default(true),
    /** Why texts were paused automatically (the STOP-rate guardrail). */
    textsPausedReason: text("texts_paused_reason"),
    /** When an admin last turned texts back on: the guardrail looks after it. */
    textsGuardrailClearedAt: timestamp("texts_guardrail_cleared_at", {
      withTimezone: true,
    }),
    /** The Friday sender's own lease (one run at a time). */
    textsLockUntil: timestamp("texts_lock_until", { withTimezone: true }),
    textsLockOwner: text("texts_lock_owner"),
    /**
     * Instagram (lib/social): its own kill switch (off: nothing is created,
     * published or DM'd) and dry run (on: posts are rendered and checked,
     * and James gets the preview, but nothing goes to Meta). Dry run starts on.
     */
    socialEnabled: boolean("social_enabled").notNull().default(true),
    socialDryRun: boolean("social_dry_run").notNull().default(true),
    /** The social cron's lease (one run at a time). */
    socialLockUntil: timestamp("social_lock_until", { withTimezone: true }),
    socialLockOwner: text("social_lock_owner"),
    /** When the daily token check and comment digest last ran. */
    socialDailyAt: timestamp("social_daily_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("news_settings_one", sql`${t.id} = 1`)],
);

/** Code-made plans, one per issue date, so a re-check sees the same pick. */
export const newsPlans = pgTable("news_plans", {
  issueDate: date("issue_date").primaryKey(),
  plan: jsonb("plan").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Parents' corner posts James suggests by Instagram DM (lib/news/
 * suggestions.ts): one row per shared post, from an allow-listed sender
 * only (data/ig-suggesters.json). A suggestion raises a post's priority;
 * every check still decides whether it can run. Used once, and expired
 * after 60 days. No words of the DM are kept, only the shared link.
 */
export const newsIgSuggestions = pgTable(
  "news_ig_suggestions",
  {
    id: serial("id").primaryKey(),
    /** The Instagram message id that shared it (one row per message). */
    messageId: text("message_id").notNull(),
    /** Who sent it (an allow-listed username, lowercase). */
    sender: text("sender").notNull(),
    /** The shared post's link and its shortcode. */
    permalink: text("permalink").notNull(),
    shortcode: text("shortcode").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    /** The post's account and media id, once code has found them. */
    account: text("account"),
    mediaId: text("media_id"),
    /** open | used | expired */
    status: text("status").notNull().default("open"),
    /** The last time code couldn't use it, and why (for the plan's report). */
    note: text("note"),
    usedIssueDate: date("used_issue_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("news_ig_suggestions_message").on(t.messageId, t.shortcode),
    index("news_ig_suggestions_status").on(t.status, t.sentAt),
    check(
      "news_ig_suggestions_status_check",
      sql`${t.status} in ('open', 'used', 'expired')`,
    ),
  ],
);

/**
 * Clicks on /n/<issue>/<slug>: the same link for everyone, counted in
 * total. No person, cookie or IP is recorded.
 */
export const newsClicks = pgTable(
  "news_clicks",
  {
    issueDate: date("issue_date").notNull(),
    slug: text("slug").notNull(),
    clicks: integer("clicks").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.issueDate, t.slug] })],
);

/** Webhook deliveries already handled (Svix retries), kept 30 days. */
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Parents' corner v4: one row per X account in the universe we've seen or
 * added. The seed list is data/x-universe.json; rows added from roundups
 * carry added_from = 'roundup'. `samples` holds recent posts' engagement
 * (likes + 2 x reposts + quotes), newest first, so a post is scored
 * against its author's trailing median. An account that looks taken over
 * (a reused handle, a follower crash) is flagged and stays out until a
 * person clears flagged_reason.
 */
export const xAuthorStats = pgTable("x_author_stats", {
  /** X's permanent user id. */
  authorId: text("author_id").primaryKey(),
  username: text("username").notNull(),
  name: text("name"),
  followers: integer("followers"),
  followersPeak: integer("followers_peak"),
  /** [{id, e, at}], newest first, at most 40. */
  samples: jsonb("samples")
    .$type<{ id: string; e: number; at: string }[]>()
    .notNull()
    .default([]),
  /** The newest post at or over the likes floor (inactivity drop: 3 months). */
  lastFloorAt: timestamp("last_floor_at", { withTimezone: true }),
  addedFrom: text("added_from").notNull().default("seed"),
  /** Roundup links that named the account (two or more to add it). */
  roundups: jsonb("roundups").$type<string[]>().notNull().default([]),
  flaggedReason: text("flagged_reason"),
  flaggedAt: timestamp("flagged_at", { withTimezone: true }),
  /** political, commercial, adult, inactive: out for good. */
  droppedReason: text("dropped_reason"),
  droppedAt: timestamp("dropped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Kids' events (/events): one row per event page. A one-off has one date;
 * a series (a catalog event series, or the same venue and title stem) and
 * an annual event share one page with many dates. The writer hands them in
 * with evidence (POST /api/events); code checks them, keys the series,
 * maps printed ages to age tags, and re-checks the official page nightly.
 */
export const kidEvents = pgTable(
  "kid_events",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    /** one_off | series | annual */
    kind: text("kind").notNull(),
    /** Code's series key: catalog series id, or venue + title stem. */
    seriesKey: text("series_key").notNull().unique(),
    /** The validated event (lib/events/model.ts StoredEvent). */
    data: jsonb("data").notNull(),
    /** scheduled | canceled | postponed | rescheduled (from evidence). */
    status: text("status").notNull().default("scheduled"),
    /** ok | unconfirmed (two real misses in a row on the official page). */
    confirm: text("confirm").notNull().default("ok"),
    /** Consecutive nights the page loaded and the quote was gone (or 404). */
    misses: integer("misses").notNull().default(0),
    /** Consecutive nights the quote was seen (2 re-confirm an unconfirmed event). */
    seenStreak: integer("seen_streak").notNull().default(0),
    /** The last night the quote was still on the official page. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
    /** When the facts last changed (the sitemap's lastmod). */
    factsChangedAt: timestamp("facts_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When it was canceled, rescheduled, unconfirmed or confirmed again. */
    stateChangedAt: timestamp("state_changed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("kid_events_kind", sql`${t.kind} in ('one_off', 'series', 'annual')`),
    check(
      "kid_events_status",
      sql`${t.status} in ('scheduled', 'canceled', 'postponed', 'rescheduled')`,
    ),
    check("kid_events_confirm", sql`${t.confirm} in ('ok', 'unconfirmed')`),
  ],
);

/**
 * A family's saved kid events (/events/saved). One row per page and
 * occurrence: `occ` is the occurrence id (lib/events/model.ts
 * occurrenceId: "2026-12-06" or "2026-12-06-1400"), or "" for a regular
 * saved as a program (its next date, always). Signed out, saves live on
 * the phone (lib/events/prefs.ts) and join the family at sign-in. No
 * foreign key to kid_events: a page that came off shows as such.
 */
export const eventSaves = pgTable(
  "event_saves",
  {
    crewId: integer("crew_id")
      .notNull()
      .references(() => crews.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    occ: text("occ").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.crewId, t.slug, t.occ] })],
);

/**
 * Kid events a family hid from /events: one row per page (hiding a
 * program that runs at 5 libraries writes 5). Applied on the phone, so
 * the shared, cached listing never varies by family.
 */
export const eventHides = pgTable(
  "event_hides",
  {
    crewId: integer("crew_id")
      .notNull()
      .references(() => crews.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.crewId, t.slug] })],
);

/**
 * Admin repairs to kid_events, append-only: who trimmed, split off or
 * removed what (the event's dates before and after), so a wrong page can
 * be fixed from /admin without SQL and every fix leaves a trail. No
 * foreign key: a removed event's history stays.
 */
export const kidEventEdits = pgTable(
  "kid_event_edits",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    slug: text("slug").notNull(),
    /** trim | split | remove */
    action: text("action").notNull(),
    /** What changed: the occurrences removed, the new page, the reason. */
    detail: jsonb("detail").notNull(),
    /** The admin (explorers.id) who did it. */
    byExplorerId: integer("by_explorer_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("kid_event_edits_event").on(t.eventId),
    check(
      "kid_event_edits_action",
      sql`${t.action} in ('trim', 'split', 'remove')`,
    ),
  ],
);

/**
 * Weekend Pick: one row per (issue, number), claimed before the text goes,
 * so a number never gets the same week's text twice (the idempotency key).
 * sent | failed | skipped (window missed, monthly cap) | dry_run | sending
 */
export const smsProgramSends = pgTable(
  "sms_program_sends",
  {
    id: serial("id").primaryKey(),
    issueDate: date("issue_date").notNull(),
    /** Nulled 13 months after the send (with body); the row goes at 4 years. */
    phone: text("phone"),
    status: text("status").notNull(),
    body: text("body"),
    twilioSid: text("twilio_sid"),
    reason: text("reason"),
    /** Twilio's delivery report (StatusCallback): delivered, undelivered... */
    deliveryStatus: text("delivery_status"),
    errorCode: integer("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sms_program_sends_once").on(t.issueDate, t.phone),
    index("sms_program_sends_phone").on(t.phone, t.sentAt),
    index("sms_program_sends_sid").on(t.twilioSid),
    // logged: sending was off, so nothing left (never counts as a send).
    check(
      "sms_program_sends_status",
      sql`${t.status} in ('sending', 'sent', 'failed', 'skipped', 'dry_run', 'logged')`,
    ),
  ],
);

/**
 * The routines' retros (the Thursday writer, the daily events routine, the
 * Sunday maintainer, the Sunday Instagram routine): what went wrong, raw and append-only. Kept a year
 * (the daily cleanup deletes older rows). No personal details: the
 * routines never see any.
 */
export const newsRetros = pgTable(
  "news_retros",
  {
    id: serial("id").primaryKey(),
    /** writer | events | maintainer | social */
    kind: text("kind").notNull(),
    issueDate: date("issue_date"),
    body: jsonb("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("news_retros_created").on(t.createdAt),
    check(
      "news_retros_kind",
      sql`${t.kind} in ('writer', 'events', 'maintainer', 'social')`,
    ),
  ],
);

/**
 * Lessons: retro problems merged by code (lib/news/lessons.ts). The plan
 * carries the open ones from the last 8 weeks; the Sunday maintainer
 * fixes what it can in a pull request. Compliance lessons (competitors,
 * consent, evidence, safety, Terms, Privacy) are flagged by code and can
 * only move to needs_james or wontfix through the API.
 */
export const newsLessons = pgTable(
  "news_lessons",
  {
    id: serial("id").primaryKey(),
    /** validator | source | data | rule_conflict | idea */
    category: text("category").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    /** Source lessons: the host that kept us out. */
    host: text("host"),
    /** category + host + sha1 of the sorted normalized tokens. */
    fingerprint: text("fingerprint").notNull(),
    /** The last 10 examples ({url?, message?, at}). */
    examples: jsonb("examples").notNull().default([]),
    seenCount: integer("seen_count").notNull().default(1),
    firstSeen: timestamp("first_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** open | needs_james | fix_proposed | fixed | wontfix */
    status: text("status").notNull().default("open"),
    /** Seen again after it was fixed. */
    regressed: boolean("regressed").notNull().default(false),
    prUrl: text("pr_url"),
    /** The maintainer's one-line note (why wontfix, the decision needed). */
    note: text("note"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Set by code only: automation may only park it for James. */
    compliance: boolean("compliance").notNull().default(false),
  },
  (t) => [
    index("news_lessons_fingerprint").on(t.fingerprint),
    index("news_lessons_status").on(t.status, t.lastSeen),
    check(
      "news_lessons_category",
      sql`${t.category} in ('validator', 'source', 'data', 'rule_conflict', 'idea')`,
    ),
    check(
      "news_lessons_status",
      sql`${t.status} in ('open', 'needs_james', 'fix_proposed', 'fixed', 'wontfix')`,
    ),
  ],
);

/**
 * One row per POST /api/events hand-in: counts only, for the maintainer's
 * weekly stats (events stored and cut). Kept a year.
 */
export const kidEventHandins = pgTable(
  "kid_event_handins",
  {
    id: serial("id").primaryKey(),
    stored: integer("stored").notNull(),
    created: integer("created").notNull(),
    cut: integer("cut").notNull(),
    /** Hosts that kept us out: [{host, kind}] (no people, no pages). */
    blocked: jsonb("blocked").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("kid_event_handins_created").on(t.createdAt)],
);

/**
 * Instagram posts (lib/social): one row per post type per Pacific day. The
 * Sunday routine hands in Monday's park post and Wednesday's carousel; code
 * makes Thursday's teaser and Friday's Story from the sent issue. Rendered
 * media is stored in Blob by content hash (`media`). The cron creates the
 * Meta container in one run and publishes it in a later one, so a post is
 * never published twice: queued -> creating -> publishing -> published.
 * skipped / failed / dry_run / replaced are final.
 */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: serial("id").primaryKey(),
    /** park_post | unpack | teaser | story | events_week | at_home | mashup */
    kind: text("kind").notNull(),
    /** The Pacific day it goes out. */
    slotDate: date("slot_date").notNull(),
    publishAt: timestamp("publish_at", { withTimezone: true }).notNull(),
    /** writer (the Sunday routine) | code (teaser, story) */
    origin: text("origin").notNull(),
    status: text("status").notNull().default("queued"),
    /** The post as handed in (model words plus fact IDs). */
    body: jsonb("body").notNull(),
    /** Code's resolved post: slides, caption, alt text, the facts used. */
    spec: jsonb("spec").notNull(),
    /** [{ sha, type: image | video, width, height, alt }] in slide order. */
    media: jsonb("media").notNull().default([]),
    caption: text("caption"),
    report: jsonb("report"),
    /** Meta: the carousel's children, then the container to publish. */
    childIds: text("child_ids").array(),
    containerId: text("container_id"),
    igMediaId: text("ig_media_id"),
    fbPostId: text("fb_post_id"),
    /** Why it was skipped or failed (shown on /admin, mailed to James). */
    reason: text("reason"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /**
     * The Story echo (lib/social/echo.ts): the feed post again as Stories,
     * one per slide, once it's out (or in dry run). Null: not tried yet.
     * Then creating -> publishing -> published, or skipped / failed /
     * dry_run; publishing is one frame's publish, claimed.
     */
    echoStatus: text("echo_status"),
    /**
     * Echoes before Story frames (one "New post" card): its 1080 x 1920
     * JPEG ({ sha, ext, width, height, photoFree }). Kept for those rows.
     */
    echoMedia: jsonb("echo_media"),
    /**
     * The Story frames in slide order (EchoFrame[]): each one's JPEG, the
     * photo it shows, its container and media ids and its state. Null on
     * echoes from before frames (they use echo_media).
     */
    echoFrames: jsonb("echo_frames"),
    echoContainerId: text("echo_container_id"),
    echoMediaId: text("echo_media_id"),
    echoReason: text("echo_reason"),
    echoPublishedAt: timestamp("echo_published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One live post per type per day (a re-draft replaces a queued one).
    uniqueIndex("social_posts_slot")
      .on(t.kind, t.slotDate)
      .where(sql`${t.status} <> 'replaced'`),
    index("social_posts_due").on(t.status, t.publishAt),
    check(
      "social_posts_kind",
      sql`${t.kind} in ('park_post', 'unpack', 'teaser', 'story', 'events_week', 'at_home', 'mashup')`,
    ),
    check(
      "social_posts_status",
      sql`${t.status} in ('queued', 'creating', 'publishing', 'published', 'skipped', 'failed', 'dry_run', 'replaced')`,
    ),
    check(
      "social_posts_echo_status",
      sql`${t.echoStatus} in ('creating', 'publishing', 'published', 'skipped', 'failed', 'dry_run')`,
    ),
  ],
);

/**
 * The automated child-safety check (decision 10): the Sunday routine looks
 * at each photo with the vision model and reports whether a person is
 * visible. Keyed by the photo's URL and the sha256 of the bytes it looked
 * at, so a swapped file needs a new look. Only "clear" lets a photo into a
 * post; anything else (people, unsure, unchecked) gets the crayon card.
 */
export const socialPhotoChecks = pgTable(
  "social_photo_checks",
  {
    src: text("src").notNull(),
    sha256: text("sha256").notNull(),
    /** clear (no person visible) | people | unsure */
    verdict: text("verdict").notNull(),
    note: text("note"),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.src, t.sha256] }),
    check(
      "social_photo_checks_verdict",
      sql`${t.verdict} in ('clear', 'people', 'unsure')`,
    ),
  ],
);

/**
 * Keyword DMs: one row per comment (PARK) or Story reply (PICK) we
 * answered, claimed before the message goes, so nobody gets two. Only
 * Meta's ids: never a username, a name or the words.
 */
export const socialDmReplies = pgTable(
  "social_dm_replies",
  {
    id: serial("id").primaryKey(),
    /** comment | story_reply */
    kind: text("kind").notNull(),
    /** The comment id or the message id. */
    extId: text("ext_id").notNull().unique(),
    /** Our post it was on (comments). */
    postId: integer("post_id").references(() => socialPosts.id, {
      onDelete: "set null",
    }),
    /** sending | sent | failed | dry_run */
    status: text("status").notNull(),
    reason: text("reason"),
    /**
     * What Meta answered for a sent DM: its message id and the recipient's
     * Instagram-scoped id (ids only, for tracing a DM that never arrived).
     */
    messageId: text("message_id"),
    recipientId: text("recipient_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("social_dm_replies_created").on(t.createdAt),
    check(
      "social_dm_replies_status",
      sql`${t.status} in ('sending', 'sent', 'failed', 'dry_run')`,
    ),
  ],
);

export type Crew = typeof crews.$inferSelect;
export type Explorer = typeof explorers.$inferSelect;
export type Park = typeof parks.$inferSelect;

/**
 * The monthly re-check of park signature-trait evidence
 * (lib/park-profiles-check.ts), one row per evidence page. A trait whose
 * quote is in `missingQuotes` of a `missing` page with `missStreak` 2 or
 * more is dropped everywhere (posts, plans, park pages) until the quote
 * is seen again or the data is fixed. `unknownStreak` counts checks in a
 * row that couldn't tell (bot wall, timeout).
 */
export const parkEvidenceChecks = pgTable(
  "park_evidence_checks",
  {
    url: text("url").primaryKey(),
    /** ok | missing | unknown */
    status: text("status").notNull(),
    /** The quotes this page no longer prints (all of them on a 404 or 410). */
    missingQuotes: jsonb("missing_quotes")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    unknownStreak: integer("unknown_streak").notNull().default(0),
    /**
     * Checks in a row with a missing quote (overlapping misses). A trait
     * drops only at 2; a check that sees the quote again clears it.
     */
    missStreak: integer("miss_streak").notNull().default(0),
    /** When James was last told about this page; null: not yet. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "park_evidence_checks_status",
      sql`${t.status} in ('ok', 'missing', 'unknown')`,
    ),
  ],
);

/**
 * The two local family newsletters, as they arrive by email (lib/inbox):
 * the owner's Gmail forwards only their two senders to our private
 * inbound address, Resend receives it, and /api/inbound/email stores each
 * issue here. The daily events harvest reads them (GET
 * /api/events/issues, the ingest token), and an event verified on one
 * cites it as `issue:<id>`. Never shown or linked anywhere public. Kept
 * 120 days (pruned by the daily cleanup). `source` is an INBOX_SENDERS id,
 * or "gmail-forwarding" for Gmail's forwarding-confirmation email (its
 * code, for setup). One row per source and Message-ID.
 */
export const newsletterIssues = pgTable(
  "newsletter_issues",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    /** The email's Message-ID header (a resend:<id> stand-in without one). */
    messageId: text("message_id").notNull(),
    subject: text("subject").notNull(),
    /** The email's own Date header (when the newsletter sent it). */
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    /** Cleaned: tracking pixels out, unsubscribe links cut, links unwrapped. */
    html: text("html").notNull(),
    /** The html as page text (lib/news/validate.ts pageText): quotes match it. */
    text: text("text").notNull(),
    /** Each link: its anchor text, then its target. */
    links: jsonb("links")
      .$type<{ text: string; url: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("newsletter_issues_message").on(t.source, t.messageId),
    index("newsletter_issues_sent").on(t.sentAt),
    index("newsletter_issues_received").on(t.receivedAt),
  ],
);

/**
 * Google Places requests per Pacific day (the park pairings' searches),
 * so a run of retries never spends the key's small daily quota: each
 * request takes one first (lib/social/store.ts placesBudget). Counts only,
 * never anything of Google's.
 */
export const placesUsage = pgTable("places_usage", {
  day: date("day").primaryKey(),
  requests: integer("requests").notNull().default(0),
  /**
   * Place Details requests that refresh the pairing pages' names
   * (lib/pairing-pages-data.ts): Google counts Place Details apart from
   * Text Search, so they have their own small daily cap.
   */
  details: integer("details").notNull().default(0),
});

/**
 * Park pairings guides (/guides/<slug>, lib/pairing-guides.ts): the last
 * good set of pairs per page, refreshed in rotation by a daily cron within
 * the Places budget. `pairs` holds names and our own words, and is kept at
 * most 30 days after `refreshedAt` (Google's terms for anything from
 * Places); after that only `placeIds` stay, and the page hides the pairs.
 */
export const pairingGuides = pgTable("pairing_guides", {
  slug: text("slug").primaryKey(),
  /** The last good refresh (its pairs are shown for 30 days at most). */
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  /** The last refresh tried (good or not), for the rotation. */
  triedAt: timestamp("tried_at", { withTimezone: true }),
  /** When what the page shows last changed (its sitemap lastmod). */
  changedAt: timestamp("changed_at", { withTimezone: true }),
  /** GuidePair[] (lib/pairing-guides.ts), or [] once purged. */
  pairs: jsonb("pairs").notNull().default([]),
  /** Google's place ids of the pairs: ids may be kept. */
  placeIds: text("place_ids")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
});

/**
 * Pairing pages (/guides/pairings/<slug>, lib/pairing-pages.ts): one
 * evergreen page per published park pairings post, born when the post
 * goes out. `pairs` is fixed at birth and holds Google's place ids and our
 * own data only (the anchor, our distance, our line); the businesses'
 * names live in pairing_places, refreshed or purged within 30 days.
 */
export const pairingPages = pgTable(
  "pairing_pages",
  {
    slug: text("slug").primaryKey(),
    /** The social post it was born from (one page per post). */
    postId: integer("post_id").notNull(),
    theme: text("theme").notNull(),
    /** PagePairDef[] (lib/pairing-pages.ts): ids and our words, no names. */
    pairs: jsonb("pairs").notNull().default([]),
    bornAt: timestamp("born_at", { withTimezone: true }).notNull(),
    /** When what the page shows last changed (its sitemap lastmod). */
    changedAt: timestamp("changed_at", { withTimezone: true }),
    /**
     * A hash of what it showed at the last check ("" when hidden), to see
     * changes. A hash, so no business name outlives its 30 days here.
     */
    shownKey: text("shown_key").notNull().default(""),
    /** The post's own headline (our words): the page's one-line angle. */
    angle: text("angle").notNull().default(""),
  },
  (t) => [uniqueIndex("pairing_pages_post").on(t.postId)],
);

/**
 * The businesses on the pairing pages, by Google's place id (ids may be
 * kept). `name` is the one piece of Places content we print: refreshed by
 * Place Details within 30 days, else purged to null (the pair hides).
 */
export const pairingPlaces = pgTable("pairing_places", {
  placeId: text("place_id").primaryKey(),
  /** The printed name (cleaned), or null: purged, closed or gone. */
  name: text("name"),
  /** ok | closed (for now) | unfit (its name fails our rules) | gone */
  status: text("status").notNull().default("ok"),
  /** When `name` was read from Google (shown 30 days at most). */
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  /** The last refresh tried, good or not. */
  triedAt: timestamp("tried_at", { withTimezone: true }),
});
