import { describe, expect, it } from "vitest";
import parks from "../../data/parks.json";
import raw from "../../data/park-profiles.json";
import {
  allEvidence,
  genericPhrases,
  MIN_POST_TRAITS,
  planProfile,
  PROFILES,
  ProfilesFile,
  traitIn,
  traitTerms,
} from "./park-profiles";
import { postCandidates } from "./social/candidates";

const nameOf = new Map(
  (parks as { slug: string; name: string }[]).map((p) => [p.slug, p.name]),
);

describe("data/park-profiles.json", () => {
  it("parses, and every key is a park", () => {
    expect(() => ProfilesFile.parse(raw)).not.toThrow();
    for (const slug of PROFILES.keys()) expect(nameOf.has(slug)).toBe(true);
  });
  it("covers every playground park", () => {
    for (const p of parks as { slug: string; play: string }[])
      if (p.play === "playground") expect(PROFILES.has(p.slug)).toBe(true);
  });
  it("gives every trait a key term, and leads the one_liner with the first trait", () => {
    for (const [slug, p] of PROFILES) {
      for (const t of p.traits)
        expect(
          traitTerms(t, nameOf.get(slug)).length,
          `${slug}: ${t.text}`,
        ).toBeGreaterThan(0);
      if (p.one_liner)
        expect(
          traitIn(p.one_liner, { traits: [p.traits[0]] }, nameOf.get(slug)),
          slug,
        ).not.toBeNull();
    }
  });
  it("never stores Google's words: Google traits carry no quotes, facts are booleans", () => {
    for (const [, p] of PROFILES) {
      for (const t of p.traits)
        for (const e of t.evidence) expect(e.url).not.toMatch(/google/);
      for (const v of Object.values(p.facts)) expect(typeof v).toBe("boolean");
    }
    expect(allEvidence().length).toBeGreaterThan(50);
  });
  it("has enough parks for a park post", () => {
    const ready = [...PROFILES.values()].filter(
      (p) => p.traits.length >= MIN_POST_TRAITS,
    );
    expect(ready.length).toBeGreaterThanOrEqual(20);
  });
});

describe("key terms", () => {
  const t = { text: "The SS Columbia pirate ship play structure" };
  it("keeps distinctive words and drops filler and the park's own name", () => {
    expect(traitTerms(t)).toEqual(
      ["ss", "columbia", "pirate", "ship"].filter((w) => w.length >= 3),
    );
    expect(traitTerms(t, "Columbia Park")).toEqual(["pirate", "ship"]);
  });
  it("matches stems", () => {
    const p = {
      traits: [
        {
          ...t,
          kind: "signature_structure" as const,
          source: "official" as const,
          evidence: [],
          verified_on: "2026-11-21",
        },
      ],
    };
    expect(
      traitIn("Pirate ships ahoy in Bend", p, "Columbia Park"),
    ).not.toBeNull();
    expect(
      traitIn("A Bend playground near the river", p, "Columbia Park"),
    ).toBeNull();
    expect(traitIn("Columbia Park is open", p, "Columbia Park")).toBeNull();
  });
});

describe("generic phrases", () => {
  it("catches the classics and lets real copy through", () => {
    expect(genericPhrases("Built for little climbing fans")).toHaveLength(1);
    expect(genericPhrases("Something for everyone")).toHaveLength(1);
    expect(genericPhrases("Fun for all ages")).toHaveLength(1);
    expect(genericPhrases("A great place to run")).toHaveLength(1);
    expect(genericPhrases("A pirate ship and a hillside slide")).toEqual([]);
  });
});

describe("the plans' view", () => {
  it("shows our words and evidence links, never quotes", () => {
    const p = planProfile(PROFILES.get("columbia-park-bend"))!;
    expect(p.one_liner).toMatch(/pirate ship/i);
    expect(p.traits[0].evidence[0]).toMatch(/^https:/);
    expect(JSON.stringify(p)).not.toMatch(/"quote"/);
    expect(planProfile(undefined)).toBeNull();
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
  it("only picks parks with 2 or more traits", () => {
    const all = new Map(
      ["larkspur-park-bend", "foxborough-park-bend", "kiwanis-park-bend"].map(
        (s) => [s, info(s)],
      ),
    );
    const got = postCandidates(
      all,
      new Set(),
      new Set(),
      () => false,
      "2026-11-23",
    );
    expect(got).toEqual(["larkspur-park-bend"]);
  });
});
