import { describe, expect, it } from "vitest";
import { INDEXNOW_KEY, indexNowBody } from "./indexnow";

describe("in-app IndexNow pings", () => {
  it("sends only our own https URLs, once each, with the key file", () => {
    const site = "https://parkroulette.quest";
    expect(
      indexNowBody(
        [
          `${site}/newsletter/2026-11-19`,
          `${site}/newsletter/2026-11-19`,
          "https://example.com/x",
          "http://parkroulette.quest/plain",
          "not a url",
        ],
        site,
      ),
    ).toEqual({
      host: "parkroulette.quest",
      key: INDEXNOW_KEY,
      keyLocation: `${site}/${INDEXNOW_KEY}.txt`,
      urlList: [`${site}/newsletter/2026-11-19`],
    });
  });
});
