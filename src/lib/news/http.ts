import "server-only";
import { addDays, isIsoDate, pacific, weekdayOf } from "./time";
import { bearerOk } from "./tokens";

/**
 * Shared bits of the routines' endpoints. Three bearer tokens, each injected
 * by its routine's proxy, so no routine ever sees one:
 *
 * - NEWS_INGEST_TOKEN (the Thursday writer and the daily events routine):
 *   read the plan, check and hand in drafts, hand in events, grow the X
 *   universe and POST a retro. It can't read or change lessons, read the
 *   stats or send email.
 * - MAINTAINER_TOKEN (the Sunday maintainer, report-only): read lessons
 *   and stats, triage lessons, send the weekly summary, POST its retro.
 *   Unset means off: every maintainer endpoint answers 401.
 * - SOCIAL_TOKEN (the Sunday Instagram routine): /api/social/* only, plus
 *   its own retro (kind "social"). NEWS_INGEST_TOKEN is refused on
 *   /api/social/*. Unset means off.
 */

export function ingestOk(req: Request): boolean {
  return bearerOk(req, process.env.NEWS_INGEST_TOKEN, 24);
}

export function maintainerOk(req: Request): boolean {
  return bearerOk(req, process.env.MAINTAINER_TOKEN, 24);
}

/** The Sunday Instagram routine's bearer (lib/social/settings.ts socialOk). */
export function socialOk(req: Request): boolean {
  return bearerOk(req, process.env.SOCIAL_TOKEN, 24);
}

export const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });

export const nope = () => json({ error: "Not allowed" }, 401);

/**
 * A request body as JSON, at most 64 KB, read as a stream so a bigger
 * body is never buffered whole. Null when it's too big or not JSON.
 */
export async function readJson(
  req: Request,
  max = 64 * 1024,
): Promise<unknown | null> {
  const text = await readCapped(req, max);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The body as text, or null once it passes `max` bytes. */
export async function readCapped(
  req: Request,
  max: number,
): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The Thursday send starts at 7:00 Pacific: drafts for today stop then. */
export const SEND_CUTOFF_MINUTES = 7 * 60;

/**
 * Is this a Thursday the writer may work on: today (Pacific) or within the
 * next week? Returns why not, or null. With cutoffMinutes (the check and
 * drafts routes), today is refused once that Pacific time has passed: the
 * send window has started, so a draft for it could never go out. The
 * plan route leaves it out, so today's plan stays readable for diagnosis.
 */
export function issueDateProblem(
  date: unknown,
  now = new Date(),
  opts: { cutoffMinutes?: number; nextIssueDate?: string } = {},
): string | null {
  if (!isIsoDate(date)) return "issue_date must be YYYY-MM-DD.";
  if (weekdayOf(date) !== 4) return "issue_date must be a Thursday.";
  const p = pacific(now);
  const today = p.date;
  if (date < today) return "That Thursday has passed.";
  if (date > addDays(today, 7))
    return "Too far ahead: plan one week at a time.";
  if (
    opts.cutoffMinutes != null &&
    date === today &&
    p.minutes >= opts.cutoffMinutes
  )
    return `That Thursday's send window has started. Draft for next_issue_date (${opts.nextIssueDate ?? addDays(today, 7)}).`;
  return null;
}
