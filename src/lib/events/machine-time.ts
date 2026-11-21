/**
 * Machine dates and times in an organizer's data ("2026-11-21",
 * "2026-11-21T10:30:00-08:00", "2026-11-22T01:00:00Z", "20261121T103000"),
 * as Pacific wall-clock days and times. A value with Z or an offset is an
 * instant: it's converted to America/Los_Angeles before it's compared
 * ("2026-11-22T01:00:00Z" is Nov 21 at 5 pm). A value with no zone
 * (floating, or an .ics TZID-local time) is local already. Pure, no
 * imports: both validators use it.
 */

export type MachineMoment = { day: string; time?: string };

const ISO =
  /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s?(z|[+-]\d{2}:?\d{2})?)?(?![\d:])/gi;
const BASIC = /(?<!\d)(\d{4})(\d{2})(\d{2})t(\d{2})(\d{2})(\d{2})?(z)?(?!\d)/gi;

/** An instant as its Pacific day and HH:MM. */
function pacific(ms: number): MachineMoment {
  const s = new Date(ms).toLocaleString("sv-SE", {
    timeZone: "America/Los_Angeles",
  });
  return { day: s.slice(0, 10), time: s.slice(11, 16) };
}

function moment(
  y: string,
  mo: string,
  d: string,
  hh?: string,
  mm?: string,
  zone?: string,
): MachineMoment | null {
  const day = `${y}-${mo}-${d}`;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31)
    return null;
  if (hh == null) return { day };
  if (mm == null || Number(hh) > 23 || Number(mm) > 59) return null;
  if (!zone) return { day, time: `${hh}:${mm}` };
  const utc = Date.UTC(+y, +mo - 1, +d, +hh, +mm);
  if (/^z$/i.test(zone)) return pacific(utc);
  const m = zone.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  const off = (Number(m[2]) * 60 + Number(m[3])) * (m[1] === "+" ? 1 : -1);
  return pacific(utc - off * 60_000);
}

/** Every machine date or date-time in a text, as Pacific day and time. */
export function machineMoments(text: string): MachineMoment[] {
  const out: MachineMoment[] = [];
  for (const x of text.matchAll(ISO)) {
    const m = moment(x[1], x[2], x[3], x[4], x[5], x[7]);
    if (m) out.push(m);
  }
  for (const x of text.matchAll(BASIC)) {
    const m = moment(x[1], x[2], x[3], x[4], x[5], x[7]);
    if (m) out.push(m);
  }
  return out;
}

/** Does machine data in the text put something on this Pacific day? */
export function machinePrintsDay(text: string, day: string): boolean {
  return machineMoments(text).some((m) => m.day === day);
}

/** Does machine data in the text put a start at this Pacific HH:MM (on `day`, if given)? */
export function machinePrintsTime(
  text: string,
  hhmm: string,
  day?: string,
): boolean {
  return machineMoments(text).some(
    (m) => m.time === hhmm && (!day || m.day === day),
  );
}
