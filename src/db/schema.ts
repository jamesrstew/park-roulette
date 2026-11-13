import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
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
    /** send, attempt (not sent: over a limit), check, bad_code, ok (a code that worked) */
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

export type Crew = typeof crews.$inferSelect;
export type Explorer = typeof explorers.$inferSelect;
export type Park = typeof parks.$inferSelect;
