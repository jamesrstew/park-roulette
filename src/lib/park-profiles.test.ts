import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import parks from "../../data/parks.json";
import raw from "../../data/park-profiles.json";
import { ATTRIBUTES } from "./features";
import {
  glanceFor,
  glanceProblems,
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

const ALL = parks as {
  slug: string;
  name: string;
  city: string;
  play: string;
  features: string[];
}[];
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
  it("uses only words its traits back in each one_liner", () => {
    const filler = new Set(
      "plus with and the a an at on in by of to for from near next beside right just".split(
        " ",
      ),
    );
    for (const [slug, p] of PROFILES) {
      if (!p.one_liner) continue;
      const name = ALL.find((x) => x.slug === slug)!.name;
      const have = new Set(
        [
          ...p.traits.flatMap((t) => [
            ...words(t.text),
            ...t.keys.flatMap(words),
          ]),
          ...words(name),
        ].map(stem),
      );
      const bad = words(p.one_liner).filter(
        (w) =>
          !filler.has(w) &&
          !NOT_KEYS.has(w) &&
          !/^\d/.test(w) &&
          !have.has(stem(w)),
      );
      expect(bad, `${slug}: ${p.one_liner}`).toEqual([]);
    }
  });
  it("never makes a fence or accessibility claim from a Google trait in a one_liner", () => {
    for (const [slug, p] of PROFILES)
      if (p.one_liner)
        for (const t of p.traits)
          if (
            t.source === "google_places" &&
            (t.kind === "fenced" || t.kind === "all_abilities")
          )
            expect(traitIn(p.one_liner, [t]), slug).toBeNull();
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
      for (const text of [
        p.one_liner ?? "",
        p.glance ?? "",
        ...p.traits.map((t) => t.text),
      ])
        for (const r of run4(text)) if (g.has(r)) bad.push(`${slug}: "${r}"`);
    }
    expect(bad).toEqual([]);
  });
  it.skipIf(!existsSync(dir))(
    "grounds every glance in Google's summaries, the features or the traits",
    () => {
      const bad: string[] = [];
      for (const [slug, p] of PROFILES) {
        if (!p.glance) continue;
        const f = `${dir}/${slug}.json`;
        const g =
          p.glance_source !== "traits" && existsSync(f)
            ? googleText(JSON.parse(readFileSync(f, "utf8")).details)
            : "";
        const off = ungroundedGlance(slug, p, g);
        if (off.length) bad.push(`${slug}: ${off.join(", ")}`);
      }
      expect(bad).toEqual([]);
    },
  );
});

/**
 * Words a glance may use without a source: function words and kid talk
 * (NOT_KEYS covers most; these are the rest).
 */
const GLANCE_FILLER = new Set(
  "no plus beside close toward as of or but there it's also kept named began home spot".split(
    " ",
  ),
);

/** Content words of a glance that none of its sources back (stems compared). */
function ungroundedGlance(
  slug: string,
  p: ParkProfile,
  google: string,
): string[] {
  const park = ALL.find((x) => x.slug === slug)!;
  const ours = [
    park.name,
    park.city,
    park.play === "none" ? "no playground" : "",
    ...park.features.flatMap((f) => [
      f.replace(/_/g, " "),
      ATTRIBUTES[f]?.label ?? "",
    ]),
    ...p.traits.flatMap((t) => [t.text, ...t.keys]),
  ].join(" ");
  const have = new Set(words(`${ours} ${google}`).map(stem));
  return words(p.glance ?? "").filter(
    (w) =>
      !NOT_KEYS.has(w) &&
      !GLANCE_FILLER.has(w) &&
      !/^\d/.test(w) &&
      !have.has(stem(w)),
  );
}

/**
 * What most parks have: a google_places trait is for something
 * distinctive (a concrete forest, a hillside slide), never a trail, a
 * picnic area, a lawn, shade, benches or a pond on its own.
 */
const COMMON_TRAIT = new Set(
  "trail trails path paths walking walk loop picnic picnics table tables climb climbing climber climbers playground playgrounds play equipment structure structures open space grass grassy lawn lawns field fields shade shady tree trees bench benches pond lake water scenic view views paved area areas swing swings slide slides court courts basketball park"
    .split(" ")
    .map(stem),
);

describe("google_places traits are distinctive", () => {
  it("never makes a common feature a trait (some key names something distinctive)", () => {
    for (const [slug, p] of PROFILES)
      for (const t of p.traits)
        if (t.source === "google_places")
          expect(
            t.keys.some((k) =>
              words(k).some(
                (w) => !NOT_KEYS.has(w) && !COMMON_TRAIT.has(stem(w)),
              ),
            ),
            `${slug}: ${t.text} is a common feature`,
          ).toBe(true);
  });
  it("never takes a fence or accessibility trait from Google (it could never back a post's claim)", () => {
    for (const [slug, p] of PROFILES)
      for (const t of p.traits)
        if (t.source === "google_places")
          expect(
            ["fenced", "all_abilities"].includes(t.kind),
            `${slug}: ${t.text}`,
          ).toBe(false);
  });
  it("catches the common ones", () => {
    const common = (k: string) =>
      words(k).every((w) => NOT_KEYS.has(w) || COMMON_TRAIT.has(stem(w)));
    for (const k of [
      "walking trails",
      "scenic trails",
      "a pond",
      "picnic area",
      "open space",
      "grassy lawn",
      "shade trees",
      "benches",
      "playground",
      "climbing",
      "climbers",
    ])
      expect(common(k), k).toBe(true);
    for (const k of [
      "concrete forest",
      "hillside slide",
      "climbing wall",
      "rock climbing",
    ])
      expect(common(k), k).toBe(false);
  });
});

describe("at a glance", () => {
  it("has one for every profiled park", () => {
    for (const [slug, p] of PROFILES) expect(p.glance, slug).not.toBeNull();
  });
  it("keeps every glance to the rules: one sentence, no banned claim, nothing generic or seasonal", () => {
    const bad: string[] = [];
    for (const [slug, p] of PROFILES)
      if (p.glance)
        for (const x of glanceProblems(p.glance, p.traits))
          bad.push(`${slug}: ${x}`);
    expect(bad).toEqual([]);
  });
  it("grounds every traits-only glance in our own records (CI)", () => {
    const bad: string[] = [];
    for (const [slug, p] of PROFILES)
      if (p.glance_source === "traits") {
        const off = ungroundedGlance(slug, p, "");
        if (off.length) bad.push(`${slug}: ${off.join(", ")}`);
      }
    expect(bad).toEqual([]);
  });
  it("shows every glance year-round", () => {
    for (const [slug, p] of PROFILES)
      for (const month of [1, 7])
        expect(glanceFor(p, month), `${slug} ${month}`).toBe(p.glance);
  });
  it("catches each banned claim and lets plain copy through", () => {
    for (const s of [
      "A fully fenced playground by the river.",
      "An accessible playground with ramps.",
      "An inclusive playground for all abilities.",
      "A safe place for toddlers.",
      "Free parking and a slide.",
      "Open daily from dawn to dusk.",
      "Summer concerts on the lawn.",
      "Clean restrooms by the swings.",
      "A well-maintained playground.",
      "A splash pad by the swings.",
      "A sledding hill for little kids.",
      "Fun for all ages.",
      "A slide. And a swing.",
    ])
      expect(glanceProblems(s).length, s).toBeGreaterThan(0);
    expect(glanceProblems("No playground: a riverside trail.")).toEqual([]);
    expect(
      glanceProblems("A pirate ship to climb and a slide set into the hill."),
    ).toEqual([]);
    expect(
      glanceProblems("A summer sprayground and a slide.", [
        { keys: ["sprayground"], season: [6, 7] },
      ]),
    ).not.toEqual([]);
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
  it("matches each key's common inflections", () => {
    const forms: [string, string[]][] = [
      ["sled", ["sleds", "sledding", "sledder"]],
      ["sledding", ["sled", "sleds"]],
      ["boulder", ["boulders", "bouldering"]],
      ["bouldering", ["boulder", "boulders"]],
      ["slide", ["slides", "sliding", "slid"]],
      ["climbing", ["climb", "climbs", "climber", "climbers", "climbed"]],
      ["swim", ["swims", "swimming", "swimmer"]],
      ["fence", ["fences", "fenced", "fencing"]],
      ["skate park", ["skate parks"]],
      ["skatepark", ["skateparks"]],
      ["zipline", ["ziplines"]],
      ["tree", ["trees"]],
      ["sprayground", ["spraygrounds"]],
    ];
    for (const [key, list] of forms)
      for (const f of list) expect(hasKey(f, key), `${f} ~ ${key}`).toBe(true);
    // And every real key matches its own plural.
    for (const [slug, p] of PROFILES)
      for (const t of p.traits)
        for (const k of t.keys)
          if (/[a-z]$/.test(k) && !/(s|y)$/.test(k))
            expect(hasKey(`${k}s`, k), `${slug}: ${k}s`).toBe(true);
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
      hook("A concrete forest in Redmond", "quince-park-redmond"),
    ).not.toBeNull();
    // A Google summary can't back a fence: no fence trait, no fence hook.
    expect(
      hook("A fence all the way around", "quince-park-redmond"),
    ).toBeNull();
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
      "Fun for all ages and abilities",
      "Fun for the whole family",
      "A great place to run",
      "Two hidden gems",
      "Perfect for a picnic",
    ])
      expect(genericPhrases(s).length, s).toBeGreaterThan(0);
    expect(genericPhrases("A pirate ship and a hillside slide")).toEqual([]);
    expect(
      genericPhrases("Three zones for children of all ages and abilities"),
    ).toEqual([]);
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
  glance: null,
  glance_source: null,
  glance_on: null,
  facts: {},
});

describe("which traits count", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  it("drops traits whose evidence is confirmed missing, and the one-liner with any dropped trait", () => {
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
  it("hides a glance with a dropped trait it names, and a Google-sourced one after 12 months", () => {
    const base: ParkProfile = {
      ...profile([trait()]),
      glance: "A pirate ship to climb by the river.",
      glance_source: "both",
      glance_on: "2026-06-01",
    };
    const run = (p: ParkProfile, missing: string[], at = now) =>
      liveProfiles(new Map([["x", p]]), {
        missing: new Set(missing),
        now: at,
      }).get("x")!.glance;
    expect(run(base, [])).toBe(base.glance);
    expect(
      run(base, ["https://example.org/a\nthe SS Columbia ship-like structure"]),
    ).toBeNull();
    const later = new Date("2027-06-02T12:00:00Z");
    expect(run(base, [], later)).toBeNull();
    expect(run({ ...base, glance_source: "traits" }, [], later)).toBe(
      base.glance,
    );
  });
  it("hides a glance while a trait it names is out of season", () => {
    const p: ParkProfile = {
      ...profile([trait({ season: [6, 7] })]),
      glance: "A pirate ship to climb by the river.",
      glance_source: "traits",
      glance_on: "2026-11-21",
    };
    expect(glanceFor(p, 7)).toBe(p.glance);
    expect(glanceFor(p, 11)).toBeNull();
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
  it("hides a one-liner while a trait it names is out of season", () => {
    const p = profile([trait({ season: [6, 7] })]);
    expect(oneLinerFor(p, 7)).toBe(p.one_liner);
    expect(oneLinerFor(p, 11)).toBeNull();
    const q: ParkProfile = {
      ...profile([
        trait(),
        trait({
          text: "A sprayground",
          keys: ["sprayground"],
          kind: "splash_pad",
          season: [7],
        }),
      ]),
      one_liner: "A pirate ship to climb and a sprayground.",
    };
    expect(oneLinerFor(q, 7)).toBe(q.one_liner);
    expect(oneLinerFor(q, 11)).toBeNull();
  });
  it("shows the plans our words, keys and links, never quotes", () => {
    const p = planProfile(live("columbia-park-bend"), 11)!;
    expect(p.one_liner).toMatch(/pirate ship/i);
    expect(p.traits[0].keys).toContain("pirate ship");
    expect(p.traits[0].evidence[0]).toMatch(/^https:/);
    expect(p.glance).toMatch(/pirate ship/i);
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
