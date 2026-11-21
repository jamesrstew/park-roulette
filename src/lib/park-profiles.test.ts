import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import parks from "../../data/parks.json";
import raw from "../../data/park-profiles.json";
import {
  genericPhrases,
  hasKey,
  liveProfiles,
  MIN_POST_TRAITS,
  NOT_KEYS,
  oneLinerFor,
  type ParkProfile,
  planProfile,
  postKinds,
  PROFILES,
  PROFILES_ERROR,
  ProfilesFile,
  stem,
  TOWN_WORDS,
  type Trait,
  traitIn,
  words,
} from "./park-profiles";
import { postCandidates } from "./social/candidates";

const ALL = parks as { slug: string; name: string; play: string }[];
const live = (slug: string) => PROFILES.get(slug)!;

describe("data/park-profiles.json", () => {
  it("parses strictly (CI is the gate; runtime falls back to none)", () => {
    expect(PROFILES_ERROR).toBeNull();
    expect(() => ProfilesFile.parse(raw)).not.toThrow();
    for (const slug of PROFILES.keys())
      expect(ALL.some((p) => p.slug === slug)).toBe(true);
  });
  it("covers every playground park", () => {
    for (const p of ALL)
      if (p.play === "playground") expect(PROFILES.has(p.slug)).toBe(true);
  });
  it("never uses a stop word, a town, or what every park is as a key", () => {
    for (const [slug, p] of PROFILES)
      for (const t of p.traits)
        for (const k of t.keys) {
          const w = words(k);
          const label = `${slug}: ${t.text}: "${k}"`;
          expect(w.length, label).toBeGreaterThan(0);
          expect(NOT_KEYS.has(w.join(" ")), label).toBe(false);
          expect(
            w.some((x) => !NOT_KEYS.has(x)),
            label,
          ).toBe(true);
          for (const town of TOWN_WORDS)
            expect(hasKey(k, town), `${label} is a town`).toBe(false);
          for (const x of ["park", "playground", "kids", "children"])
            expect(w.join(" ") === x, label).toBe(false);
        }
  });
  it("leads each one_liner with its first trait's keys", () => {
    for (const [slug, p] of PROFILES)
      if (p.one_liner)
        expect(traitIn(p.one_liner, [p.traits[0]]), slug).not.toBeNull();
  });
  it("never leads with a seasonal trait when there's another", () => {
    for (const [slug, p] of PROFILES)
      if (p.traits.length > 1) expect(p.traits[0].season, slug).toBeUndefined();
  });
  it("keeps Google out: google_places traits carry no evidence; no Google field names", () => {
    const json = JSON.stringify(raw);
    expect(json).not.toMatch(
      /reviewSummary|editorialSummary|generativeSummary|authorAttribution|googleapis|maps\.google/,
    );
    for (const [, p] of PROFILES)
      for (const t of p.traits)
        if (t.source === "google_places") expect(t.evidence).toEqual([]);
  });
  it("has enough parks for a park post in summer and in winter", () => {
    for (const month of [1, 7]) {
      const ready = [...PROFILES.values()].filter(
        (p) => postKinds(p, month) >= MIN_POST_TRAITS,
      );
      expect(ready.length).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("no shared 4-word runs with Google's text (local only)", () => {
  const dir = "data/.google-cache";
  const run4 = (s: string) => {
    const w = words(s);
    const out = new Set<string>();
    for (let i = 0; i + 3 < w.length; i++) out.add(w.slice(i, i + 4).join(" "));
    return out;
  };
  const pick = (x: unknown): string =>
    typeof x === "string"
      ? x
      : x && typeof x === "object"
        ? Object.values(x).map(pick).join(" \n ")
        : "";
  const googleText = (d: Record<string, unknown> | undefined): string =>
    d
      ? [d.reviewSummary, d.editorialSummary, d.generativeSummary, d.reviews]
          .map(pick)
          .join(" \n ")
      : "";
  it.skipIf(!existsSync(dir))("checks every trait and one-liner", () => {
    const bad: string[] = [];
    for (const f of readdirSync(dir)) {
      const slug = f.replace(/\.json$/, "");
      const p = PROFILES.get(slug);
      if (!p) continue;
      const g = run4(
        googleText(JSON.parse(readFileSync(`${dir}/${f}`, "utf8")).details),
      );
      for (const text of [p.one_liner ?? "", ...p.traits.map((t) => t.text)])
        for (const r of run4(text)) if (g.has(r)) bad.push(`${slug}: "${r}"`);
    }
    expect(bad).toEqual([]);
  });
});

describe("matching", () => {
  it("stems plurals and -er/-ing together, and leaves trees alone", () => {
    expect(stem("trees")).toBe("tree");
    expect(stem("slides")).toBe(stem("slide"));
    expect(stem("climbers")).toBe(stem("climbing"));
    expect(stem("climbing")).toBe(stem("climb"));
    expect(stem("boxes")).toBe("box");
    expect(stem("benches")).toBe("bench");
    expect(words("Bend's")).toEqual(["bend"]);
  });
  it("matches keys on word boundaries, never inside a word", () => {
    expect(hasKey("A pirate ship!", "pirate ship")).toBe(true);
    expect(hasKey("pirates", "pirate")).toBe(true);
    expect(hasKey("spiral", "pirate")).toBe(false);
    expect(hasKey("the shipyard", "ship")).toBe(false);
  });
  it("passes the reviewer's real posts", () => {
    const hook = (s: string, slug: string) => traitIn(s, live(slug).traits);
    expect(
      hook("Bend playground for little climbers", "farewell-bend-park-bend"),
    ).not.toBeNull();
    expect(
      hook("A zip line in Redmond", "sam-johnson-park-redmond"),
    ).not.toBeNull();
    expect(
      hook("Bend's treehouse playground", "rockridge-park-bend"),
    ).not.toBeNull();
    expect(
      hook("A fence all the way around", "quince-park-redmond"),
    ).not.toBeNull();
  });
  it("refuses the reviewer's holes", () => {
    const hook = (s: string, slug: string) => traitIn(s, live(slug).traits);
    for (const slug of [
      "alpenglow-park-bend",
      "hillside-park-bend",
      "sylvan-park-bend",
    ])
      expect(hook("Bend's best playground this week", slug), slug).toBeNull();
    expect(
      hook("A Prineville park to visit", "pioneer-park-prineville"),
    ).toBeNull();
    expect(hook("Great for children", "larkspur-park-bend")).toBeNull();
    expect(hook("Bring their own snacks", "pine-nursery-park-bend")).toBeNull();
    // Every filler word the reviewer found, against every park.
    const filler =
      "their own where that over under through both only open who can down first old summer day known unique popular easy fully";
    for (const [slug, p] of PROFILES)
      expect(traitIn(filler, p.traits), slug).toBeNull();
  });
});

describe("generic phrases", () => {
  it("catches the classics and lets real copy through", () => {
    for (const s of [
      "Built for little climbing fans",
      "Something for everyone",
      "Fun for all ages",
      "Kids of all ages",
      "Fun for the whole family",
      "A great place to run",
      "Two hidden gems",
      "Perfect for a picnic",
    ])
      expect(genericPhrases(s).length, s).toBeGreaterThan(0);
    expect(genericPhrases("A pirate ship and a hillside slide")).toEqual([]);
  });
});

const trait = (over: Partial<Trait> = {}): Trait => ({
  text: "A pirate ship to climb",
  keys: ["pirate ship"],
  kind: "signature_structure",
  source: "official",
  evidence: [
    {
      url: "https://example.org/a",
      quote: "the SS Columbia ship-like structure",
    },
  ],
  verified_on: "2026-11-21",
  ...over,
});
const profile = (traits: Trait[]): ParkProfile => ({
  place_id: null,
  traits,
  one_liner: traits.length ? "A pirate ship to climb, and more." : null,
  facts: {},
});

describe("which traits count", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  it("drops traits whose evidence was last seen missing, and the one-liner with a dropped lead", () => {
    const creek = trait({
      text: "A creek",
      keys: ["creek"],
      kind: "water",
      evidence: [
        { url: "https://example.org/b", quote: "a creek runs right by it" },
      ],
    });
    const got = liveProfiles(new Map([["x", profile([trait(), creek])]]), {
      missing: new Set([
        "https://example.org/a\nthe SS Columbia ship-like structure",
      ]),
      now,
    }).get("x")!;
    expect(got.traits).toEqual([creek]);
    expect(got.one_liner).toBeNull();
  });
  it("lets google_places traits go stale after 12 months", () => {
    const stale = trait({
      source: "google_places",
      evidence: [],
      verified_on: "2025-11-01",
    });
    const fresh = trait({
      source: "google_places",
      evidence: [],
      verified_on: "2026-06-01",
    });
    const got = liveProfiles(new Map([["x", profile([fresh, stale])]]), {
      missing: new Set(),
      now,
    }).get("x")!;
    expect(got.traits).toEqual([fresh]);
  });
  it("counts distinct kinds, in season, nearby and history aside", () => {
    const p = profile([
      trait(),
      trait({
        text: "A sprayground",
        keys: ["sprayground"],
        kind: "splash_pad",
        season: [6, 7, 8],
      }),
      trait({ text: "By the pool", keys: ["pool"], kind: "nearby" }),
      trait({ text: "Built in 1972", keys: ["1972"], kind: "history" }),
      trait({ text: "Another ship", keys: ["ship"] }),
    ]);
    expect(postKinds(p, 7)).toBe(2);
    expect(postKinds(p, 11)).toBe(1);
  });
  it("hides a one-liner while its lead trait is out of season", () => {
    const p = profile([trait({ season: [6, 7] })]);
    expect(oneLinerFor(p, 7)).toBe(p.one_liner);
    expect(oneLinerFor(p, 11)).toBeNull();
  });
  it("shows the plans our words, keys and links, never quotes", () => {
    const p = planProfile(live("columbia-park-bend"), 11)!;
    expect(p.one_liner).toMatch(/pirate ship/i);
    expect(p.traits[0].keys).toContain("pirate ship");
    expect(p.traits[0].evidence[0]).toMatch(/^https:/);
    expect(JSON.stringify(p)).not.toMatch(/"quote"/);
    expect(planProfile(undefined, 11)).toBeNull();
  });
});

describe("park-post candidates", () => {
  const info = (slug: string) => ({
    slug,
    name: slug,
    city: "Bend",
    address: null,
    status: "active",
    approved: true,
    play: "playground",
    features: ["swings"],
  });
  it("only picks parks with 2 or more distinct in-season kinds (fixture data)", () => {
    const creek = trait({ text: "A creek", keys: ["creek"], kind: "water" });
    const profiles = new Map<string, ParkProfile>([
      ["two-kinds", profile([trait(), creek])],
      [
        "one-kind",
        profile([trait(), trait({ text: "A ship", keys: ["ship"] })]),
      ],
      [
        "context",
        profile([
          trait(),
          trait({ text: "By the pool", keys: ["pool"], kind: "nearby" }),
        ]),
      ],
      [
        "summer",
        profile([
          trait(),
          trait({
            text: "A sprayground",
            keys: ["sprayground"],
            kind: "splash_pad",
            season: [7],
          }),
        ]),
      ],
    ]);
    const all = new Map([...profiles.keys(), "none"].map((s) => [s, info(s)]));
    const pick = (month: number) =>
      postCandidates(
        all,
        new Set(),
        new Set(),
        () => false,
        "2026-11-23",
        profiles,
        month,
      ).sort();
    expect(pick(11)).toEqual(["two-kinds"]);
    expect(pick(7)).toEqual(["summer", "two-kinds"]);
  });
});
