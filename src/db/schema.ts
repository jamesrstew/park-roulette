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
    addedBy: integer("added_by").references(() => explorers.id),
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
  ],
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
