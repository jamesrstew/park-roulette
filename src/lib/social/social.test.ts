import { describe, expect, it, vi } from "vitest";
import { CATALOG } from "@/lib/news/catalog";
import type { Issue } from "@/lib/news/issue";
import type { EventRow } from "@/lib/events/model";
import {
  andList,
  composeParkPost,
  composeStory,
  sentencesOf,
  composeTeaser,
  type ParkInfo,
  weatherWord,
} from "./compose";
import { PARK_WORD, PICK_REPLY, wantsLink, wantsPick } from "./dm-rules";
import {
  containerParams,
  createContainer,
  GraphError,
  mediaComments,
  privateReply,
  publishContainer,
  retryableError,
  sendMessage,
  tokenValid,
} from "./graph";
import {
  COPY,
  igSource,
  mondayOf,
  type ParkPostDraft,
  photoCredit,
  slotFor,
  type UnpackDraft,
  WeekDraft,
} from "./model";
import type { ParkProfile } from "@/lib/park-profiles";
import {
  exclamationProblem,
  headlineCount,
  introProblems,
  longSentences,
  holidayHours,
  holidayIn,
  openDaysLine,
  overlap,
  schoolOutProblem,
  type SocialCtx,
  stillTrue,
  textProblems,
  unbackedClaims,
  ungrounded,
  validateParkPost,
  validateUnpack,
  voiceProblems,
} from "./validate";
import { listableParks } from "./candidates";
import { PENDING_POST_LINK } from "./links";

const BPRD = "Photo: Bend Park & Recreation District";

const park = (over: Partial<ParkInfo> = {}): ParkInfo => ({
  slug: "larkspur-park-bend",
  name: "Larkspur Park",
  city: "Bend",
  address: "1600 SE Reed Market Rd, Bend, OR 97701",
  status: "active",
  approved: true,
  play: "playground",
  features: ["accessible", "shade", "picnic", "trail"],
  ...over,
});

/** Thursday, November 19, 2026, 6 pm Pacific: the routine plans next week. */
const NOW = new Date("2026-11-20T02:00:00Z");
const WEEK = "2026-11-23";

function event(over: Partial<EventRow["data"]> = {}): EventRow {
  return {
    id: 1,
    slug: "no-school-open-rec-swim",
    kind: "series",
    status: "scheduled",
    confirm: "ok",
    lastSeenAt: null,
    factsChangedAt: new Date(),
    stateChangedAt: null,
    data: {
      title: "No School Open Rec Swim",
      dates: [{ day: "2026-11-27", start: "13:00", end: "15:00" }],
      venue: { name: "Madras Aquatic Center", town: "Madras" },
      what: "Open swim for kids on a no-school day at the Madras pool.",
      url: "https://www.macrecdistrict.com/",
      evidence: [
        {
          url: "https://www.macrecdistrict.com/",
          quote: "No School Open Rec Swim",
        },
      ],
      cost: {
        text: "$4 kids",
        prices: [{ label: "kids", amount: 4 }],
        free: false,
      },
      ages: { kids: true, tags: [] } as unknown as EventRow["data"]["ages"],
      point: null,
      checkQuote: "No School Open Rec Swim",
      ...over,
    } as EventRow["data"],
  };
}

const trait = (
  text: string,
  kind: ParkProfile["traits"][number]["kind"],
  keys: string[],
  source: ParkProfile["traits"][number]["source"] = "official",
) => ({
  text,
  keys,
  kind,
  source,
  evidence: [
    {
      url: "https://www.bendparksandrec.org/park/larkspur-park/",
      quote:
        "It features three distinct areas of play for children of all ages and abilities.",
    },
  ],
  verified_on: "2026-11-21",
});

const PROFILES_FIXTURE = new Map<string, ParkProfile>([
  [
    "larkspur-park-bend",
    {
      place_id: null,
      traits: [
        trait(
          "An all-children's playground with three zones for all abilities",
          "all_abilities",
          ["all abilities", "three zones"],
        ),
        trait("Trailhead for the Larkspur Trail", "trail", [
          "larkspur trail",
          "trailhead",
        ]),
      ],
      one_liner:
        "An all-children's playground for all abilities, at the Larkspur Trail.",
      glance: null,
      glance_source: null,
      glance_on: null,
      facts: {},
    },
  ],
  [
    "pine-nursery-park-bend",
    {
      place_id: null,
      traits: [trait("A stocked fishing pond", "water", ["fishing pond"])],
      one_liner: "A stocked fishing pond by the playground.",
      glance: null,
      glance_source: null,
      glance_on: null,
      facts: {},
    },
  ],
  [
    "blakely-park-bend",
    {
      place_id: null,
      traits: [
        trait(
          "A mostly fenced playground",
          "fenced",
          ["fenced"],
          "google_places",
        ),
        trait("Big lawns under shade trees", "shade", ["shade trees"]),
        trait("Near the Deschutes River Trail", "nearby", ["river trail"]),
      ],
      one_liner: "A mostly fenced playground with big shady lawns.",
      glance: null,
      glance_source: null,
      glance_on: null,
      facts: {},
    },
  ],
  [
    "harmon-park-bend",
    {
      place_id: null,
      traits: [
        trait("A small river access gate behind the Boat House", "water", [
          "river access",
        ]),
        trait("Big shade trees across the river from Drake Park", "shade", [
          "shade trees",
        ]),
      ],
      one_liner: "A river access gate and big shade trees.",
      glance: null,
      glance_source: null,
      glance_on: null,
      facts: {},
    },
  ],
]);

function ctx(over: Partial<SocialCtx> = {}): SocialCtx {
  const p = park();
  return {
    now: NOW,
    catalog: CATALOG,
    parks: new Map([
      [p.slug, p],
      [
        "pine-nursery-park-bend",
        park({
          slug: "pine-nursery-park-bend",
          name: "Pine Nursery Park",
          features: ["climbing", "slides", "swings"],
        }),
      ],
    ]),
    events: new Map([["no-school-open-rec-swim", event()]]),
    recent: [],
    profiles: PROFILES_FIXTURE,
    planParks: [p.slug],
    cooling: new Set(),
    photoFor: () => null,
    dms: false,
    evidence: async () => false,
    ...over,
  };
}

const parkPost = (over: Partial<ParkPostDraft> = {}): ParkPostDraft => ({
  type: "park_post",
  park: "larkspur-park-bend",
  story:
    "This week we're featuring Larkspur Park, a Bend playground for all abilities. There are three play zones, plus a walking trail.",
  who: "kids who want room to roam, little ones to big kids",
  bring: "mittens and a snack",
  hashtags: ["#BendOregon", "#CentralOregon", "#BendKids"],
  ...over,
});

const HDM_EVIDENCE = {
  url: "https://www.highdesertmuseum.org/visit/visit-bend-oregon/",
  quote: "Open Thanksgiving Day, Nov. 26, from 10 am to 4 pm",
};

const unpack = (over: Partial<UnpackDraft> = {}): UnpackDraft => ({
  type: "unpack",
  slot: "wed",
  headline: "Warm spots for a frosty week",
  highlight: "warm",
  items: [
    {
      ref: "venue:venue-high-desert-museum",
      what: "Indoor exhibits, a porcupine and a hands-on volcano.",
    },
    {
      ref: "venue:venue-the-pavilion",
      what: "Family skate sessions on the covered rink.",
    },
    {
      ref: "event:no-school-open-rec-swim@2026-11-27",
      what: "An afternoon swim with the pool open for kids.",
    },
    {
      ref: "park:larkspur-park-bend",
      what: "Accessible play and a picnic spot.",
    },
  ],
  hashtags: ["#BendOregon"],
  ...over,
});

describe("carousel intros", () => {
  const U = { kind: "unpack" as const, count: 4 };
  const H = { kind: "at_home" as const, count: 4, youngest: 2 };
  it("allow a short scene in our voice, and no place claims in an Unpack intro", () => {
    expect(
      introProblems(
        "A cold week ahead. These are the warm ones we picked.",
        11,
        U,
      ),
    ).toEqual([]);
    expect(
      introProblems("Slides and shade at every stop this week.", 11, U)[0],
    ).toMatch(/no place claims here \(slides, shade\)/);
    // At home: the same words are fine (no place to back).
    expect(
      introProblems("Slides down the hallway, then a nap.", 11, H),
    ).toEqual([]);
    expect(introProblems("One. Two. Three.", 11, H).join(" ")).toMatch(
      /1 or 2 short sentences/,
    );
    expect(introProblems("I love a slow morning.", 11, H)[0]).toMatch(
      /first person singular/,
    );
  });
  it("name only a town, and state no price, hours, holiday or indoor claim", () => {
    expect(
      introProblems("A whole week off, and all of these are in Bend.", 11, U),
    ).toEqual([]);
    expect(
      introProblems("Start at the High Desert Museum this week.", 11, U).join(
        " ",
      ),
    ).toMatch(/"High, Desert, Museum" names something/);
    for (const [line, word] of [
      ["Most of these are free this week.", "free"],
      ["Everything is open late this week.", "open"],
      ["Holiday weeks fill up fast.", "Holiday"],
      ["All of it is indoors and out of the wind.", "indoors"],
      ["The pool is heated, so pack a towel.", "heated"],
    ])
      expect(introProblems(line, 11, U).join(" "), line).toContain(
        `"${word}" is a fact the items carry`,
      );
  });
  it("hold any number to the count after cuts", () => {
    expect(
      introProblems("These four are warm, and close to home.", 11, U),
    ).toEqual([]);
    expect(
      introProblems("These five are warm, and close to home.", 11, U)[0],
    ).toMatch(/says five, but the post has 4 items after cuts/);
    expect(
      introProblems("Pick 3 for the morning and save the rest.", 11, H)[0],
    ).toMatch(/says 3, but the post has 4 ideas/);
  });
  it("hold an at home intro to the hazard and household rules for the youngest idea", () => {
    expect(
      introProblems("Start with the scissors while it snows.", 11, H).join(" "),
    ).toMatch(/not safe for these ages/);
    expect(
      introProblems("Skip the videos and start with paper.", 11, H).join(" "),
    ).toMatch(/something to buy, print or watch/);
  });
});

describe("the calendar", () => {
  it("puts each post at its Pacific time, in PST and PDT", () => {
    expect(slotFor("park_post", WEEK).publishAt.toISOString()).toBe(
      "2026-11-23T20:15:00.000Z",
    );
    expect(slotFor("unpack", WEEK).publishAt.toISOString()).toBe(
      "2026-11-26T03:45:00.000Z",
    );
    expect(slotFor("teaser", WEEK).publishAt.toISOString()).toBe(
      "2026-11-26T15:15:00.000Z",
    );
    expect(slotFor("story", WEEK).publishAt.toISOString()).toBe(
      "2026-11-28T00:30:00.000Z",
    );
    expect(slotFor("unpack", WEEK, true).date).toBe("2026-11-22");
    expect(slotFor("park_post", "2027-06-07").publishAt.toISOString()).toBe(
      "2027-06-07T19:15:00.000Z",
    );
  });
  it("finds the Monday", () => {
    expect(mondayOf("2026-11-26")).toBe(WEEK);
    expect(mondayOf("2026-11-29")).toBe(WEEK);
    expect(mondayOf(WEEK)).toBe(WEEK);
  });
});

describe("text rules", () => {
  const t = (s: string, month = 11) => textProblems(s, { month, label: "x" });
  it("refuses competitors, first person, links, emoji and restrooms in winter", () => {
    expect(t("Seen in the Bend Buzz")).toHaveLength(1);
    expect(t("We went on Saturday")[0]).toMatch(/first person/);
    expect(t("My kids loved it")[0]).toMatch(/first person/);
    expect(t("See bendparksandrec.org")[0]).toMatch(/links/);
    expect(t("Fun #BendKids")[0]).toMatch(/links/);
    expect(t("So fun \u{1F389}")[0]).toMatch(/emoji/);
    expect(t("Restrooms by the lot")[0]).toMatch(/restroom/);
    expect(t("Restrooms by the lot", 7)).toEqual([]);
    expect(t("Vote for the best park")[0]).toMatch(/politics/);
    expect(t("A fenced toddler corner and two slides.")).toEqual([]);
  });
  it("lets Park Roulette say we, never I, and never claim a visit, a kid or an invitation", () => {
    expect(t("This week we're featuring Compass Park.")).toEqual([]);
    expect(t("Our pick this week has a fort zone.")).toEqual([]);
    expect(t("This week's pick is Compass Park.")).toEqual([]);
    expect(t("Every Thursday we send one plan.")).toEqual([]);
    expect(t("It's in our free Thursday email.")).toEqual([]);
    expect(t("We picked a warm one for the cold week.")).toEqual([]);
    expect(t("I love this park")[0]).toMatch(/first person singular/);
    expect(t("Ask me about it")[0]).toMatch(/first person singular/);
    for (const claim of [
      "We went on Saturday",
      "We loved the forts",
      "Our kids built a fort",
      "Our little ones ran laps",
      "Join us at the park",
      "See you there",
    ])
      expect(t(claim).join(" "), claim).toMatch(/never claims a visit/);
    // Any other we, our or us is refused: only the publisher frames pass.
    for (const line of [
      "We love this park in the snow",
      "We've been coming here for years",
      "We usually go on Saturday mornings",
      "Last time we were there",
      "We sledded here last winter",
      "We saw an owl",
      "Our 4-year-old calls it the castle park",
      "Our kiddo never wants to leave",
      "Our favorite sledding hill",
      "Meet us at the fort",
      "Come say hi, we'll be at the hill Saturday",
      "We're headed there Saturday",
      "We always bring cocoa",
      "We have kids who climb everything",
      "we have snacks for everyone at the fort",
    ])
      expect(t(line).join(" "), line).toMatch(
        /first person "we", "our" and "us" only as the publisher/,
      );
    // Words that aren't ours (an event's own summary): no "we" either.
    expect(
      textProblems("We'll paint ornaments", {
        month: 12,
        label: "descriptor",
        plural: false,
      })[0],
    ).toMatch(/words that aren't ours/);
  });
  it("refuses the voice guide's cliches, long sentences and exclamation spam", () => {
    for (const [line, label] of [
      ["A must-see spot in Bend", "must-see"],
      ["Your kids will love it", "will love it"],
      ["Adventure awaits in NorthWest Crossing", "adventure awaits"],
      ["A magical place to make memories", "magical"],
      ["Nestled by the river, it boasts amenities", "nestled"],
      ["Tag a friend who needs this", "tag a friend"],
      ["Don't miss this one", "don't miss"],
      ["Warm boots are a must for this hill", "a must"],
      ["A hidden gem with something for everyone", "hidden gem"],
    ])
      expect(voiceProblems(line, "story").join(" "), line).toContain(label);
    expect(
      voiceProblems(
        "Kids build their own forts in the Wildside zone.",
        "story",
      ),
    ).toEqual([]);
    // Not promotional: a plain step passes.
    expect(voiceProblems("Don't miss a corner of the room.", "step")).toEqual(
      [],
    );
    expect(
      longSentences(
        "Kids build forts. This sentence goes on and on with one more thing and then another thing and then a third thing after that one too.",
        "story",
      )[0],
    ).toMatch(/runs 2\d words; keep each sentence to 22/);
    expect(exclamationProblem(["A fort zone!", "Bring gloves."])).toBeNull();
    expect(exclamationProblem(["A fort zone!", "Bring gloves!"])).toMatch(
      /2 exclamation points/,
    );
  });
  it("splits sentences without breaking at an abbreviation", () => {
    expect(
      sentencesOf("Meet Dr. Seuss at St. Francis. Then play. Done!"),
    ).toEqual(["Meet Dr. Seuss at St. Francis.", "Then play.", "Done!"]);
    expect(andList(["paper"])).toBe("paper");
    expect(andList(["paper", "tape", "crayons"])).toBe(
      "paper, tape and crayons",
    );
  });
  it("checks feature claims against the park's record", () => {
    expect(unbackedClaims("Big climbers and a zipline", ["climbing"])).toEqual([
      "a zipline",
    ]);
    expect(unbackedClaims("Universal-design play", ["accessible"])).toEqual([]);
    expect(unbackedClaims("Swings for babies", ["baby_swings"])).toEqual([]);
  });
  it("measures trigram overlap", () => {
    const a = "A Bend playground built for every kid with picnic tables";
    expect(overlap(a, a)).toBe(1);
    expect(
      overlap(a, "Something else entirely about sledding hills today"),
    ).toBe(0);
    expect(overlap("too short", a)).toBe(0);
  });
  it("words a venue's open days", () => {
    expect(
      openDaysLine(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
    ).toBe("Open daily");
    expect(openDaysLine(["tue", "wed", "thu", "fri", "sat"])).toBe(
      "Open Tue to Sat",
    );
    expect(openDaysLine(["mon", "wed", "fri"])).toBe("Open Mon, Wed, Fri");
  });
  it("knows Thanksgiving week", () => {
    expect(holidayIn("2026-11-25", 7)).toEqual({
      name: "Thanksgiving",
      date: "2026-11-26",
    });
    expect(holidayIn("2026-12-01", 7)).toBeNull();
  });
  it("grounds a line in its source words", () => {
    expect(
      ungrounded(
        "Indoor exhibits, a porcupine and a hands-on volcano.",
        CATALOG.venues.find((v) => v.id === "venue-high-desert-museum")!.what,
      ),
    ).toEqual([]);
    expect(
      ungrounded("Live owls and a planetarium show.", "Indoor exhibits"),
    ).toEqual(["live", "owls", "planetarium", "show"]);
  });
  it("reads a headline's count, digits or words", () => {
    expect(headlineCount("5 warm spots")).toBe(5);
    expect(headlineCount("Five warm spots")).toBe(5);
    expect(headlineCount("Warm spots for a frosty week")).toBeNull();
  });
});

describe("holiday hours", () => {
  const thanks = { name: "Thanksgiving", date: "2026-11-26" };
  it("needs the holiday or its date, and a time", () => {
    expect(holidayHours(HDM_EVIDENCE.quote, thanks)).toBe(
      "Holiday hours: 10 am to 4 pm",
    );
    expect(holidayHours("Nov 26: 9:30am - 2 pm", thanks)).toBe(
      "Holiday hours: 9:30 am to 2 pm",
    );
    expect(holidayHours("Thanksgiving: special hours from 11 am", thanks)).toBe(
      COPY.holidayVaries,
    );
    expect(holidayHours("Closed Thanksgiving Day", thanks)).toBe("closed");
    expect(holidayHours("Open daily 10 am to 5 pm", thanks)).toBeNull();
    expect(
      holidayHours("Happy Thanksgiving from all of us", thanks),
    ).toBeNull();
  });
});

describe("the park post", () => {
  it("passes with a plan park and builds the caption from code facts", async () => {
    const r = await validateParkPost(parkPost(), WEEK, ctx());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const c = r.spec!.caption!;
    expect(
      c.startsWith(
        "This week we're featuring Larkspur Park, a Bend playground for all abilities. There are three play zones",
      ),
    ).toBe(true);
    expect(c).toContain(
      "\n\nBest for: kids who want room to roam, little ones to big kids\nBring: mittens and a snack\nWhere: 1600 SE Reed Market Rd, Bend, OR 97701\n",
    );
    expect(c).toContain(COPY.captionClose.park_post);
    expect(r.spec!.headline).toBe(
      "This week we're featuring Larkspur Park, a Bend playground for all abilities.",
    );
    // Facebook links straight to the park (James, Nov 23).
    expect(r.spec!.fbCaption).toContain(
      "Details and links: https://parkroulette.quest/parks/larkspur-park-bend?from=fb",
    );
    expect(r.spec!.fbCaption).not.toContain(COPY.bio);
    expect(c).toContain(COPY.bio);
    expect(c).not.toContain("Comment PARK");
    expect(c).not.toContain("Photo:");
    expect(r.warnings[0]).toMatch(/crayon/);
    expect(r.spec!.slides).toHaveLength(1);
    expect(r.spec!.slides[0].t).toBe("parkcard");
    expect(r.spec!.alts[0]).toMatch(/crayon drawing/);
  });
  it("credits a checked photo from its own source fields", async () => {
    const r = await validateParkPost(
      parkPost(),
      WEEK,
      ctx({
        photoFor: () => ({
          src: "https://www.bendparksandrec.org/x.jpg",
          sha256: "a".repeat(64),
          credit: BPRD,
        }),
      }),
    );
    expect(r.spec!.caption).toContain(BPRD);
    expect(
      photoCredit({ sourceUrl: "https://www.bendparksandrec.org/park/x/" }),
    ).toBe(BPRD);
    expect(
      photoCredit({
        sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
        author: "Jane Doe",
        license: "CC BY-SA 4.0",
      }),
    ).toBe("Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons");
    expect(photoCredit({ sourceUrl: "https://example.com/x" })).toBeNull();
  });
  it("refuses a park code didn't pick, a cooling park, claims (bring too) and too many words", async () => {
    const r = await validateParkPost(
      parkPost({
        park: "pine-nursery-park-bend",
        story:
          "This week we're featuring Pine Nursery Park, with a zipline and swings for all abilities and a long list of other things to try today.",
        bring: "Swimsuits for the splash pad.",
      }),
      WEEK,
      ctx({ cooling: new Set(["pine-nursery-park-bend"]) }),
    );
    expect(r.ok).toBe(false);
    const all = r.errors.join(" ");
    expect(all).toMatch(/plan's park candidates/);
    expect(all).toMatch(/last 8 weeks/);
    expect(all).toMatch(/zipline/);
    expect(all).toMatch(/splash pad/);
    expect(all).toMatch(/first sentence runs \d+ characters/);
  });
  it("needs a covering break, of the named town's district, to say school is out", async () => {
    const r = await validateParkPost(
      parkPost({ bring: "No school all week: an easy morning." }),
      WEEK,
      ctx(),
    );
    expect(r.errors.join(" ")).toMatch(/break_id/);
    const ok = await validateParkPost(
      parkPost({
        bring: "No school all week: an easy morning.",
        break_id: "break-bls-fall",
      }),
      WEEK,
      ctx(),
    );
    expect(ok.ok).toBe(true);
    expect(
      schoolOutProblem(
        "Kids are off in Redmond all week",
        "break-bls-fall",
        ctx(),
        "2026-11-23",
        "2026-11-27",
      ),
    ).toMatch(/Redmond/);
    expect(
      schoolOutProblem(
        "Break week in Bend",
        "break-bls-fall",
        ctx(),
        "2026-11-30",
        "2026-12-04",
      ),
    ).toMatch(/break_id/);
  });
  it("refuses a repeat of a recent post", async () => {
    const r = await validateParkPost(
      parkPost(),
      WEEK,
      ctx({
        recent: [
          {
            kind: "unpack",
            slotDate: "2026-11-18",
            modelText:
              "A Bend playground for all abilities\nThree play zones for all abilities, plus a walking trail.\nKids who want room to roam, little ones to big kids.",
          },
        ],
      }),
    );
    expect(r.errors.join(" ")).toMatch(/Too close/);
  });
  it("refuses a slot that has passed", async () => {
    const r = await validateParkPost(parkPost(), "2026-11-16", ctx());
    expect(r.errors.join(" ")).toMatch(/too soon/);
  });
});

describe("the Unpack carousel", () => {
  it("cuts venues without verified holiday hours in Thanksgiving week", async () => {
    const r = await validateUnpack(unpack(), WEEK, ctx());
    expect(r.cut.length).toBe(2);
    expect(r.cut[0]).toMatch(/Thanksgiving/);
    expect(r.errors.join(" ")).toMatch(/Only 2 items/);
  });
  it("keeps a venue whose own site prints its holiday hours, and shows them", async () => {
    const items = unpack().items.map((i) =>
      i.ref === "venue:venue-high-desert-museum"
        ? { ...i, holiday_evidence: HDM_EVIDENCE }
        : i,
    );
    const r = await validateUnpack(
      unpack({ items }),
      WEEK,
      ctx({ evidence: async () => true }),
    );
    expect(r.cut).toHaveLength(1); // the Pavilion: no evidence
    expect(r.ok).toBe(true);
    const s = r.spec!;
    const hdm = s.slides.find(
      (x) => x.t === "item" && x.name === "High Desert Museum",
    );
    expect(hdm).toMatchObject({
      facts: ["Holiday hours: 10 am to 4 pm", "All ages", "Paid entry", "Bend"],
    });
    const swim = s.slides.find(
      (x) => x.t === "item" && x.name === "No School Open Rec Swim",
    );
    expect(swim).toMatchObject({
      // Where and who on their own lines now, not a venue chip.
      facts: ["Fri, Nov 27 · 1 pm to 3 pm", "$4 kids"],
      place: "At Madras Aquatic Center",
    });
    const lark = s.slides.find(
      (x) => x.t === "item" && x.name === "Larkspur Park",
    );
    expect(lark).toMatchObject({
      facts: ["Accessible play", "Shade", "Bend"],
    });
    expect(s.slides[0]).toMatchObject({ t: "headline", highlight: "warm" });
    expect(s.slides.at(-1)).toMatchObject({ t: "cta", line: COPY.thursday });
    expect(r.warnings.join(" ")).toMatch(/No intro/);
    const withIntro = await validateUnpack(
      unpack({
        items,
        intro: "A frosty week ahead. These are the warm ones.",
      }),
      WEEK,
      ctx({ evidence: async () => true }),
    );
    expect(withIntro.ok).toBe(true);
    const cap = withIntro.spec!.caption!;
    expect(cap).toContain(
      "Warm spots for a frosty week\n\nA frosty week ahead. These are the warm ones.\n\n1. High Desert Museum\nIndoor exhibits, a porcupine and a hands-on volcano.\nHoliday hours: 10 am to 4 pm · All ages · Paid entry · Bend\n",
    );
    expect(cap).toContain(COPY.captionClose.unpack);
    expect(withIntro.spec!.modelText).toContain("These are the warm ones.");
    expect(s.alts).toHaveLength(s.slides.length);
    // Unpack's own page needs its id: the pending link until it's stored.
    expect(s.fbCaption).toContain(`Details and links: ${PENDING_POST_LINK}`);
    expect(s.fbCaption).not.toContain(COPY.bio);
  });
  it("refuses holiday evidence from another site, even an allowed one", async () => {
    const items = unpack().items.map((i) =>
      i.ref.startsWith("venue:")
        ? {
            ...i,
            holiday_evidence: {
              url: "https://www.bendoregon.gov/holidays",
              quote: HDM_EVIDENCE.quote,
            },
          }
        : i,
    );
    const r = await validateUnpack(
      unpack({ items }),
      WEEK,
      ctx({ evidence: async () => true }),
    );
    expect(r.cut.join(" ")).toMatch(/High Desert Museum: Thanksgiving week/);
  });
  it("cuts a line its source doesn't back, and a park line the record doesn't", async () => {
    const r = await validateUnpack(
      unpack({
        items: [
          ...unpack().items.slice(2),
          {
            ref: "venue:venue-high-desert-museum",
            what: "Live owls and a planetarium show.",
            holiday_evidence: HDM_EVIDENCE,
          },
        ].map((i) =>
          i.ref.startsWith("park:")
            ? { ...i, what: "A zipline and a big sandbox." }
            : i,
        ),
      }),
      WEEK,
      ctx({ evidence: async () => true }),
    );
    expect(r.cut.join(" ")).toMatch(/planetarium/);
    expect(r.cut.join(" ")).toMatch(/zipline/);
  });
  it("cuts an event less than 12 hours after the post, and one not listed", async () => {
    const soon = event({ dates: [{ day: "2026-11-26", start: "06:00" }] });
    const r = await validateUnpack(
      unpack({
        items: [
          ...unpack().items.slice(2),
          { ref: "event:soon@2026-11-26", what: "An open swim for kids." },
        ],
      }),
      WEEK,
      ctx({
        events: new Map([
          ["no-school-open-rec-swim", event()],
          ["soon", { ...soon, slug: "soon" }],
        ]),
      }),
    );
    expect(r.cut.join(" ")).toMatch(/less than 12 hours/);
    const gone = await validateUnpack(
      unpack(),
      WEEK,
      ctx({
        events: new Map([
          ["no-school-open-rec-swim", { ...event(), confirm: "unconfirmed" }],
        ]),
      }),
    );
    expect(gone.cut.join(" ")).toMatch(/not on the events listing/);
  });
  it("checks headline words, the highlight and the Sunday slot", async () => {
    const r = await validateUnpack(
      unpack({ headline: "Warm spots", highlight: "cozy", slot: "sun" }),
      WEEK,
      ctx({ evidence: async () => true }),
    );
    const all = r.errors.join(" ");
    expect(all).toMatch(/4 to 8 words/);
    expect(all).toMatch(/highlight/);
    expect(all).toMatch(/Sunday carousel/);
  });
  it("holds a headline's count to the items, both ways, and hashtags to the list", async () => {
    const items = unpack().items.map((i) =>
      i.ref.startsWith("venue:") ? { ...i, holiday_evidence: HDM_EVIDENCE } : i,
    );
    const over = await validateUnpack(
      unpack({ headline: "Five warm spots for a frosty week", items }),
      WEEK,
      ctx({ evidence: async () => true }),
    );
    expect(over.errors.join(" ")).toMatch(/says 5/);
    const under = await validateUnpack(
      unpack({
        headline: "2 warm spots for a frosty week",
        hashtags: ["#Fun"],
        items,
      }),
      WEEK,
      ctx({ evidence: async () => true }),
    );
    expect(under.errors.join(" ")).toMatch(/says 2/);
    expect(under.errors.join(" ")).toMatch(/#Fun/);
  });
});

describe("Thursday's teaser and Friday's Story", () => {
  const issue = {
    issue_date: "2026-11-26",
    subject: "A cold, sunny weekend",
    preview: "Bundle up: Saturday is clear and crisp.",
    hello: { text: "x".repeat(40) },
    weekend_ahead: {
      days: [
        {
          date: "2026-11-27",
          label: "Friday",
          condition: "Sunny",
          icon: "sun",
          high: 41,
          low: 19,
          precip: null,
        },
        {
          date: "2026-11-28",
          label: "Saturday",
          condition: "Snow",
          icon: "snow",
          high: 30,
          low: 19,
          precip: 60,
        },
        {
          date: "2026-11-29",
          label: "Sunday",
          condition: "Sunny",
          icon: "sun",
          high: 36,
          low: 22,
          precip: null,
        },
      ],
    },
    wheel_pick: {
      park: "larkspur-park-bend",
      why_now: "Paths get cleared first.",
      who_for: "All",
      bring: "Mittens",
    },
    passport: { challenge_id: "c", text: "Stamp it." },
    signoff: { text: "Hit reply." },
  } as Issue;
  it("takes every word from the issue, and draws the crayon card", () => {
    const s = composeTeaser(issue, park(), false);
    expect(s.headline).toBe("This weekend: Snow + Larkspur Park");
    expect(s.slides.map((x) => x.t)).toEqual([
      "headline",
      "weather",
      "park",
      "cta",
    ]);
    expect(s.slides.every((x) => !("photo" in x) || x.photo === null)).toBe(
      true,
    );
    expect(s.caption).toContain(issue.preview);
    expect(s.caption).toContain(COPY.bio);
    expect(s.caption).not.toContain("Photo:");
    expect(s.caption).toContain(
      `This week's pick is Larkspur Park in Bend. ${issue.wheel_pick.why_now}`,
    );
    expect(s.caption).toContain(`${COPY.teaserClose}\n${COPY.bio}`);
    expect(weatherWord("partly")).toBe("Sun and clouds");
  });
  it("drops the weather slide without a forecast", () => {
    const s = composeTeaser(
      { ...issue, weekend_ahead: undefined },
      park(),
      true,
    );
    expect(s.headline).toBe("This weekend: Larkspur Park");
    expect(s.slides.map((x) => x.t)).toEqual(["headline", "park", "cta"]);
    // "Comment PARK" is the Unpack's alone, even with DMs on.
    expect(s.caption).toContain(COPY.bio);
    expect(s.caption).not.toContain("Comment PARK");
  });
  it("makes the Story: Saturday and Sunday, no caption, Link in bio while DMs are off", () => {
    const s = composeStory(issue, park(), false);
    expect(s.caption).toBeNull();
    expect(s.size).toBe("story");
    const slide = s.slides[0];
    expect(slide.t === "story" && slide.days.map((d) => d.label)).toEqual([
      "Saturday",
      "Sunday",
    ]);
    expect(slide).toMatchObject({ cta: "Link in bio", photo: null });
    expect(composeStory(issue, park(), true).slides[0]).toMatchObject({
      cta: "Reply PICK",
    });
  });
  it("the park post's caption carries the credit only with a photo", () => {
    expect(
      composeParkPost(parkPost(), park(), null, false).caption,
    ).not.toContain("Photo:");
  });
});

describe("re-checks before publishing", () => {
  it("skips when a park closed or an event was canceled", () => {
    const c = ctx();
    const facts = {
      parks: ["larkspur-park-bend"],
      events: [{ slug: "no-school-open-rec-swim", day: "2026-11-27" }],
      venues: ["venue-high-desert-museum"],
      issue: null,
    };
    expect(stillTrue(facts, c)).toBeNull();
    expect(
      stillTrue(facts, {
        ...c,
        parks: new Map([["larkspur-park-bend", park({ status: "closed" })]]),
      }),
    ).toMatch(/isn't open/);
    const canceled = event({ statusByDay: { "2026-11-27": "canceled" } });
    expect(
      stillTrue(facts, {
        ...c,
        events: new Map([["no-school-open-rec-swim", canceled]]),
      }),
    ).toMatch(/isn't going ahead/);
  });
});

describe("parks closed for now (catalog closed)", () => {
  const closedCatalog = {
    ...CATALOG,
    parks: [
      ...CATALOG.parks,
      {
        slug: "larkspur-park-bend",
        no_pick: false,
        snow_ok: false,
        closed: true,
      },
    ],
  };
  it("leaves them out of the plan's Unpack park list", () => {
    const c = ctx();
    expect(
      listableParks(c.parks, CATALOG, new Set()).map((p) => p.slug),
    ).toContain("larkspur-park-bend");
    expect(
      listableParks(c.parks, closedCatalog, new Set()).map((p) => p.slug),
    ).not.toContain("larkspur-park-bend");
    // The real catalog: Columbia (construction) is never offered.
    const columbia = park({
      slug: "columbia-park-bend",
      name: "Columbia Park",
    });
    expect(
      listableParks(new Map([[columbia.slug, columbia]]), CATALOG, new Set()),
    ).toEqual([]);
  });
  it("cuts them from an Unpack, refuses a park post, and skips at publish", async () => {
    const c = ctx({ catalog: closedCatalog });
    const u = await validateUnpack(unpack(), WEEK, c);
    expect(u.cut.join(" ")).toMatch(/Larkspur Park is closed for now/);
    const r = await validateParkPost(parkPost(), WEEK, c);
    expect(r.errors.join(" ")).toMatch(/closed for now/);
    const facts = { parks: ["larkspur-park-bend"], events: [], venues: [] };
    expect(stillTrue({ ...facts, issue: null }, ctx())).toBeNull();
    expect(stillTrue({ ...facts, issue: null }, c)).toMatch(/closed for now/);
  });
});

describe("the draft shape", () => {
  it("defaults hashtags and refuses unknown keys", () => {
    const d = WeekDraft.parse({
      week_of: WEEK,
      posts: [{ ...parkPost(), hashtags: undefined }],
    });
    expect(d.posts[0].hashtags).toEqual([
      "#BendOregon",
      "#CentralOregon",
      "#BendKids",
    ]);
    expect(
      WeekDraft.safeParse({
        week_of: WEEK,
        posts: [{ ...parkPost(), caption: "x" }],
      }).success,
    ).toBe(false);
  });
  it("maps /ig?from= to a source, never trusting other keys", () => {
    expect(igSource("ig")).toBe("ig_bio");
    expect(igSource("ig_dm")).toBe("ig_dm");
    expect(igSource("fb")).toBe("fb");
    expect(igSource("constructor")).toBe("ig_bio");
    expect(igSource(["fb"])).toBe("ig_bio");
    expect(igSource(undefined)).toBe("ig_bio");
  });
});

describe("Graph API", () => {
  const opts = (r: (u: string, init?: RequestInit) => Promise<Response>) => ({
    token: "TOKEN123",
    igUserId: "1784000000",
    fetchImpl: r as unknown as typeof fetch,
  });
  it("builds each container the way the spec says", () => {
    expect(containerParams({ kind: "story", imageUrl: "u" })).toEqual({
      media_type: "STORIES",
      image_url: "u",
    });
    expect(
      containerParams({
        kind: "image",
        imageUrl: "u",
        caption: "c",
        altText: "a",
      }),
    ).toEqual({ image_url: "u", caption: "c", alt_text: "a" });
    expect(
      containerParams({ kind: "carousel_item", imageUrl: "u", altText: "a" }),
    ).toEqual({ image_url: "u", is_carousel_item: true, alt_text: "a" });
    expect(
      containerParams({ kind: "carousel", children: ["1", "2"], caption: "c" }),
    ).toEqual({ media_type: "CAROUSEL", children: "1,2", caption: "c" });
  });
  it("keeps the token out of the URL and signs with appsecret_proof", async () => {
    const f = vi.fn(async () => Response.json({ id: "17890" }));
    await createContainer(
      { kind: "story", imageUrl: "https://parkroulette.quest/social/m/x.jpg" },
      { ...opts(f), appSecret: "s" },
    );
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/graph\.facebook\.com\/v23\.0\//);
    expect(url).not.toContain("TOKEN123");
    expect(url).toContain("appsecret_proof=");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer TOKEN123",
    );
    expect(String(init.body)).toContain("media_type=STORIES");
  });
  it("marks 5xx and timeouts unclear, rate limits and fetch hiccups retryable, a 4xx a clear no", async () => {
    await expect(
      publishContainer(
        "1",
        opts(async () => new Response("x", { status: 502 })),
      ),
    ).rejects.toMatchObject({ ambiguous: true, retryable: true });
    await expect(
      publishContainer(
        "1",
        opts(async () => {
          throw new Error("timeout");
        }),
      ),
    ).rejects.toMatchObject({ ambiguous: true, status: 0 });
    const limited = await publishContainer(
      "1",
      opts(async () =>
        Response.json(
          { error: { message: "slow down", code: 4 } },
          { status: 400 },
        ),
      ),
    ).catch((e) => e);
    expect(limited).toMatchObject({ ambiguous: false, retryable: true });
    const fetchFail = await createContainer(
      { kind: "story", imageUrl: "u" },
      opts(async () =>
        Response.json(
          { error: { message: "x", code: 9004, error_subcode: 2207052 } },
          { status: 400 },
        ),
      ),
    ).catch((e) => e);
    expect(fetchFail.retryable).toBe(true);
    const no = await publishContainer(
      "1",
      opts(async () =>
        Response.json(
          { error: { message: "bad", code: 100 } },
          { status: 400 },
        ),
      ),
    ).catch((e) => e);
    expect(no).toBeInstanceOf(GraphError);
    expect(no).toMatchObject({ ambiguous: false, retryable: false });
    expect(retryableError({ is_transient: true })).toBe(true);
    expect(retryableError({ code: 613 })).toBe(true);
    expect(retryableError({ code: 190 })).toBe(false);
  });
  it("checks the token without putting it in a URL", async () => {
    const urls: string[] = [];
    const ok = await tokenValid(
      opts(async (u) => (urls.push(u), Response.json({ id: "1784000000" }))),
    );
    expect(ok).toEqual({ valid: true, why: null });
    expect(urls[0]).not.toContain("TOKEN123");
    expect(urls[0]).not.toContain("input_token");
    const bad = await tokenValid(
      opts(async () =>
        Response.json(
          { error: { message: "expired", code: 190 } },
          { status: 400 },
        ),
      ),
    );
    expect(bad.valid).toBe(false);
    await expect(
      tokenValid(opts(async () => new Response("x", { status: 503 }))),
    ).rejects.toBeInstanceOf(GraphError);
  });
  it("pages through a post's comments", async () => {
    let n = 0;
    const list = await mediaComments(
      "M1",
      opts(async (u) => {
        n++;
        const after = new URL(u).searchParams.get("after");
        return Response.json(
          after
            ? { data: [{ id: "c2", text: "PARK" }] }
            : {
                data: [{ id: "c1", text: "hi" }],
                paging: {
                  cursors: { after: "X" },
                  next: "https://graph.facebook.com/next",
                },
              },
        );
      }),
    );
    expect(list.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(n).toBe(2);
  });
  it("sends a private reply the way Meta's doc shows, and keeps its ids", async () => {
    const seen: [string, RequestInit][] = [];
    const sent = await privateReply(
      "18139562827654945",
      "Here you go",
      opts(async (u, init) => {
        seen.push([u, init!]);
        return Response.json({ recipient_id: "526", message_id: "aWdfZ" });
      }),
    );
    expect(sent).toEqual({ recipientId: "526", messageId: "aWdfZ" });
    const [url, init] = seen[0];
    expect(init.method).toBe("POST");
    expect(url).toBe("https://graph.facebook.com/v23.0/1784000000/messages");
    const body = new URLSearchParams(String(init.body));
    expect([...body.keys()].sort()).toEqual(["message", "recipient"]);
    expect(JSON.parse(body.get("recipient")!)).toEqual({
      comment_id: "18139562827654945",
    });
    expect(JSON.parse(body.get("message")!)).toEqual({ text: "Here you go" });
    // An answer without ids is still a send, with nulls to show it.
    expect(
      await privateReply(
        "c",
        "t",
        opts(async () => Response.json({})),
      ),
    ).toEqual({ recipientId: null, messageId: null });
    // A Meta refusal throws (and is never retried by the caller).
    await expect(
      privateReply(
        "c",
        "t",
        opts(async () =>
          Response.json(
            { error: { message: "no", code: 10, error_subcode: 2534022 } },
            { status: 400 },
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: 10, subcode: 2534022 });
  });
  it("a Story-reply DM goes from the Page with messaging_type RESPONSE", async () => {
    const seen: [string, RequestInit][] = [];
    const sent = await sendMessage(
      "1234567890",
      "IGSID9",
      "hi",
      opts(async (u, init) => {
        seen.push([u, init!]);
        return Response.json({ recipient_id: "IGSID9", message_id: "m" });
      }),
    );
    expect(sent.messageId).toBe("m");
    expect(seen[0][0]).toBe(
      "https://graph.facebook.com/v23.0/1234567890/messages",
    );
    const body = new URLSearchParams(String(seen[0][1].body));
    expect(JSON.parse(body.get("recipient")!)).toEqual({ id: "IGSID9" });
    expect(body.get("messaging_type")).toBe("RESPONSE");
  });
});

describe("keyword DMs", () => {
  it("answers only a comment that is PARK, never ours", () => {
    expect(PARK_WORD.test("PARK")).toBe(true);
    expect(PARK_WORD.test(" park! ")).toBe(true);
    expect(PARK_WORD.test("park please!")).toBe(false);
    expect(PARK_WORD.test("Which park is this?")).toBe(false);
    expect(PARK_WORD.test("parking?")).toBe(false);
    expect(wantsLink({ id: "1", text: "Park", from: { id: "me" } }, "me")).toBe(
      false,
    );
    expect(
      wantsLink({ id: "1", text: "Park", from: { id: "you" } }, "me"),
    ).toBe(true);
  });
  it("answers PICK only as a fresh Story reply", () => {
    const now = new Date("2026-11-28T01:00:00Z");
    const m = {
      id: "m1",
      message: "pick",
      created_time: "2026-11-28T00:40:00Z",
      from: { id: "you" },
      story: { reply_to: { id: "s" } },
    };
    expect(PICK_REPLY.test("Pick!")).toBe(true);
    expect(wantsPick(m, new Set(["me"]), now)).toBe(true);
    expect(wantsPick({ ...m, story: undefined }, new Set(["me"]), now)).toBe(
      false,
    );
    expect(
      wantsPick({ ...m, message: "pick me up at 5" }, new Set(["me"]), now),
    ).toBe(false);
    expect(
      wantsPick(
        { ...m, created_time: "2026-11-26T00:00:00Z" },
        new Set(["me"]),
        now,
      ),
    ).toBe(false);
  });
  it("the DM is code-written and links to /social with its source", () => {
    expect(COPY.dm).toContain("https://parkroulette.quest/social?from=ig_dm");
  });
});

describe("signature traits lead the park post", () => {
  it("refuses an opening sentence without a profile trait or the park's name", async () => {
    const r = await validateParkPost(
      parkPost({
        story:
          "This week we're featuring Larkspur Park in Bend. It has three play zones for all abilities.",
      }),
      WEEK,
      ctx(),
    );
    expect(r.errors.join(" ")).toMatch(
      /first sentence opens the caption, so it must lead with one of the park's signature traits/,
    );
    const unnamed = await validateParkPost(
      parkPost({
        story:
          "This week's park is a Bend playground for all abilities. It has three play zones.",
      }),
      WEEK,
      ctx(),
    );
    expect(unnamed.errors.join(" ")).toMatch(
      /first sentence must name the park exactly as post_parks\[\]\.name has it \(Larkspur Park\)/,
    );
  });
  it("refuses generic phrases anywhere", async () => {
    const r = await validateParkPost(
      parkPost({
        story:
          "This week we're featuring Larkspur Park, a playground built for all abilities fans. Three play zones sit side by side.",
        who: "Something for everyone, fun for all ages.",
        bring: "Snacks: a great place for a picnic.",
      }),
      WEEK,
      ctx(),
    );
    const all = r.errors.join(" ");
    expect(all).toMatch(/built for \.\.\. fans/);
    expect(all).toMatch(/something for everyone/);
    expect(all).toMatch(/fun for all ages/);
    expect(all).toMatch(/great place/);
  });
  it("holds the story to a short paragraph that names the park first", async () => {
    const r = await validateParkPost(
      parkPost({
        story:
          "This week we're featuring Larkspur Park, a Bend playground for all abilities, with three zones and a trail and picnic tables and a lot more besides that. One. Two. Three. Four!",
        who: "Kids will love it!",
      }),
      WEEK,
      ctx(),
    );
    const all = r.errors.join(" ");
    expect(all).toMatch(/story: 5 sentences; 2 to 4/);
    expect(all).toMatch(/first sentence runs \d+ characters; 130 at most/);
    expect(all).toMatch(/runs \d+ words; keep each sentence to 22/);
    expect(all).toMatch(/"will love it"/);
    expect(all).toMatch(/2 exclamation points/);
  });
  it("refuses a story that says we visited, or names a feature the record lacks", async () => {
    const r = await validateParkPost(
      parkPost({
        story:
          "This week we're featuring Larkspur Park, a Bend playground for all abilities. We went last week and our kids loved the splash pad.",
      }),
      WEEK,
      ctx(),
    );
    const all = r.errors.join(" ");
    expect(all).toMatch(/never claims a visit/);
    expect(all).toMatch(/doesn't list a splash pad/);
  });
  it("grounds the story, who and bring: no other names, days, times, prices, hours, superlatives, safety or events", async () => {
    // The reviewer's six: each states something the park's record doesn't.
    const cases: [Partial<ParkPostDraft>, RegExp][] = [
      [
        { bring: "cocoa from Thump Coffee across the street" },
        /"Thump, Coffee" isn't the park, its town or in its traits/,
      ],
      [
        {
          story:
            "This week we're featuring Larkspur Park, a Bend playground for all abilities. Santa visits on Saturday at 10 am.",
        },
        /a day of the week, a time, an event isn't in the park's record/,
      ],
      [
        { who: "every family, since parking is free and it opens early" },
        /"free", hours isn't in the park's record/,
      ],
      [
        {
          story:
            "This week we're featuring Larkspur Park, a Bend playground for all abilities. It's the only one like it in Central Oregon.",
        },
        /a superlative/,
      ],
      [
        { who: "toddlers, since the whole space is safe for little ones" },
        /a safety promise/,
      ],
      [
        {
          story:
            "This week we're featuring Larkspur Park, a Bend playground for all abilities. Skate at the rink next door for $8 after.",
        },
        /a price, an event isn't in the park's record/,
      ],
    ];
    for (const [over, re] of cases) {
      const r = await validateParkPost(parkPost(over), WEEK, ctx());
      expect(r.errors.join(" "), JSON.stringify(over)).toMatch(re);
    }
    // Another park on the map, by name.
    const other = await validateParkPost(
      parkPost({
        story:
          "This week we're featuring Larkspur Park, a Bend playground for all abilities. It sits across town from Pine Nursery Park.",
      }),
      WEEK,
      ctx({
        parks: new Map([
          ["larkspur-park-bend", park()],
          [
            "pine-nursery-park-bend",
            park({ slug: "pine-nursery-park-bend", name: "Pine Nursery Park" }),
          ],
        ]),
      }),
    );
    expect(other.errors.join(" ")).toMatch(
      /names another place \(Pine Nursery Park\)/,
    );
    // The park's own words (its name, town and traits) and months are fine.
    const ok = await validateParkPost(
      parkPost({
        story:
          "This week we're featuring Larkspur Park, a Bend playground for all abilities. A cold December afternoon suits it.",
      }),
      WEEK,
      ctx(),
    );
    expect(ok.errors).toEqual([]);
  });
  it("never sends kids onto ice, and a splash pad is unbacked out of season", () => {
    for (const line of [
      "Skate on the pond after",
      "Walk on the ice by the creek",
      "The frozen pond is a sight",
    ])
      expect(
        textProblems(line, { month: 1, label: "story" }).join(" "),
        line,
      ).toMatch(/never send kids onto ice/);
    expect(
      textProblems("Bring skates for the rink-free hill", {
        month: 1,
        label: "x",
      }),
    ).toEqual([]);
    expect(
      unbackedClaims("Swimsuits for the splash pad", ["splash_pad"]),
    ).toEqual([]);
    expect(
      unbackedClaims("Swimsuits for the splash pad", ["splash_pad"], [], 7),
    ).toEqual([]);
    expect(
      unbackedClaims("Swimsuits for the splash pad", ["splash_pad"], [], 11),
    ).toEqual(["a splash pad"]);
  });
  it("refuses a park with fewer than 2 traits", async () => {
    const r = await validateParkPost(
      parkPost({
        park: "pine-nursery-park-bend",
        story:
          "This week we're featuring Pine Nursery Park, with its fishing pond and a playground by the water.",
      }),
      WEEK,
      ctx({ planParks: ["pine-nursery-park-bend"] }),
    );
    expect(r.errors.join(" ")).toMatch(
      /signature traits of 1 kind this month; a park post needs 2/,
    );
  });
  it("lets a verified trait of the right kind back a claim the feature list lacks", () => {
    const creek = trait("Shady spot on Ochoco Creek", "water", [
      "ochoco creek",
    ]);
    expect(unbackedClaims("Right by the creek", [])).toEqual(["water"]);
    expect(unbackedClaims("Right by the creek", [], [creek])).toEqual([]);
    // The wrong kind, or a nearby/history trait, backs nothing.
    expect(
      unbackedClaims(
        "Right by the creek",
        [],
        [
          { ...creek, kind: "nearby" },
          { ...creek, kind: "history" },
          { ...creek, kind: "view" },
        ],
      ),
    ).toEqual(["water"]);
  });
  it("Blakely: a Google trait never backs a fence, and no water trait means no creek", () => {
    const blakely = PROFILES_FIXTURE.get("blakely-park-bend")!.traits;
    const feats = ["restrooms", "sports_courts", "shade", "parking"];
    expect(unbackedClaims("Fully fenced for runners", feats, blakely)).toEqual([
      "a fence",
    ]);
    expect(unbackedClaims("Wade in the creek", feats, blakely)).toEqual([
      "water",
    ]);
    expect(unbackedClaims("Big shade trees", feats, blakely)).toEqual([]);
  });
  it("Harmon: a river trait doesn't back a pond", () => {
    const harmon = PROFILES_FIXTURE.get("harmon-park-bend")!.traits;
    expect(unbackedClaims("Feed the ducks at the pond", [], harmon)).toEqual([
      "water",
    ]);
    expect(unbackedClaims("A gate down to the river", [], harmon)).toEqual([]);
  });
  it("a Google trait never backs accessible play either", () => {
    const g = trait(
      "An inclusive playground",
      "all_abilities",
      ["inclusive"],
      "google_places",
    );
    expect(unbackedClaims("Inclusive play for every kid", [], [g])).toEqual([
      "accessible play",
    ]);
    expect(
      unbackedClaims(
        "Inclusive play for every kid",
        [],
        [{ ...g, source: "official" }],
      ),
    ).toEqual([]);
  });
  it("a splash claim matches spray park and sprayground", () => {
    expect(unbackedClaims("A sprayground for summer", [])).toEqual([
      "a splash pad",
    ]);
    expect(unbackedClaims("The spray park opens soon", [])).toEqual([
      "a splash pad",
    ]);
  });
});

describe("Unpack event chips (lesson 50)", () => {
  it("print every showing that day, a start alone as a time, and the venue", async () => {
    const { eventDayChip, showTimes, venueChip } = await import("./roundup");
    expect(showTimes(["18:00", "13:30"])).toBe("1:30 and 6 pm");
    expect(showTimes(["12:00", "15:30"])).toBe("noon and 3:30 pm");
    expect(showTimes(["11:00", "13:30"])).toBe("11 am and 1:30 pm");
    expect(showTimes(["10:00", "11:30", "13:00"])).toBe(
      "10, 11:30 am and 1 pm",
    );
    const nut = [
      { day: "2026-11-28", start: "13:30" },
      { day: "2026-11-28", start: "18:00" },
      { day: "2026-11-29", start: "12:00" },
      { day: "2026-11-29", start: "15:30" },
    ];
    expect(eventDayChip(nut, "2026-11-28")).toBe("Sat, Nov 28 · 1:30 and 6 pm");
    expect(eventDayChip(nut, "2026-11-29")).toBe(
      "Sun, Nov 29 · noon and 3:30 pm",
    );
    expect(
      eventDayChip([{ day: "2026-11-28", start: "13:30" }], "2026-11-28"),
    ).toBe("Sat, Nov 28 · 1:30 pm");
    expect(
      eventDayChip(
        [{ day: "2026-11-27", start: "13:00", end: "15:00" }],
        "2026-11-27",
      ),
    ).toBe("Fri, Nov 27 · 1 pm to 3 pm");
    expect(venueChip("Tower Theatre", "Bend")).toBe("Tower Theatre, Bend");
    expect(venueChip("Redmond Library", "Redmond")).toBe("Redmond Library");
    expect(venueChip("Old Mill District West Event Lawn", "Bend")).toBe(
      "Old Mill District West Event Lawn, Bend",
    );
    expect(
      venueChip("Deschutes County Fair & Expo Center Hall", "Redmond"),
    ).toBe("Deschutes County Fair & Expo Center Hall");
  });

  it("an event slide names the venue on its line and every showing in its chip", async () => {
    const nut = event({
      title: "The Nutcracker",
      dates: [
        { day: "2026-11-28", start: "13:30" },
        { day: "2026-11-28", start: "18:00" },
        { day: "2026-11-29", start: "12:00" },
      ],
      venue: { name: "Tower Theatre", town: "Bend" },
      what: "A holiday ballet with dancing toy soldiers, snow and a sugar plum fairy.",
    });
    const items = unpack().items.map((i) =>
      i.ref.startsWith("event:")
        ? {
            ref: "event:no-school-open-rec-swim@2026-11-28",
            what: "A holiday ballet with dancing toy soldiers and snow.",
          }
        : i.ref.startsWith("venue:")
          ? { ...i, holiday_evidence: HDM_EVIDENCE }
          : i,
    );
    const r = await validateUnpack(
      unpack({ items }),
      WEEK,
      ctx({
        events: new Map([["no-school-open-rec-swim", nut]]),
        evidence: async () => true,
      }),
    );
    const slide = r.spec?.slides.find(
      (x) => x.t === "item" && x.name === "The Nutcracker",
    );
    expect(slide).toMatchObject({
      facts: ["Sat, Nov 28 · 1:30 and 6 pm", "$4 kids"],
      place: "At Tower Theatre, Bend",
    });
    expect(JSON.stringify(r.spec)).not.toMatch(/Start time/);
  });

  it("the Sunday writer picks the park from the plan it fetches after the photo checks (lessons 48, 52)", async () => {
    const { readFileSync } = await import("node:fs");
    const cmd = readFileSync(".claude/commands/social-week.md", "utf8");
    const photo = cmd.slice(cmd.indexOf("## 2."), cmd.indexOf("## 3."));
    expect(photo).toMatch(
      /Then fetch the plan again:\*\* `GET https:\/\/parkroulette\.quest\/api\/social\/plan\?week_of=/,
    );
    const monday = cmd.slice(cmd.indexOf("## 3."), cmd.indexOf("## 4."));
    expect(monday).toMatch(/from the plan you fetched after the photo checks/);
    expect(cmd).not.toMatch(/from the plan fetched in step 1/);
  });
});

describe("where and who on event slides (James, Nov 22)", () => {
  it("hostOf names the organizer only when it isn't the venue", async () => {
    const { hostOf } = await import("./compose");
    expect(
      hostOf("Central Library", { name: "Deschutes Public Library" }),
    ).toBe("Deschutes Public Library");
    expect(hostOf("The Pavilion", { name: "The Pavilion" })).toBeNull();
    expect(
      hostOf("Crook County Library", { name: "Crook County Library" }),
    ).toBeNull();
    expect(
      hostOf("Old Mill District West Event Lawn", {
        name: "Old Mill District",
      }),
    ).toBeNull();
    expect(hostOf("Tower Theatre", undefined)).toBeNull();
    // Its own trailing period goes (the caption adds one).
    expect(hostOf("Tower Theatre", { name: "Foo Inc." })).toBe("Foo Inc");
  });

  it("an Unpack event item shows its venue and organizer, on the slide and in the caption", async () => {
    const swim = event({
      venue: { name: "Central Library", town: "Bend" },
      organizer: {
        name: "Deschutes Public Library",
        url: "https://www.deschuteslibrary.org",
      },
    });
    const items = unpack().items.map((i) =>
      i.ref.startsWith("venue:") ? { ...i, holiday_evidence: HDM_EVIDENCE } : i,
    );
    const r = await validateUnpack(
      unpack({ items }),
      WEEK,
      ctx({
        events: new Map([["no-school-open-rec-swim", swim]]),
        evidence: async () => true,
      }),
    );
    const slide = r.spec?.slides.find(
      (x) => x.t === "item" && x.name === "No School Open Rec Swim",
    );
    expect(slide).toMatchObject({
      place: "At Central Library, Bend",
      host: "Deschutes Public Library",
    });
    expect(r.spec?.caption).toContain(
      "At Central Library, Bend. Hosted by Deschutes Public Library.",
    );
    const { slideAlt } = await import("./compose");
    expect(slideAlt(slide!)).toContain("Hosted by Deschutes Public Library.");
  });

  it("an organizer that names a newsletter cuts the item: it's never printed", async () => {
    const swim = event({
      organizer: { name: "Bend Family Loop", url: "https://example.org" },
    });
    const items = unpack().items.map((i) =>
      i.ref.startsWith("venue:") ? { ...i, holiday_evidence: HDM_EVIDENCE } : i,
    );
    const r = await validateUnpack(
      unpack({ items }),
      WEEK,
      ctx({
        events: new Map([["no-school-open-rec-swim", swim]]),
        evidence: async () => true,
      }),
    );
    expect(JSON.stringify(r.spec ?? {})).not.toMatch(/Family Loop/);
    expect(r.cut.join(" ")).toMatch(/newsletter/);
  });

  it("the venue and host give way before anything overflows the item slide", async () => {
    const { itemWhere } = await import("./compose");
    const { itemFit } = await import("@/components/social/fit");
    const base = {
      name: "Creativebug Workshop: Gifts, Wrapping Paper, and Cards!",
      what: "Kids make handmade gifts, wrapping paper and greeting cards at a holiday craft workshop.",
      facts: [
        "Mon, Nov 23 · 10:30 am to 12:30 pm",
        "Ages 6 and up",
        "$12.50 to $20 kids",
      ],
    };
    // Real lengths fit with both lines.
    expect(
      itemWhere(base, "At Central Library, Bend", "Deschutes Public Library"),
    ).toEqual({
      place: "At Central Library, Bend",
      host: "Deschutes Public Library",
    });
    // A pathological host goes first, then the venue; whatever's left fits.
    const huge = "Mmmmmmm ".repeat(30).trim();
    const w = itemWhere(base, "At Central Library, Bend", huge);
    expect(w.host ?? null).toBeNull();
    expect(itemFit({ ...base, ...w }).fits).toBe(true);
    expect(itemWhere(base, `At ${huge}`, huge)).toEqual({});
  });

  it("when the venue line can't fit, the venue goes back in as a chip", async () => {
    const { composeUnpack } = await import("./compose");
    const huge = "Mmmmmmm ".repeat(30).trim();
    const spec = composeUnpack(
      unpack(),
      [
        {
          ref: "event:x@2026-11-27",
          name: "Creativebug Workshop: Gifts, Wrapping Paper, and Cards!",
          what: "Kids make handmade gifts, wrapping paper and greeting cards at a holiday craft workshop.",
          icon: "calendar",
          facts: ["Fri, Nov 27 · 1 pm to 3 pm"],
          place: `At ${huge}`,
          host: null,
          venueChip: "Central Library, Bend",
        },
      ],
      { parks: [], events: [], venues: [], issue: null },
      false,
    );
    const item = spec.slides.find((x) => x.t === "item");
    expect(item).toMatchObject({
      facts: ["Fri, Nov 27 · 1 pm to 3 pm", "Central Library, Bend"],
    });
    expect(item && "place" in item ? item.place : undefined).toBeUndefined();
  });
});
