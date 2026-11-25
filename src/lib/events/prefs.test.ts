import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  adopt,
  applyOp,
  BOOT,
  EMPTY,
  isHidden,
  markEmpty,
  parseState,
  PREFS_KEY,
  PREFS_STYLE_ID,
  type PrefsState,
  prefsCss,
  saveKey,
  splitKey,
} from "./prefs";

const state = (over: Partial<PrefsState> = {}): PrefsState => ({
  ...EMPTY,
  ...over,
});

/** Runs the boot script against a stub page; returns the CSS it wrote. */
function boot(stored: string | null): string | null {
  let css: string | null = null;
  const el = {
    id: "",
    set textContent(v: string) {
      css = v;
    },
  };
  const ctx = {
    localStorage: { getItem: (k: string) => (k === PREFS_KEY ? stored : null) },
    document: {
      getElementById: () => null,
      createElement: () => el,
      head: { appendChild: () => {} },
    },
  };
  vm.runInNewContext(BOOT, ctx);
  return css;
}

describe("saved and hidden events: the phone's state", () => {
  it("keys a save by page and occurrence, and reads it back", () => {
    expect(saveKey("lego-club", "2026-12-06-1400")).toBe(
      "lego-club|2026-12-06-1400",
    );
    expect(splitKey("lego-club|")).toEqual({ slug: "lego-club", occ: "" });
    expect(splitKey("lego-club|2026-12-06")).toEqual({
      slug: "lego-club",
      occ: "2026-12-06",
    });
    expect(splitKey('x"]{}|2026-12-06')).toBeNull();
    expect(splitKey("lego-club|tomorrow")).toBeNull();
  });

  it("drops anything odd from storage (never a selector it didn't check)", () => {
    const s = parseState(
      JSON.stringify({
        v: 1,
        owner: 7,
        saves: {
          "ok-one|2026-12-06": { at: 1, t: "Lego", w: "Sat" },
          'bad"]{x}|': { at: 1 },
          "ok-two|nope": {},
        },
        hides: { "fine-slug": 3, "</style>": 4 },
        pending: [
          { id: 1, k: "save", slug: "ok-one", occ: "2026-12-06", on: true },
          { id: 2, k: "hide", slugs: ["fine-slug", "BAD"], on: true },
          { id: 3, k: "nope" },
        ],
        tips: { save: 1 },
      }),
    );
    expect(Object.keys(s.saves)).toEqual(["ok-one|2026-12-06"]);
    expect(Object.keys(s.hides)).toEqual(["fine-slug"]);
    expect(s.pending).toHaveLength(2);
    expect(s.pending[1]).toMatchObject({ slugs: ["fine-slug"] });
    expect(s.tips).toEqual({ save: 1 });
    expect(parseState("not json")).toBe(EMPTY);
    expect(parseState(JSON.stringify({ v: 2 }))).toBe(EMPTY);
  });

  it("a phone's own list has no queue (only a family mirror sends edits)", () => {
    const s = parseState(
      JSON.stringify({
        v: 1,
        owner: null,
        saves: {},
        hides: {},
        pending: [{ id: 1, k: "save", slug: "a", occ: "", on: true }],
      }),
    );
    expect(s.pending).toEqual([]);
  });

  it("applies saves and hides", () => {
    let s = applyOp(
      EMPTY,
      { id: 1, k: "save", slug: "a", occ: "2026-12-06", on: true },
      { t: "A", w: "Sat" },
      100,
    );
    expect(s.saves["a|2026-12-06"]).toEqual({ at: 100, t: "A", w: "Sat" });
    s = applyOp(
      s,
      { id: 2, k: "hide", slugs: ["b", "c"], on: true },
      undefined,
      5,
    );
    expect(isHidden(s, ["x", "c"])).toBe(true);
    s = applyOp(s, { id: 3, k: "hide", slugs: ["b", "c"], on: false });
    expect(isHidden(s, ["b", "c"])).toBe(false);
    s = applyOp(s, {
      id: 4,
      k: "save",
      slug: "a",
      occ: "2026-12-06",
      on: false,
    });
    expect(s.saves).toEqual({});
  });

  it("adopts the family's list with this phone's unsent edits on top", () => {
    const mine = state({
      owner: 4,
      saves: {
        "a|": { at: 1, t: "A", w: "Here" },
        "z|": { at: 1, t: "Z", w: "" },
      },
      pending: [
        { id: 9, k: "save", slug: "z", occ: "", on: true },
        { id: 10, k: "hide", slugs: ["h"], on: true },
      ],
    });
    const next = adopt(mine, {
      crewId: 4,
      saves: ["a|", "b|2026-12-06"],
      hides: [],
    });
    // The server didn't have z yet: it stays (pending), with its title.
    expect(Object.keys(next.saves).sort()).toEqual([
      "a|",
      "b|2026-12-06",
      "z|",
    ]);
    expect(next.saves["a|"].t).toBe("A");
    expect(next.saves["z|"].t).toBe("Z");
    expect(next.hides).toHaveProperty("h");
    expect(next.pending).toHaveLength(2);
  });

  it("another family's edits never follow a switch", () => {
    const mine = state({
      owner: 4,
      saves: { "a|": { at: 1, t: "A", w: "" } },
      hides: { h: 1 },
      pending: [{ id: 9, k: "hide", slugs: ["h"], on: true }],
    });
    const next = adopt(mine, { crewId: 5, saves: ["q|"], hides: [] });
    expect(next.owner).toBe(5);
    expect(Object.keys(next.saves)).toEqual(["q|"]);
    expect(next.hides).toEqual({});
    expect(next.pending).toEqual([]);
  });

  it("writes the hide and heart rules (nothing when empty)", () => {
    expect(prefsCss(EMPTY)).toBe("");
    const s = state({
      hides: { "baby-story": 1 },
      saves: { "lego|": { at: 1, t: "", w: "" } },
    });
    const css = prefsCss(s);
    expect(css).toContain('[data-ev~="baby-story"]{display:none!important}');
    expect(css).toContain('[data-ev-if-hidden~="baby-story"]');
    expect(css).toContain('[data-sv="lego|"] [data-heart-on]');
    // Showing hidden ones: outlined, never display:none, no "all hidden" line.
    const shown = prefsCss(s, true);
    expect(shown).not.toContain('[data-ev~="baby-story"]{display:none');
    expect(shown).not.toContain("data-ev-allhidden");
  });

  it("the boot script writes exactly what the store writes", () => {
    const s = state({
      hides: { "baby-story": 1, "lego-club-redmond": 2 },
      saves: {
        "lego|": { at: 1, t: "", w: "" },
        "nutcracker|2026-12-06-1400": { at: 1, t: "", w: "" },
      },
    });
    expect(boot(JSON.stringify(s))).toBe(prefsCss(s));
    expect(boot(JSON.stringify(state({ hides: { solo: 1 } })))).toBe(
      prefsCss(state({ hides: { solo: 1 } })),
    );
    // Hostile storage: the boot script checks slugs too.
    const evil = JSON.stringify({
      v: 1,
      hides: { '"]{}*{display:none}': 1 },
      saves: {},
    });
    expect(boot(evil)).toBe("");
    expect(boot(null)).toBeNull();
    expect(boot("{broken")).toBeNull();
    expect(PREFS_STYLE_ID).toBe("pr-ev-css");
  });

  it("keeps the newest saves and lets old dated ones go", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    const saves: Record<string, unknown> = {
      "old|2026-09-01": { at: 1, t: "", w: "" },
      "reg|": { at: 2, t: "", w: "" },
    };
    for (let i = 0; i < 310; i++)
      saves[`e${i}|2026-12-06`] = { at: 1000 + i, t: "", w: "" };
    const s = parseState(JSON.stringify({ v: 1, saves }), now);
    expect(Object.keys(s.saves)).toHaveLength(300);
    expect(s.saves["old|2026-09-01"]).toBeUndefined();
    expect(s.saves["e309|2026-12-06"]).toBeDefined();
    expect(s.saves["e0|2026-12-06"]).toBeUndefined();
  });

  it("joining a family keeps edits queued during the merge", () => {
    const mine = state({
      owner: null,
      saves: {},
      pending: [{ id: 1, k: "save", slug: "a", occ: "", on: false }],
    });
    const next = adopt(mine, { crewId: 3, saves: ["a|"], hides: [] }, true);
    expect(next.owner).toBe(3);
    expect(next.pending).toHaveLength(1);
    // The unsave made during the merge wins over the merged row.
    expect(next.saves["a|"]).toBeUndefined();
  });
});

describe("markEmpty: boxes and groups with every item hidden", () => {
  type El = {
    dataset: { ev?: string };
    attrs: Set<string>;
    items: El[];
    setAttribute(k: string): void;
    removeAttribute(k: string): void;
    querySelectorAll(sel: string): El[];
  };
  const el = (ev?: string, items: El[] = []): El => ({
    dataset: { ev },
    attrs: new Set(),
    items,
    setAttribute(k) {
      this.attrs.add(k);
    },
    removeAttribute(k) {
      this.attrs.delete(k);
    },
    querySelectorAll() {
      return this.items;
    },
  });

  it("marks only when everything inside is hidden, and never while showing them", () => {
    const allHidden = el(undefined, [el("a b"), el("c")]);
    const someLeft = el(undefined, [el("a"), el("d")]);
    const none = el(undefined, []);
    const root = {
      querySelectorAll: () => [allHidden, someLeft, none],
    } as unknown as ParentNode;
    const s = state({ hides: { b: 1, c: 1, a: 1 } });
    markEmpty(root, s, false);
    expect(allHidden.attrs.has("data-ev-empty")).toBe(true);
    expect(someLeft.attrs.has("data-ev-empty")).toBe(false);
    expect(none.attrs.has("data-ev-empty")).toBe(false);
    markEmpty(root, s, true);
    expect(allHidden.attrs.has("data-ev-empty")).toBe(false);
  });
});
