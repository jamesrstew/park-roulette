import { describe, expect, it } from "vitest";
import { airQuality, forecastByDay, maxObserved } from "./airnow";
import {
  alertCovers,
  bestSlot,
  dayTier,
  gateOpen,
  gustFromText,
  snowAmount,
  type TextPeriod,
  windChillFromText,
} from "./tiers";
import { countedDays, weekTiers } from "./week-tiers";

/** Saturday, December 5, 2026 (PST). */
const SAT = "2026-12-05";
const day = (over: Partial<TextPeriod> = {}): TextPeriod => ({
  startTime: `${SAT}T06:00:00-08:00`,
  isDaytime: true,
  temperature: 42,
  windSpeed: "5 to 10 mph",
  shortForecast: "Sunny",
  detailedForecast: "Sunny, with a high near 42.",
  probabilityOfPrecipitation: { value: 0 },
  ...over,
});
const tier = (
  p: Partial<TextPeriod>,
  extra: Partial<Parameters<typeof dayTier>[0]> = {},
) => dayTier({ date: SAT, periods: [day(p)], alerts: [], ...extra });

describe("reading the NWS text forecast", () => {
  it("takes the upper end of a snow range", () => {
    expect(
      snowAmount("New snow accumulation of 3 to 5 inches possible."),
    ).toMatchObject({ inches: 5 });
    expect(
      snowAmount("New snow accumulation of less than one inch possible."),
    ).toMatchObject({ inches: 1 });
    expect(
      snowAmount("New snow accumulation of around 2 inches possible."),
    ).toMatchObject({ inches: 2 });
    expect(snowAmount("Sunny, with a high near 40.")).toBeNull();
    expect(gustFromText("Windy, with gusts as high as 45 mph.")).toBe(45);
    expect(windChillFromText("Wind chill values as low as -5.")).toBe(-5);
  });
});

describe("day tiers (the critic's thresholds)", () => {
  it("calls the first draft's weekend cold-but-fine, not disruptive (42°F, 31% light snow)", () => {
    const t = tier({
      temperature: 42,
      shortForecast: "Chance Light Snow",
      detailedForecast:
        "A chance of light snow. Mostly cloudy, with a high near 42.",
      probabilityOfPrecipitation: { value: 31 },
    });
    expect(t.tier).toBe("plan_around");
    expect(t.plan_around.map((f) => f.hazard)).toEqual(["snow"]);
  });
  it("leaves a 20% chance of flurries, and a dry 40°F day, fine", () => {
    expect(
      tier({
        shortForecast: "Slight Chance Snow Showers",
        probabilityOfPrecipitation: { value: 20 },
        temperature: 38,
      }).tier,
    ).toBe("fine");
    expect(tier({ temperature: 40 }).tier).toBe("fine");
  });
  it("opens the gate at 4 inches of snow (the upper end), not at 1 to 3", () => {
    const big = tier({
      shortForecast: "Snow",
      detailedForecast:
        "Snow. High near 30. New snow accumulation of 3 to 5 inches possible.",
      probabilityOfPrecipitation: { value: 90 },
      temperature: 30,
    });
    expect(big.tier).toBe("disruptive");
    expect(big.snow_in).toBe(5);
    expect(
      tier({
        shortForecast: "Snow Showers Likely",
        detailedForecast:
          "Snow showers likely. New snow accumulation of 1 to 3 inches possible.",
        probabilityOfPrecipitation: { value: 70 },
        temperature: 33,
      }).tier,
    ).toBe("plan_around");
  });
  it("calls freezing rain at 40% disruptive, and never freezing fog", () => {
    expect(
      tier({
        shortForecast: "Freezing Rain Likely",
        probabilityOfPrecipitation: { value: 60 },
      }).disruptive.map((f) => f.hazard),
    ).toContain("ice");
    expect(
      tier({
        shortForecast: "Patchy Freezing Fog",
        probabilityOfPrecipitation: { value: 0 },
        temperature: 38,
      }).tier,
    ).toBe("fine");
  });
  it("separates all-day rain from showers with a window", () => {
    expect(
      tier({ shortForecast: "Rain", probabilityOfPrecipitation: { value: 90 } })
        .tier,
    ).toBe("disruptive");
    expect(
      tier({
        shortForecast: "Rain Showers Likely",
        probabilityOfPrecipitation: { value: 70 },
      }).tier,
    ).toBe("plan_around");
  });
  it("opens the gate at gusts of 40 mph; 25 to 39 is plan-around", () => {
    expect(
      tier({ detailedForecast: "Windy, with gusts as high as 40 mph." }).tier,
    ).toBe("disruptive");
    expect(
      tier({ detailedForecast: "Breezy, with gusts as high as 35 mph." }).tier,
    ).toBe("plan_around");
  });
  it("heat at 95, cold at 19 or a wind chill of 0", () => {
    expect(tier({ temperature: 97 }).tier).toBe("disruptive");
    expect(tier({ temperature: 90 }).tier).toBe("plan_around");
    expect(tier({ temperature: 18 }).tier).toBe("disruptive");
    expect(tier({ temperature: 31 }).tier).toBe("plan_around");
    expect(
      tier({
        temperature: 25,
        detailedForecast: "Sunny. Wind chill values as low as -2.",
      }).tier,
    ).toBe("disruptive");
  });
  it("smoke: the AQI forecast, or the observed fallback when the forecast still names smoke", () => {
    expect(tier({}, { aqi: { forecast: 128, observed: null } }).tier).toBe(
      "disruptive",
    );
    expect(tier({}, { aqi: { forecast: 74, observed: null } }).tier).toBe(
      "plan_around",
    );
    const smoky = tier(
      { shortForecast: "Areas Of Smoke" },
      { aqi: { forecast: null, observed: 130 } },
    );
    expect(smoky.disruptive).toEqual([
      expect.objectContaining({ hazard: "smoke", source: "airnow_observed" }),
    ]);
    expect(
      tier(
        { shortForecast: "Sunny" },
        { aqi: { forecast: null, observed: 130 } },
      ).tier,
    ).toBe("fine");
  });
  it("counts an alert only when it covers 9 am to 5 pm that day", () => {
    const watch = {
      event: "Winter Storm Watch",
      onset: "2026-12-05T04:00:00-08:00",
      ends: "2026-12-06T04:00:00-08:00",
      expires: null,
    };
    expect(tier({}, { alerts: [watch] }).disruptive).toEqual([
      { hazard: "snow", why: "Winter Storm Watch", source: "alert" },
    ]);
    const early = { ...watch, ends: "2026-12-05T08:00:00-08:00" };
    expect(alertCovers(early, SAT)).toBe(false);
    expect(tier({}, { alerts: [early] }).tier).toBe("fine");
    expect(
      tier({}, { alerts: [{ ...watch, event: "Winter Weather Advisory" }] })
        .tier,
    ).toBe("plan_around");
    expect(
      tier({}, { alerts: [{ ...watch, event: "Air Quality Alert" }] }).tier,
    ).toBe("disruptive");
  });
  it("never calls a day disruptive on missing data", () => {
    const t = dayTier({ date: SAT, periods: [], alerts: [] });
    expect(t).toMatchObject({ tier: "fine", high: null });
  });
});

describe("the week", () => {
  const base = { from: "", to: "", verified: true };
  it("counts Friday only when a district has no school", () => {
    expect(countedDays("2026-12-03", [])).toEqual(["2026-12-05", "2026-12-06"]);
    expect(
      countedDays("2026-12-03", [
        { ...base, from: "2026-12-04", to: "2026-12-04" },
      ]),
    ).toEqual(["2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(
      countedDays("2026-12-03", [
        { ...base, from: "2026-12-04", to: "2026-12-04", verified: false },
      ]),
    ).toHaveLength(2);
  });
  it("gates on Bend, names the best time, and computes the other towns too", () => {
    const snowSat = day({
      shortForecast: "Snow",
      detailedForecast:
        "Snow. New snow accumulation of 4 to 6 inches possible.",
      probabilityOfPrecipitation: { value: 90 },
      temperature: 30,
    });
    const clearSun = day({
      startTime: "2026-12-06T06:00:00-08:00",
      temperature: 36,
    });
    const w = weekTiers({
      issueDate: "2026-12-03",
      catalog: { breaks: [] },
      forecast: {
        Bend: [snowSat, clearSun],
        Sisters: [snowSat, clearSun],
      },
      alerts: {},
      air: { forecast: {}, observed: null, source: "none" },
    });
    expect(w.disruptiveDays).toEqual(["2026-12-05"]);
    expect(w.forDayHazards).toEqual(["snow"]);
    expect(w.bestSlot).toBe("Sunday, 11 am to 2 pm");
    expect(Object.keys(w.towns).sort()).toEqual(["Bend", "Sisters"]);
    expect(gateOpen(w.towns.Bend)).toBe(true);
    expect(bestSlot(w.towns.Bend.slice(0, 1), 12)).toBe(
      "the first clear morning",
    );
  });
});

describe("AirNow (the post-September 2026 services)", () => {
  it("reads the new camelCase fields and the old ones", () => {
    expect(
      forecastByDay([
        { dateValid: "2026-08-15 ", parameterName: "PM2.5", aqi: 128 },
        { dateValid: "2026-08-15", parameterName: "O3", aqi: 40 },
        { DateForecast: "2026-08-16", AQI: 74 },
        { dateValid: "2026-08-17", aqi: -1 },
      ]),
    ).toEqual({ "2026-08-15": 128, "2026-08-16": 74 });
    expect(maxObserved([{ nowcastAQI: 130 }, { AQI: 90 }])).toBe(130);
    expect(maxObserved([])).toBeNull();
  });
  it("does nothing without a key, and falls back cleanly when AirNow fails", async () => {
    expect(await airQuality("2026-08-13", { key: "" })).toMatchObject({
      source: "none",
    });
    const calls: string[] = [];
    const down = (async (u: URL) => {
      calls.push(String(u));
      return new Response("no", { status: 503 });
    }) as unknown as typeof fetch;
    expect(
      await airQuality("2026-08-13", { key: "k", fetchImpl: down }),
    ).toMatchObject({ source: "none" });
    expect(calls.some((c) => c.includes("/aq/forecast/current/"))).toBe(true);
    expect(
      calls.some((c) => c.includes("/aq/observation/current/ziplatlong/")),
    ).toBe(true);
    const up = (async (u: URL) =>
      Response.json(
        String(u).includes("forecast")
          ? [
              { dateValid: "2026-08-12", aqi: 160 },
              { dateValid: "2026-08-15", aqi: 128 },
            ]
          : [{ nowcastAQI: 112 }],
      )) as unknown as typeof fetch;
    expect(await airQuality("2026-08-13", { key: "k", fetchImpl: up })).toEqual(
      { forecast: { "2026-08-15": 128 }, observed: 112, source: "airnow" },
    );
  });
});

describe("release 5 review: the text forecast's real sentences", () => {
  it("H1: 'Little or no ice accumulation expected' is not ice", () => {
    const t = tier({
      temperature: 38,
      shortForecast: "Chance Freezing Rain then Chance Rain",
      detailedForecast:
        "A chance of freezing rain before 10am, then a chance of rain. Cloudy, with a high near 38. Chance of precipitation is 30%. Little or no ice accumulation expected.",
      probabilityOfPrecipitation: { value: 30 },
    });
    expect(t.disruptive.map((f) => f.hazard)).not.toContain("ice");
    expect(
      tier({
        temperature: 31,
        shortForecast: "Snow",
        detailedForecast:
          "New ice accumulation of around 0.1 of an inch possible. New snow accumulation of 1 to 2 inches possible.",
        probabilityOfPrecipitation: { value: 80 },
      }).disruptive.map((f) => f.hazard),
    ).toContain("ice");
  });
  it("M5: a break in the detailed words keeps rain from being all-day", () => {
    expect(
      tier({
        temperature: 45,
        shortForecast: "Rain",
        detailedForecast:
          "Rain, mainly after 11am. Cloudy, with a high near 45. Chance of precipitation is 80%.",
        probabilityOfPrecipitation: { value: 80 },
      }).tier,
    ).toBe("plan_around");
  });
  it("M6: a watch with no end time runs 48 hours from its onset", () => {
    const watch = {
      event: "Winter Storm Watch",
      onset: "2026-12-04T16:00:00-08:00",
      ends: null,
      // The message's replacement time, not the hazard's end.
      expires: "2026-12-04T20:00:00-08:00",
    };
    expect(alertCovers(watch, SAT)).toBe(true);
    expect(
      alertCovers({ ...watch, event: "Special Weather Statement" }, SAT),
    ).toBe(false);
  });
  it("M7: snow and sleet, around an inch, 0.5 to 1 inch, word numbers, wind chill as low as zero", () => {
    expect(
      snowAmount("New snow and sleet accumulation of 2 to 4 inches possible."),
    ).toMatchObject({ inches: 4 });
    expect(
      snowAmount("New snow accumulation of around an inch possible."),
    ).toMatchObject({ inches: 1 });
    expect(
      snowAmount("New snow accumulation of 0.5 to 1 inch possible."),
    ).toMatchObject({ inches: 1 });
    expect(
      snowAmount("New snow accumulation of one to three inches possible."),
    ).toMatchObject({ inches: 3 });
    expect(
      snowAmount("New snow accumulation of less than half an inch possible."),
    ).toMatchObject({ inches: 0.5 });
    expect(
      snowAmount("Total daytime snow accumulation of 5 to 9 inches possible."),
    ).toMatchObject({ inches: 9 });
    expect(snowAmount("Little or no snow accumulation expected.")).toBeNull();
    expect(windChillFromText("Wind chill values as low as zero.")).toBe(0);
    expect(windChillFromText("Wind chill values between -5 and 5.")).toBe(-5);
    expect(
      tier({
        temperature: 36,
        detailedForecast: "Mostly sunny. Wind chill values as low as zero.",
      }).tier,
    ).toBe("disruptive");
  });
  it("records the sustained wind and the observed AQI for the number check", () => {
    const t = tier(
      { windSpeed: "20 to 30 mph" },
      { aqi: { forecast: null, observed: 74 } },
    );
    expect(t).toMatchObject({ wind_mph: 30, aqi_observed: 74 });
  });
  it("AirNow with no rows at all is no data", async () => {
    const empty = (async () => Response.json([])) as unknown as typeof fetch;
    expect(
      await airQuality("2026-08-13", { key: "k", fetchImpl: empty }),
    ).toMatchObject({ source: "none" });
  });
});
