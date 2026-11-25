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
  it("finds an event's host domain, never a platform or a listing", () => {
    expect(
      hostDomain({
        url: "https://www.deschuteslibrary.org/calendar/event/1",
        organizer: { url: "https://www.deschuteslibrary.org/" },
      }),
    ).toBe("deschuteslibrary.org");
    expect(hostDomain({ url: "https://www.brasadaranch.com/x.htm" })).toBe(
      "brasadaranch.com",
    );
    expect(hostDomain({ url: "https://www.instagram.com/p/abc/" })).toBeNull();
    expect(hostDomain({ url: "https://runsignup.com/Race/1" })).toBeNull();
    expect(hostDomain({ url: "https://exploresisters.com/e" })).toBeNull();
    expect(hostDomain({ url: "https://bendbuzz.com/events/x" })).toBeNull();
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
      expect(e.back).toMatch(/^(website|bio): /);
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
    ]) as unknown as Parameters<typeof withHostTags>[1];
    const out = withHostTags([week(0, null), week(1, null)], rows, reg);
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

describe("validate: only verified handles", () => {
  it("rejects an @handle that isn't in the registry", () => {
    expect(mentionProblems("Hi @bendparks", ["bendparks"])).toEqual([]);
    expect(mentionProblems("Hi @BendParks.", ["bendparks"])).toEqual([]);
    expect(mentionProblems("Hi @madeup", ["bendparks"])[0]).toMatch(
      /@madeup, which isn't a verified host handle/,
    );
    // An email address isn't a mention.
    expect(mentionProblems("hello@parkroulette.quest", [])).toEqual([]);
    expect(captionMentions("a @x.y. and @z")).toEqual(["x.y", "z"]);
  });
  it("rejects more than 10", () => {
    const many = Array.from({ length: 11 }, (_, i) => `@h${i}`).join(" ");
    expect(
      mentionProblems(
        many,
        Array.from({ length: 11 }, (_, i) => `h${i}`),
      ),
    ).toEqual([expect.stringMatching(/more than 10/)]);
  });
  it("accepts every committed handle", () => {
    const all = registryHandles()
      .map((h) => `@${h}`)
      .join(" ");
    expect(captionMentions(all).length).toBe(registryHandles().length);
    expect(
      mentionProblems(all, registryHandles()).filter(
        (p) => !/more than/.test(p),
      ),
    ).toEqual([]);
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
  it("drops an account that's gone, or any API error", async () => {
    const r = await recheckTags([bprd, tower], {
      discover: async (h) => {
        if (h === "bendparks") throw new Error("Meta said 400: not found");
        throw new Error("Meta didn't answer (TimeoutError)");
      },
      registry: reg,
    });
    expect(r.kept).toEqual([]);
    expect(r.dropped.map((d) => d.why)).toEqual([
      "@bendparks can't be found (Business Discovery)",
      "@towertheatrebend can't be found (Business Discovery)",
    ]);
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
      throw new Error("gone");
    };
    const ok = await recheckTags([bprd], {
      discover,
      forwardHandles: async () => ["bendparksrec"],
      registry: reg,
    });
    expect(ok.kept).toEqual([{ ...bprd, handle: "bendparksrec" }]);
    // The site doesn't link the new name: dropped.
    const noLink = await recheckTags([bprd], {
      discover,
      forwardHandles: async () => ["somethingelse"],
      registry: reg,
    });
    expect(noLink.kept).toEqual([]);
    // Same id, but its website no longer names the site: dropped.
    const noBack = await recheckTags([bprd], {
      discover: async (h) => {
        if (h === "bendparksrec")
          return acct({ username: "bendparksrec", website: "https://x.com" });
        throw new Error("gone");
      },
      forwardHandles: async () => ["bendparksrec"],
      registry: reg,
    });
    expect(noBack.kept).toEqual([]);
    // The new name is another account: dropped.
    const other = await recheckTags([bprd], {
      discover: async (h) => {
        if (h === "bendparksrec")
          return acct({ username: "bendparksrec", id: "5" });
        throw new Error("gone");
      },
      forwardHandles: async () => ["bendparksrec"],
      registry: reg,
    });
    expect(other.kept).toEqual([]);
    // No way to read the site: dropped.
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
  it("caches answers for a few hours, never errors", async () => {
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
        throw new Error("gone");
      },
      registry: reg,
    });
    if ("error" in r) throw new Error(r.error);
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
    if ("error" in r) throw new Error(r.error);
    expect(r.caption).not.toMatch(/@|Hosts this week/);
    expect(r.caption).toBe(withoutMentions(caption));
    expect(r.caption).not.toMatch(/\n\n\n/);
  });
  it("applies a rename", async () => {
    const r = await publishCaption(post, {
      discover: async (h) => {
        if (h === "bendparksrec") return acct({ username: "bendparksrec" });
        if (h === "towertheatrebend") return tower0;
        throw new Error("gone");
      },
      forwardHandles: async () => ["bendparksrec"],
      registry: reg,
    });
    if ("error" in r) throw new Error(r.error);
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
  it("stops a post with an @handle no code put there", async () => {
    const bad = `${caption}\nThanks @stranger`;
    const r = await publishCaption(
      {
        kind: "events_week",
        caption: bad,
        spec: { caption: bad, tags: [bprd] },
      },
      { discover: async () => acct(), registry: reg },
    );
    expect(r).toMatchObject({ error: expect.stringMatching(/@stranger/) });
    const untagged = await publishCaption(
      {
        kind: "park_post",
        caption: "Hi @stranger",
        spec: { caption: "Hi @stranger" },
      },
      { discover: async () => acct(), registry: reg },
    );
    expect(untagged).toMatchObject({
      error: expect.stringMatching(/@stranger/),
    });
  });
  it("leaves a post with no tags alone", async () => {
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
