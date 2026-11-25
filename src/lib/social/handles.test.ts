import { describe, expect, it, vi } from "vitest";
import {
  composeEventsWeek,
  composeParkPost,
  composeTeaser,
  composeUnpack,
  type ParkInfo,
  type WeekEvent,
} from "./compose";
import type { DiscoveredAccount } from "./graph";
import {
  backLink,
  sameName,
  cachedDiscover,
  captionMentions,
  competitor,
  finalizeMentions,
  hostDomain,
  igHandleFromUrl,
  igLinksIn,
  MAX_TAGS,
  mentionLines,
  mentionProblems,
  noAt,
  noSuchUser,
  postHandles,
  parkTag,
  publishCaption,
  recheckTags,
  REGISTRY,
  type Registry,
  registrableDomain,
  registryHandles,
  siteDomain,
  type Tag,
  tagFor,
  verifyPair,
  withoutMentions,
} from "./handles";
import type { ParkPostDraft, UnpackDraft } from "./model";
import { fitRoundup, withHostTags } from "./roundup";
import type { Issue } from "@/lib/news/issue";

const acct = (o: Partial<DiscoveredAccount> = {}): DiscoveredAccount => ({
  id: "111",
  username: "bendparks",
  name: "Bend Parks and Recreation",
  website: "https://www.bendparksandrec.org/",
  biography: "Three recreation centers and 86 parks.",
  followers: 12000,
  mediaCount: 900,
  ...o,
});

// --- Domains ------------------------------------------------------------------

describe("domains", () => {
  it("treats www and subdomains as the same site", () => {
    expect(registrableDomain("www.bendparksandrec.org")).toBe(
      "bendparksandrec.org",
    );
    expect(registrableDomain("WWW.Example.COM.")).toBe("example.com");
    expect(registrableDomain("events.bendparksandrec.org")).toBe(
      "bendparksandrec.org",
    );
    expect(siteDomain("https://shop.towertheatre.org/x?y=1")).toBe(
      "towertheatre.org",
    );
    expect(siteDomain("towertheatre.org/events")).toBe("towertheatre.org");
  });
  it("keeps separate owners apart under shared suffixes", () => {
    // A city under its state's locality domain, and one state agency.
    expect(registrableDomain("ci.madras.or.us")).toBe("ci.madras.or.us");
    expect(registrableDomain("www.ci.sisters.or.us")).toBe("ci.sisters.or.us");
    expect(registrableDomain("stateparks.oregon.gov")).toBe(
      "stateparks.oregon.gov",
    );
    expect(siteDomain("https://stateparks.oregon.gov/")).not.toBe(
      siteDomain("https://www.oregon.gov/odot"),
    );
    // One newsletter per beehiiv subdomain.
    expect(registrableDomain("bendbuzz.beehiiv.com")).toBe(
      "bendbuzz.beehiiv.com",
    );
  });
  it("isn't a web link", () => {
    expect(siteDomain("mailto:hello@x.org")).toBeNull();
    expect(siteDomain("issue:12")).toBeNull();
    expect(siteDomain("")).toBeNull();
    expect(siteDomain(null)).toBeNull();
  });
  it("finds an event's host from its organizer only, never a listing", () => {
    expect(
      hostDomain({ organizer: { url: "https://www.deschuteslibrary.org/" } }),
    ).toBe("deschuteslibrary.org");
    // No named organizer: no host (the event's page never names one).
    expect(hostDomain({})).toBeNull();
    expect(hostDomain({ organizer: null })).toBeNull();
    for (const u of [
      "https://www.instagram.com/x",
      "https://runsignup.com/Race/1",
      "https://www.oldmilldistrict.com/",
      "https://www.downtownbend.org/",
      "https://www.towertheatre.org/",
      "https://bendbuzz.com/",
    ])
      expect(hostDomain({ organizer: { url: u } })).toBeNull();
  });
});

// --- Forward links --------------------------------------------------------------

describe("forward links (the site names the handle)", () => {
  it("reads profile links, never posts or share links", () => {
    expect(igHandleFromUrl("https://www.instagram.com/BendParks/")).toBe(
      "bendparks",
    );
    expect(igHandleFromUrl("https://instagram.com/bendparks?hl=en")).toBe(
      "bendparks",
    );
    expect(igHandleFromUrl("//instagram.com/bendparks")).toBe("bendparks");
    expect(igHandleFromUrl("https://m.instagram.com/bendparks/reels/")).toBe(
      "bendparks",
    );
    expect(igHandleFromUrl("https://www.instagram.com/p/Cx1/")).toBeNull();
    expect(igHandleFromUrl("https://www.instagram.com/reel/Cx1/")).toBeNull();
    expect(igHandleFromUrl("https://www.instagram.com/")).toBeNull();
    expect(igHandleFromUrl("https://www.instagram.com/explore/")).toBeNull();
    expect(igHandleFromUrl("https://www.instagram.com/sharer.php")).toBeNull();
    expect(igHandleFromUrl("https://notinstagram.com/bendparks")).toBeNull();
    expect(igHandleFromUrl("https://www.instagram.com/a/b/c")).toBeNull();
  });
  it("reads hrefs first, then the page's own data (sameAs, escaped JSON)", () => {
    const html = `
      <a href="https://www.instagram.com/p/xyz/">a post</a>
      <a href='https://www.instagram.com/thecircuitgym_bend/'>IG</a>
      <script type="application/ld+json">{"sameAs":["https://www.facebook.com/x","https://www.instagram.com/sunriverresort/"]}</script>
      <script>{\\"url\\":\\"https:\\/\\/www.instagram.com\\/escaped.one\\/\\"}</script>
      <a href="https://www.instagram.com/thecircuitgym_bend">again</a>`;
    expect(igLinksIn(html)).toEqual([
      "thecircuitgym_bend",
      "sunriverresort",
      "escaped.one",
    ]);
    expect(igLinksIn("<p>Follow us @bendparks</p>")).toEqual([]);
  });
});

// --- Back links and the two-way verdict -------------------------------------------

describe("name match (link pages that can't name a site)", () => {
  const library = acct({
    id: "17841400130313421",
    username: "deschuteslibrary",
    name: "Deschutes Public Library",
    website: "https://linkinprofile.com/deschuteslibrary",
    biography: "Join us for the unveiling of the 2027 A Novel Idea selections.",
  });

  it("proves Deschutes Public Library: site links it, exact name, link-in-bio website", () => {
    expect(
      backLink(library, "deschuteslibrary.org", [], "Deschutes Public Library"),
    ).toBe("name: Deschutes Public Library");
    expect(
      verifyPair({
        domain: "deschuteslibrary.org",
        handle: "deschuteslibrary",
        forwardHandles: ["deschuteslibrary"],
        account: library,
        orgName: "Deschutes Public Library",
      }),
    ).toEqual({ ok: true, back: "name: Deschutes Public Library" });
  });

  it("still needs the site's own link", () => {
    expect(
      verifyPair({
        domain: "deschuteslibrary.org",
        handle: "deschuteslibrary",
        forwardHandles: [],
        account: library,
        orgName: "Deschutes Public Library",
      }).ok,
    ).toBe(false);
  });

  it("never matches a partial or different name", () => {
    for (const org of [
      "Deschutes Library",
      "Deschutes Public Library Foundation",
      "Crook County Library",
    ])
      expect(backLink(library, "deschuteslibrary.org", [], org)).toBeNull();
    expect(backLink(library, "deschuteslibrary.org")).toBeNull();
  });

  it("never matches when the account's website is some other real site", () => {
    expect(
      backLink(
        { ...library, website: "https://example.com/" },
        "deschuteslibrary.org",
        [],
        "Deschutes Public Library",
      ),
    ).toBeNull();
  });

  it("compares names loosely on case, punctuation and '&' only", () => {
    expect(sameName("Sun Mountain Fun Center", "sun mountain fun-center")).toBe(
      true,
    );
    expect(sameName("Parks & Rec", "Parks and Rec")).toBe(true);
    expect(sameName("Bend", "Bend")).toBe(false);
  });
});

describe("back links (the account names the site)", () => {
  it("matches the website field on the same registrable domain", () => {
    expect(backLink(acct(), "bendparksandrec.org")).toBe(
      "website: https://www.bendparksandrec.org/",
    );
    expect(
      backLink(
        acct({ website: "https://shop.bendparksandrec.org/gift" }),
        "bendparksandrec.org",
      ),
    ).toMatch(/^website:/);
    expect(
      backLink(
        acct({ website: "https://bendparks.com" }),
        "bendparksandrec.org",
      ),
    ).toBeNull();
  });
  it("matches a link written in the bio, never an email address", () => {
    expect(
      backLink(
        acct({ website: null, biography: "Parks! bendparksandrec.org/play" }),
        "bendparksandrec.org",
      ),
    ).toBe("bio: bendparksandrec.org/play");
    expect(
      backLink(
        acct({ website: null, biography: "Write info@bendparksandrec.org" }),
        "bendparksandrec.org",
      ),
    ).toBeNull();
  });
  it("follows a link-in-bio page only when its links were read", () => {
    const tree = acct({
      website: "https://linktr.ee/bendparks",
      biography: "",
    });
    expect(backLink(tree, "bendparksandrec.org")).toBeNull();
    expect(
      backLink(tree, "bendparksandrec.org", [
        "https://example.com",
        "https://www.bendparksandrec.org/events",
      ]),
    ).toBe(
      "website: https://linktr.ee/bendparks -> https://www.bendparksandrec.org/events",
    );
    // A page of links on a site that isn't a link-in-bio service isn't read.
    expect(
      backLink(
        acct({ website: "https://other.com", biography: "" }),
        "bendparksandrec.org",
        ["https://bendparksandrec.org"],
      ),
    ).toBeNull();
  });
  it("needs both directions, and never a competitor", () => {
    const base = {
      domain: "bendparksandrec.org",
      handle: "bendparks",
      forwardHandles: ["bendparks"],
      account: acct(),
    };
    expect(verifyPair(base)).toEqual({
      ok: true,
      back: "website: https://www.bendparksandrec.org/",
    });
    expect(verifyPair({ ...base, forwardHandles: ["other"] })).toMatchObject({
      ok: false,
      why: expect.stringMatching(/doesn't link/),
    });
    expect(verifyPair({ ...base, account: null })).toMatchObject({
      ok: false,
      why: expect.stringMatching(/business or creator/),
    });
    expect(
      verifyPair({ ...base, account: acct({ website: "https://x.com" }) }),
    ).toMatchObject({ ok: false, why: expect.stringMatching(/don't name/) });
    expect(
      verifyPair({ ...base, account: acct({ username: "someoneelse" }) }),
    ).toMatchObject({ ok: false });
    // Competitors: by domain, by handle, by the account's own website.
    expect(
      verifyPair({
        ...base,
        domain: "bendbuzz.com",
        account: acct({ website: "https://bendbuzz.com" }),
      }),
    ).toMatchObject({ ok: false, why: "a competitor newsletter" });
    expect(
      verifyPair({
        ...base,
        handle: "bend_family_loop",
        forwardHandles: ["bend_family_loop"],
        account: acct({ username: "bend_family_loop" }),
      }),
    ).toMatchObject({ ok: false, why: "a competitor newsletter" });
    expect(
      verifyPair({
        ...base,
        account: acct({
          biography: "Partners with bendfamilyloop.beehiiv.com",
        }),
      }),
    ).toMatchObject({ ok: false, why: expect.stringMatching(/competitor/) });
    expect(competitor("The Bend Buzz")).toBe(true);
    expect(competitor("https://www.bendfamilyloop.com/")).toBe(true);
    expect(competitor("Bend Park & Recreation District")).toBe(false);
  });
});

// --- The committed registry -------------------------------------------------------

describe("the committed registry", () => {
  it("holds only proven, well-formed entries keyed by registrable domain", () => {
    const entries = Object.entries(REGISTRY.entries);
    expect(entries.length).toBeGreaterThan(0);
    for (const [domain, e] of entries) {
      expect(registrableDomain(domain)).toBe(domain);
      expect(e.handle).toMatch(/^[A-Za-z0-9._]{1,30}$/);
      expect(e.igId).toMatch(/^\d+$/);
      expect(siteDomain(e.forward)).toBe(domain);
      expect(e.back).toMatch(/^(website|bio|name): /);
      // A name match is the organization's own name, exactly.
      if (e.back.startsWith("name: ")) expect(e.back).toBe(`name: ${e.org}`);
      expect(e.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(competitor(domain, e.handle, e.name, e.back)).toBe(false);
    }
    const ids = entries.map(([, e]) => e.igId);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("tags a park's operator from its own list", () => {
    expect(parkTag("al-moody-park-bend")).toMatchObject({
      domain: "bendparksandrec.org",
      handle: "bendparks",
      role: "park",
    });
    expect(parkTag("no-such-park")).toBeNull();
  });
  it("never tags the excluded domains", () => {
    const reg: Registry = {
      entries: {
        "bevelbeer.com": {
          ...REGISTRY.entries["bendparksandrec.org"],
          handle: "bevelbeer",
        },
      },
    };
    expect(tagFor("bevelbeer.com", "host", reg)).toBeNull();
    expect(registryHandles(reg)).toEqual([]);
  });
});

// --- Captions ------------------------------------------------------------------------

const tag = (n: number | string, role: Tag["role"] = "host"): Tag => ({
  domain: `host${n}.org`,
  handle: `host${n}`,
  igId: `9${n}`,
  role,
});

const week = (i: number, t: Tag | null): WeekEvent => ({
  slug: `e${i}`,
  day: `2026-11-${25 + (i % 5)}`,
  start: "10:00",
  title: `Story Time ${i}`,
  weekday: "Wed",
  date: `Nov ${25 + (i % 5)}`,
  time: "10 to 11 am",
  venue: `Library ${i}`,
  town: "Bend",
  ages: ["Ages 2 to 5"],
  desc: null,
  cost: "Free",
  host: null,
  also: null,
  tag: t,
});
const win = {
  label: "Tue, Nov 24 to Mon, Nov 30",
  caption: "Nov 24 to 30",
  firstDay: "2026-11-24",
};

describe("the roundup's host tags", () => {
  it("tags hosts in event order, once each, on Instagram only", () => {
    const spec = composeEventsWeek(
      [week(0, tag(2)), week(1, null), week(2, tag(1)), week(3, tag(2))],
      win,
      false,
    );
    const lines = spec.caption!.split("\n");
    expect(lines).toContain("Hosts this week: @host2 @host1");
    // After the hosts' line, before our closing.
    const at = lines.indexOf("Hosts this week: @host2 @host1");
    expect(lines[at - 1]).toBe("");
    expect(lines[at + 1]).toBe("");
    expect(lines[at + 2]).toMatch(/^Every Thursday/);
    expect(spec.tags?.map((t) => t.handle)).toEqual(["host2", "host1"]);
    // Facebook: no handles, no tag line, no stray blank lines.
    expect(spec.fbCaption).not.toMatch(/@/);
    expect(spec.fbCaption).not.toMatch(/Hosts this week/);
    expect(spec.fbCaption).not.toMatch(/\n\n\n/);
  });
  it("caps the line at 10 handles", () => {
    const evs = Array.from({ length: 14 }, (_, i) => week(i, tag(i)));
    const spec = composeEventsWeek(evs, win, false);
    const line = spec
      .caption!.split("\n")
      .find((l) => l.startsWith("Hosts this week:"))!;
    expect(line.match(/@/g)).toHaveLength(MAX_TAGS);
    expect(spec.tags).toHaveLength(MAX_TAGS);
  });
  it("has no line when no host is verified", () => {
    const spec = composeEventsWeek([week(0, null), week(1, null)], win, false);
    expect(spec.caption).not.toMatch(/Hosts this week|@/);
    expect(spec.tags).toBeUndefined();
  });
  it("drops the tags before it drops an event for length", () => {
    const evs = Array.from({ length: 6 }, (_, i) => week(i, tag(i)));
    const full = composeEventsWeek(evs, win, false).caption!.length;
    const fit = fitRoundup(evs, win, false, full - 10);
    if ("skip" in fit) throw new Error(fit.skip);
    expect(fit.events).toHaveLength(6);
    expect(fit.cut).toContain("host tags cut for caption length");
    expect(fit.spec.caption).not.toMatch(/@/);
  });
  it("takes tags from the registry by organizer domain", () => {
    const reg: Registry = {
      entries: {
        "host1.org": {
          handle: "host1",
          igId: "91",
          org: "Host One",
          name: null,
          followers: 1,
          forward: "https://host1.org/",
          back: "website: https://host1.org",
          verifiedOn: "2026-11-25",
        },
      },
    };
    const rows = new Map([
      [
        "e0",
        {
          data: {
            url: "https://x.com/e",
            organizer: { name: "H", url: "https://www.host1.org/" },
          },
        },
      ],
      ["e1", { data: { url: "https://www.instagram.com/p/1/" } }],
      // The event's page is the host's site, but no organizer is named.
      ["e2", { data: { url: "https://www.host1.org/event" } }],
    ]) as unknown as Parameters<typeof withHostTags>[1];
    const out = withHostTags(
      [week(0, null), week(1, null), week(2, null)],
      rows,
      reg,
    );
    expect(out[2].tag).toBeNull();
    expect(out[0].tag).toMatchObject({ handle: "host1", domain: "host1.org" });
    expect(out[1].tag).toBeNull();
  });
});

const park: ParkInfo = {
  slug: "al-moody-park-bend",
  name: "Al Moody Park",
  city: "Bend",
  address: "2225 NE Daggett Ln, Bend, OR 97701",
  status: "active",
  approved: true,
  play: "playground",
  features: [],
};
const draft: ParkPostDraft = {
  type: "park_post",
  park: park.slug,
  story: "Al Moody Park has a tree-house play garden.",
  who: "preschoolers",
  bring: "mittens",
  hashtags: ["#BendOregon"],
} as ParkPostDraft;

describe("the park's operator", () => {
  it("credits the operator once, under the photo credit, Instagram only", () => {
    const spec = composeParkPost(
      draft,
      park,
      {
        src: "s",
        sha256: "h",
        credit: "Photo: Bend Park & Recreation District",
      },
      false,
      [tag("x", "park"), tag("y", "park")],
    );
    const lines = spec.caption!.split("\n");
    const credit = lines.indexOf("Photo: Bend Park & Recreation District");
    expect(lines[credit + 1]).toBe("Park by @hostx");
    expect(spec.caption!.match(/@/g)).toHaveLength(1);
    expect(spec.fbCaption).toContain("Photo: Bend Park & Recreation District");
    expect(spec.fbCaption).not.toMatch(/@|Park by/);
    expect(spec.tags).toEqual([tag("x", "park")]);
  });
  it("says nothing without a verified operator", () => {
    const spec = composeParkPost(draft, park, null, false);
    expect(spec.caption).not.toMatch(/Park by|@/);
    expect(spec.tags).toBeUndefined();
  });
  it("tags the teaser's featured park too", () => {
    const issue = {
      issue_date: "2026-11-26",
      preview: "A sunny weekend.",
      wheel_pick: { park: park.slug, why_now: "The sled hill is open." },
      weekend_ahead: { days: [] },
    } as unknown as Issue;
    const spec = composeTeaser(issue, park, false, [tag("x", "park")]);
    expect(spec.caption).toMatch(
      /This week's pick is Al Moody Park in Bend\. The sled hill is open\.\nPark by @hostx\n/,
    );
    expect(spec.fbCaption).not.toMatch(/@/);
  });
  it("lists the Unpack items' accounts on one line", () => {
    const d = {
      type: "unpack",
      headline: "Five warm plans for a cold week",
      highlight: "warm",
      items: [],
      hashtags: [],
    } as unknown as UnpackDraft;
    const item = (n: string) => ({
      ref: `venue:${n}`,
      name: n,
      what: "Kids climb.",
      icon: "home" as const,
      facts: [],
    });
    const spec = composeUnpack(
      d,
      [item("a"), item("b")],
      { parks: [], events: [], venues: [], issue: null },
      false,
      [tag(1, "place"), tag(2, "park"), tag(1, "host")],
    );
    expect(spec.caption).toContain("On this list: @host1 @host2");
    expect(spec.fbCaption).not.toMatch(/@/);
  });
});

// --- Validation ------------------------------------------------------------------------

describe("validate: an @ only in our tag line, with verified handles", () => {
  it("rejects a tag-line handle that isn't allowed", () => {
    expect(
      mentionProblems("Hosts this week: @bendparks", ["bendparks"]),
    ).toEqual([]);
    expect(mentionProblems("Park by @BendParks", ["bendparks"])).toEqual([]);
    expect(
      mentionProblems("Hosts this week: @bendparks @madeup", ["bendparks"])[0],
    ).toMatch(/@madeup, which isn't a verified host handle/);
    expect(captionMentions("a @x.y. and @z")).toEqual(["x.y", "z"]);
  });
  it("rejects any @ in the words, even a registry handle", () => {
    expect(
      mentionProblems("Thanks @bendparks for the sled hill.", ["bendparks"])[0],
    ).toMatch(/An @ in the post's words \(@bendparks\)/);
    // An email address isn't a mention.
    expect(mentionProblems("hello@parkroulette.quest", [])).toEqual([]);
  });
  it("rejects more than 10, and the 11th unverified one too", () => {
    const ok = Array.from({ length: 10 }, (_, i) => `h${i}`);
    const line = `Hosts this week: ${[...ok, "stranger"].map((h) => `@${h}`).join(" ")}`;
    const p = mentionProblems(line, ok);
    expect(p).toEqual([
      expect.stringMatching(/@stranger, which isn't a verified/),
      expect.stringMatching(/more than 10/),
    ]);
  });
  it("takes a post's own verified tags as the allowed list", () => {
    expect(
      postHandles({
        tags: [
          {
            domain: "bendparksandrec.org",
            handle: "BendParks",
            igId: "1",
            role: "park",
          },
        ],
      }),
    ).toEqual(["bendparks"]);
    // A tag whose handle isn't in the registry never counts.
    expect(postHandles({ tags: [tag(1)] })).toEqual([]);
    expect(postHandles({})).toEqual([]);
  });
});

describe("code's words never tag anyone", () => {
  it("rewrites @ as at, and drops email addresses", () => {
    expect(noAt("Storytime @10am")).toBe("Storytime at 10am");
    expect(noAt("Teen Night @TheGrove")).toBe("Teen Night at TheGrove");
    expect(noAt("@bendparks open house")).toBe("at bendparks open house");
    expect(noAt("RSVP to kids@library.org, please")).toBe("RSVP to, please");
    expect(noAt("No at sign here")).toBe("No at sign here");
    expect(noAt(null)).toBeNull();
  });
  it("an event titled with an @ still makes a roundup that validates", () => {
    const evs = [
      { ...week(0, null), title: "Storytime @10am" },
      {
        ...week(1, null),
        title: "Teen Night @TheGrove",
        host: "Ask@library.org",
      },
      { ...week(2, tag(1)), venue: "Library @bendparks" },
      week(3, null),
    ];
    const spec = composeEventsWeek(evs, win, false);
    expect(spec.caption).toContain("Storytime at 10am");
    expect(spec.caption).toContain("Teen Night at TheGrove");
    expect(spec.caption).toContain("Library at bendparks");
    expect(mentionProblems(spec.caption, ["host1"])).toEqual([]);
    const slide = spec.slides.find((x) => x.t === "event" && x.n === 1);
    expect(slide).toMatchObject({ title: "Storytime at 10am" });
  });
  it("the teaser and park post clean the issue's and park's words", () => {
    const issue = {
      issue_date: "2026-11-26",
      preview: "Snow on Saturday @ the parks.",
      wheel_pick: {
        park: park.slug,
        why_now: "Ask @bendparks about the hill.",
      },
      weekend_ahead: { days: [] },
    } as unknown as Issue;
    const t = composeTeaser(issue, park, false);
    expect(t.caption).not.toMatch(/@/);
    const pp = composeParkPost(
      draft,
      { ...park, name: "Al @Moody Park" },
      null,
      false,
    );
    expect(pp.caption).not.toMatch(/@/);
  });
});

// --- The re-check right before publishing ---------------------------------------------

const reg: Registry = {
  entries: {
    "bendparksandrec.org": {
      handle: "bendparks",
      igId: "111",
      org: "BPRD",
      name: null,
      followers: 1,
      forward: "https://www.bendparksandrec.org/",
      back: "website: https://www.bendparksandrec.org/",
      verifiedOn: "2026-11-25",
    },
    "towertheatre.org": {
      handle: "towertheatrebend",
      igId: "222",
      org: "Tower",
      name: null,
      followers: 1,
      forward: "https://www.towertheatre.org/",
      back: "website: https://www.towertheatre.org/",
      verifiedOn: "2026-11-25",
    },
  },
};
const bprd: Tag = {
  domain: "bendparksandrec.org",
  handle: "bendparks",
  igId: "111",
  role: "host",
};
const tower: Tag = {
  domain: "towertheatre.org",
  handle: "towertheatrebend",
  igId: "222",
  role: "host",
};
const tower0 = acct({
  id: "222",
  username: "towertheatrebend",
  website: "https://www.towertheatre.org/",
});

/** Meta's "no such user" (Business Discovery, code 110 / 2207013). */
const missing = () =>
  Object.assign(new Error("Meta said 400: Invalid user id"), {
    code: 110,
    subcode: 2207013,
  });

describe("recheckTags", () => {
  it("keeps an account with the same id and username", async () => {
    const r = await recheckTags([bprd, tower], {
      discover: async (h) => (h === "bendparks" ? acct() : tower0),
      registry: reg,
    });
    expect(r.kept.map((t) => t.handle)).toEqual([
      "bendparks",
      "towertheatrebend",
    ]);
    expect(r.dropped).toEqual([]);
  });
  it("drops an account that's gone, and on any API error, with no rename hunt", async () => {
    const forwardHandles = vi.fn(async () => ["bendparksrec"]);
    const r = await recheckTags([bprd, tower], {
      discover: async (h) => {
        if (h === "bendparks") throw missing();
        throw Object.assign(new Error("Meta said 400: rate"), {
          code: 4,
          subcode: null,
        });
      },
      forwardHandles: async (d) =>
        d === "towertheatre.org" ? forwardHandles() : [],
      registry: reg,
    });
    expect(r.kept).toEqual([]);
    expect(r.dropped.map((d) => d.why)).toEqual([
      "@bendparks can't be found (Business Discovery)",
      "can't check it now (Meta said 400: rate)",
    ]);
    // A rate limit never sends us to the organization's site.
    expect(forwardHandles).not.toHaveBeenCalled();
    const net = await recheckTags([bprd], {
      discover: async () => {
        throw new Error("Meta didn't answer (TimeoutError)");
      },
      forwardHandles,
      registry: reg,
    });
    expect(net.kept).toEqual([]);
    expect(forwardHandles).not.toHaveBeenCalled();
  });
  it("drops a handle now on another account (id mismatch)", async () => {
    const r = await recheckTags([bprd], {
      discover: async () => acct({ id: "999" }),
      registry: reg,
    });
    expect(r.kept).toEqual([]);
    expect(r.dropped[0].why).toMatch(/another account \(id changed\)/);
  });
  it("follows a rename only when the site links it and the back link holds", async () => {
    const renamed = acct({ username: "bendparksrec" });
    const discover = async (h: string) => {
      if (h === "bendparksrec") return renamed;
      throw missing();
    };
    const ok = await recheckTags([bprd], {
      discover,
      forwardHandles: async () => ["bendparksrec"],
      registry: reg,
    });
    expect(ok.kept).toEqual([{ ...bprd, handle: "bendparksrec" }]);
    const noLink = await recheckTags([bprd], {
      discover,
      forwardHandles: async () => ["somethingelse"],
      registry: reg,
    });
    expect(noLink.kept).toEqual([]);
    const noBack = await recheckTags([bprd], {
      discover: async (h) => {
        if (h === "bendparksrec")
          return acct({ username: "bendparksrec", website: "https://x.com" });
        throw missing();
      },
      forwardHandles: async () => ["bendparksrec"],
      registry: reg,
    });
    expect(noBack.kept).toEqual([]);
    const other = await recheckTags([bprd], {
      discover: async (h) => {
        if (h === "bendparksrec")
          return acct({ username: "bendparksrec", id: "5" });
        throw missing();
      },
      forwardHandles: async () => ["bendparksrec"],
      registry: reg,
    });
    expect(other.kept).toEqual([]);
    const fail = await recheckTags([bprd], {
      discover,
      forwardHandles: async () => {
        throw new Error("blocked");
      },
      registry: reg,
    });
    expect(fail.kept).toEqual([]);
  });
  it("drops a tag the registry no longer holds (or holds with another id)", async () => {
    const discover = vi.fn(async () => acct());
    const r = await recheckTags(
      [
        { ...bprd, igId: "000" },
        { ...bprd, domain: "gone.org" },
      ],
      { discover, registry: reg },
    );
    expect(r.kept).toEqual([]);
    expect(discover).not.toHaveBeenCalled();
  });
  it("stays inside its budget, in parallel, with a time limit", async () => {
    const many: Registry = { entries: {} };
    const tags: Tag[] = Array.from({ length: 10 }, (_, i) => {
      many.entries[`h${i}.org`] = {
        ...reg.entries["bendparksandrec.org"],
        handle: `h${i}`,
        igId: `${i}`,
        forward: `https://h${i}.org/`,
      };
      return {
        domain: `h${i}.org`,
        handle: `h${i}`,
        igId: `${i}`,
        role: "host",
      };
    });
    // Every handle gone, every site linking three new names: without a
    // budget that's 10 lookups, 10 fetches and 30 more lookups.
    const discover = vi.fn(async () => {
      throw missing();
    });
    const forwardHandles = vi.fn(async () => ["a", "b", "c"]);
    const r = await recheckTags(tags, {
      discover,
      forwardHandles,
      registry: many,
      budget: 15,
    });
    expect(r.kept).toEqual([]);
    expect(
      discover.mock.calls.length + forwardHandles.mock.calls.length,
    ).toBeLessThanOrEqual(15);
    // A hung lookup gives up, and the others still answer.
    const t0 = Date.now();
    const slow = await recheckTags([bprd, tower], {
      discover: (h) =>
        h === "bendparks"
          ? new Promise<DiscoveredAccount>(() => {})
          : Promise.resolve(tower0),
      registry: reg,
      timeoutMs: 50,
    });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(slow.kept.map((t) => t.handle)).toEqual(["towertheatrebend"]);
    expect(slow.dropped[0].why).toMatch(/timed out/);
  });
  it("noSuchUser is only Meta's clear answer", () => {
    expect(noSuchUser(missing())).toBe(true);
    expect(noSuchUser({ code: 110, subcode: null })).toBe(true);
    expect(noSuchUser({ code: 4, subcode: null })).toBe(false);
    expect(noSuchUser(new Error("timeout"))).toBe(false);
    expect(noSuchUser(null)).toBe(false);
  });
  it("the preview cache keeps answers a few hours, never errors", async () => {
    let t = 0;
    const cache = new Map();
    const inner = vi.fn(async () => acct());
    const d = cachedDiscover(inner, { cache, now: () => t });
    await d("bendparks");
    await d("BendParks");
    expect(inner).toHaveBeenCalledTimes(1);
    t = 4 * 3_600_000;
    await d("bendparks");
    expect(inner).toHaveBeenCalledTimes(2);
    const failing = vi.fn(async () => {
      throw new Error("x");
    });
    const f = cachedDiscover(failing, { cache: new Map() });
    await expect(f("a")).rejects.toThrow();
    await expect(f("a")).rejects.toThrow();
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe("the caption as it goes out", () => {
  const caption = [
    "Family events this week in Central Oregon (Nov 24 to 30)",
    "",
    "Hosts run these events.",
    "",
    "Hosts this week: @bendparks @towertheatrebend",
    "",
    "Every Thursday we send the weekend forecast and one good plan. It's free.",
    "Link in bio.",
  ].join("\n");
  const post = {
    kind: "events_week",
    caption,
    spec: { caption, tags: [bprd, tower] },
  };

  it("rewrites the tag line with the tags that held", async () => {
    const r = await publishCaption(post, {
      discover: async (h) => {
        if (h === "bendparks") return acct();
        throw missing();
      },
      registry: reg,
    });
    expect(r.caption).toContain("\nHosts this week: @bendparks\n");
    expect(r.caption).not.toMatch(/towertheatrebend/);
    expect(r.notes).toEqual([
      "tag @towertheatrebend dropped: @towertheatrebend can't be found (Business Discovery)",
    ]);
  });
  it("takes the line out (and its blank line) when none held", async () => {
    const r = await publishCaption(post, {
      discover: async () => {
        throw new Error("Meta said 500");
      },
      registry: reg,
    });
    expect(r.caption).not.toMatch(/@|Hosts this week/);
    expect(r.caption).toBe(withoutMentions(caption));
    expect(r.caption).not.toMatch(/\n\n\n/);
  });
  it("applies a rename", async () => {
    const r = await publishCaption(post, {
      discover: async (h) => {
        if (h === "bendparksrec") return acct({ username: "bendparksrec" });
        if (h === "towertheatrebend") return tower0;
        throw missing();
      },
      forwardHandles: async () => ["bendparksrec"],
      registry: reg,
    });
    expect(r.caption).toContain(
      "Hosts this week: @bendparksrec @towertheatrebend",
    );
  });
  it("is the same on a second try (from the composed caption)", async () => {
    const deps = {
      discover: async (h: string) => (h === "bendparks" ? acct() : tower0),
      registry: reg,
    };
    const a = await publishCaption(post, deps);
    const b = await publishCaption(
      { ...post, caption: "a caption already rewritten" },
      deps,
    );
    expect(a).toEqual(b);
  });
  it('still publishes with an @ in an event\'s words (it reads "at")', async () => {
    const odd = caption.replace(
      "Hosts run these events.",
      "Storytime @10am. Teen Night @TheGrove.",
    );
    const r = await publishCaption(
      {
        kind: "events_week",
        caption: odd,
        spec: { caption: odd, tags: [bprd] },
      },
      { discover: async () => acct(), registry: reg },
    );
    expect(r.caption).toContain("Storytime at 10am. Teen Night at TheGrove.");
    expect(mentionProblems(r.caption, ["bendparks"])).toEqual([]);
  });
  it("still publishes with a registry handle in the words and no tags", async () => {
    const words = "Thanks @bendparks for the sled hill.\nLink in bio.";
    const discover = vi.fn();
    const r = await publishCaption(
      { kind: "park_post", caption: words, spec: { caption: words } },
      { discover, registry: reg },
    );
    expect(r.caption).toBe(
      "Thanks at bendparks for the sled hill.\nLink in bio.",
    );
    expect(discover).not.toHaveBeenCalled();
  });
  it("leaves a post with no tags and no @ alone", async () => {
    const discover = vi.fn();
    const r = await publishCaption(
      {
        kind: "at_home",
        caption: "Plain words.",
        spec: { caption: "Plain words." },
      },
      { discover, registry: reg },
    );
    expect(r).toEqual({ caption: "Plain words.", notes: [] });
    expect(discover).not.toHaveBeenCalled();
  });
  it("finalizeMentions keeps the line's place", () => {
    const lines = mentionLines("events_week", [bprd, tower]);
    expect(lines).toEqual(["Hosts this week: @bendparks @towertheatrebend"]);
    expect(
      finalizeMentions(caption, "events_week", [bprd, tower], [tower]),
    ).toBe(
      caption.replace("@bendparks @towertheatrebend", "@towertheatrebend"),
    );
  });
});
