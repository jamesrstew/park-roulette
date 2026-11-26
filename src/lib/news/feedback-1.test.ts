import { describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import { type Issue, issueLinks } from "./issue";
import {
  eventsLinkText,
  renderHtml,
  renderText,
  SIGNOFF_PHOTO,
  signoffText,
} from "./template";
import { calendarFlags, greetingFor, holidays } from "./time";
import { greetingIn } from "./validate";

/**
 * James's feedback on the first issue (Thanksgiving 2026): a warm,
 * holiday-aware hello, one sign-off with his photo, and a way from This
 * weekend to every kids' event.
 */

const SITE = "https://parkroulette.quest";

const issue = {
  issue_date: "2026-11-26",
  subject: "Saturday's dry day and The Nutcracker",
  preview: "Rain is forecast Friday and Sunday. Here's a pool for Friday.",
  hello: { text: "Happy Thanksgiving! Saturday is the dry day." },
  wheel_pick: {
    park: "sisters-community-park-sisters",
    why_now: "It opened in fall 2025.",
    who_for: "Families who need room to run.",
    bring: "A ball.",
  },
  weekend: [
    {
      name: "The Nutcracker",
      day: "2026-11-28",
      time: "1:30 pm",
      cost: "$24.15",
      place: "Tower Theatre",
      town: "Bend",
      what: "The holiday story.",
      url: "https://www.towertheatre.org/event/nutcracker",
      evidence: [],
    },
  ],
  passport: { challenge_id: "challenge-new-to-you", text: "Spin it." },
  signoff: {
    text: "Spotted a closure or an icy slide? Hit reply and tell me. Have a warm, easy Thanksgiving. James",
  },
} as unknown as Issue;

const opts = (extra: object = {}) => ({
  catalog: { venues: [], challenges: [] } as unknown as Catalog,
  site: SITE,
  number: 1,
  park: () => ({ name: "Sisters Community Park", city: "Sisters" }),
  links: "track" as const,
  unsubscribeUrl: `${SITE}/news/unsubscribe?t=T`,
  postalAddress: "PO Box 1",
  ...extra,
});

describe("one sign-off", () => {
  it("drops a name the writer added after the last sentence", () => {
    expect(signoffText(issue.signoff.text)).toBe(
      "Spotted a closure or an icy slide? Hit reply and tell me. Have a warm, easy Thanksgiving.",
    );
    expect(signoffText("Hit reply! — James")).toBe("Hit reply!");
    expect(signoffText("Hit reply. -James.")).toBe("Hit reply.");
    // A name inside a sentence stays.
    expect(signoffText("Spotted a closure? Tell James")).toBe(
      "Spotted a closure? Tell James",
    );
    expect(signoffText("Hit reply.")).toBe("Hit reply.");
  });
  it("signs once, with James's photo, in the HTML and the text", () => {
    const html = renderHtml(issue, opts());
    expect(html.match(/>James</g)?.length).toBe(1);
    expect(html).not.toContain("Thanksgiving. James");
    expect(html).toContain(`src="${SITE}${SIGNOFF_PHOTO.path}"`);
    expect(html).toContain(`alt="${SIGNOFF_PHOTO.alt}"`);
    expect(html).toContain("border-radius:50%");
    expect(html).toContain('width="56" height="56"');
    const text = renderText(issue, opts());
    expect(text).toContain("Thanksgiving.\n\nSee you at the park,\nJames");
    expect(text.match(/James/g)?.length).toBe(1);
  });
});

describe("the way to every kids' event", () => {
  it("names the count when there are plenty, and not when few", () => {
    expect(eventsLinkText(129)).toBe("See all 129 Central Oregon kids' events");
    expect(eventsLinkText(10)).toBe("See all 10 Central Oregon kids' events");
    expect(eventsLinkText(4)).toBe("See more Central Oregon kids' events");
    expect(eventsLinkText(null)).toBe("See more Central Oregon kids' events");
    expect(eventsLinkText(undefined)).toBe(
      "See more Central Oregon kids' events",
    );
  });
  it("ends This weekend with a tracked link to /events", () => {
    const html = renderHtml(issue, opts({ eventsCount: 127 }));
    expect(html).toContain(`href="${SITE}/n/2026-11-26/events"`);
    expect(html).toContain("See all 127 Central Oregon kids&#39;&nbsp;events");
    const link = issueLinks(
      issue,
      { venues: [] } as unknown as Catalog,
      SITE,
    ).find((l) => l.slug === "events");
    expect(link?.url).toBe(`${SITE}/events`);
    expect(renderText(issue, opts({ eventsCount: 127 }))).toContain(
      `See all 127 Central Oregon kids' events: ${SITE}/n/2026-11-26/events`,
    );
    // The web archive links straight there.
    expect(renderHtml(issue, opts({ links: "direct" }))).toContain(
      `href="${SITE}/events"`,
    );
  });
  it("leaves the link out when there's no This weekend", () => {
    const none = { ...issue, weekend: undefined } as Issue;
    expect(renderHtml(none, opts())).not.toContain("/events");
    expect(
      issueLinks(none, { venues: [] } as unknown as Catalog, SITE).some(
        (l) => l.slug === "events",
      ),
    ).toBe(false);
  });
});

describe("a holiday-aware hello", () => {
  const breaks = [
    {
      label: "Bend-La Pine winter break",
      from: "2026-12-21",
      to: "2027-01-01",
    },
    {
      label: "Bend-La Pine spring break",
      from: "2027-03-22",
      to: "2027-03-26",
    },
  ];
  const hol = { ...holidays(2026), ...holidays(2027) };
  it("greets the week's occasion", () => {
    expect(greetingFor("2026-11-26", hol, breaks)?.opener).toBe(
      "Happy Thanksgiving!",
    );
    // Christmas on a Friday: the Thursday issue before it.
    expect(greetingFor("2025-12-25", holidays(2025), [])?.opener).toBe(
      "Merry Christmas!",
    );
    expect(greetingFor("2026-12-17", hol, breaks)).toBeNull();
    expect(greetingFor("2027-03-25", hol, breaks)?.opener).toBe(
      "Happy spring break!",
    );
    expect(greetingFor("2027-01-07", hol, breaks)?.opener).toBe(
      "Happy New Year!",
    );
    expect(greetingFor("2027-05-27", hol, breaks)?.opener).toBe(
      "Happy Memorial Day weekend!",
    );
    expect(greetingFor("2026-10-29", hol, breaks)?.opener).toBe(
      "Happy Halloween!",
    );
    // Quiet days get none.
    expect(greetingFor("2026-11-12", hol, breaks)).toBeNull();
    expect(greetingFor("2027-06-17", hol, breaks)).toBeNull();
  });
  it("rides in the plan's calendar", () => {
    const cal = calendarFlags("2026-11-26", {
      skip_dates: [],
      breaks: [
        {
          id: "w",
          label: "Bend-La Pine winter break",
          from: "2026-12-21",
          to: "2027-01-01",
          verified: true,
        },
      ],
    });
    expect(cal.greeting).toEqual({
      occasion: "Thanksgiving",
      opener: "Happy Thanksgiving!",
    });
  });
  it("knows when the opener greets it", () => {
    const g = { occasion: "Thanksgiving", opener: "Happy Thanksgiving!" };
    expect(greetingIn("Happy Thanksgiving! Rain Friday.", g)).toBe(true);
    expect(greetingIn("Happy Thanksgiving. Rain Friday.", g)).toBe(true);
    expect(greetingIn("Rain is forecast Friday.", g)).toBe(false);
    const w = { occasion: "winter break", opener: "Happy winter break!" };
    expect(greetingIn("Winter break starts Monday.", w)).toBe(true);
  });
});
