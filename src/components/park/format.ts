const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-10-12" → "Oct 12" (adds the year when it isn't this year). No time zone drift. */
export function formatDay(isoDate: string, now = new Date()): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  return y === now.getFullYear() ? base : `${base}, ${y}`;
}

/**
 * A timestamp → "Oct 12" on Oregon's calendar. A fixed zone keeps the server
 * render and the phone's render identical.
 */
export function formatStamp(iso: string, now = new Date()): string {
  const fmt = (t: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(t);
  return formatDay(fmt(new Date(iso)), new Date(`${fmt(now)}T12:00:00`));
}

/** Today as YYYY-MM-DD in local time. */
export function todayLocal(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
