import sharp from "sharp";
import {
  type PreviewInput,
  PREVIEW_SIZE,
  renderIssuePreview,
} from "@/components/news/IssuePreview";
import type { Issue } from "./issue";
import { indoorWeek, photoCreditLine, weekendCardDays } from "./issue-preview";
import type { Plan } from "./plan-types";
import { photoSource } from "./validate";

/**
 * The issue's link preview as a JPEG (also the Friday text's MMS picture):
 * the frozen issue in, at most 600 KB out. WhatsApp and MMS carriers drop
 * heavier images.
 */

export const PREVIEW_MAX_BYTES = 600 * 1024;
const PHOTO_BOX = { width: 640, height: 630 - 92 };

/** "Dec 10, 2026" */
export function previewDate(issueDate: string): string {
  return new Date(`${issueDate}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The featured park's photo, cropped to its box, as a data URI, or null
 * (no photo, a host we don't take photos from, or the fetch failed).
 */
export async function photoUri(
  src: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!src || !photoSource(src)) return null;
  try {
    const r = await fetchImpl(src, {
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
      headers: { "user-agent": "ParkRoulette/1.0 (hello@parkroulette.quest)" },
    });
    if (!r.ok || !r.headers.get("content-type")?.startsWith("image/"))
      return null;
    const raw = Buffer.from(await r.arrayBuffer());
    if (raw.length > 15 * 1024 * 1024) return null;
    const jpeg = await sharp(raw)
      .rotate()
      .resize(PHOTO_BOX.width, PHOTO_BOX.height, { fit: "cover" })
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

/** What the picture shows, from the issue (and the photo, if it loaded). */
export function previewInput(
  issue: Issue,
  plan: Pick<Plan, "weather"> | null,
  parkName: string,
  photo: string | null,
): PreviewInput {
  const indoor = indoorWeek(issue, plan);
  const p = issue.wheel_pick.photo;
  return {
    dateLabel: previewDate(issue.issue_date),
    days: weekendCardDays(issue).map((d) => ({
      label: d.label,
      condition: d.condition,
      icon: d.icon,
      high: d.high!,
      low: d.low,
    })),
    // An Indoor week leads with the venue, never a park photo.
    photo:
      !indoor && photo && p ? { uri: photo, credit: photoCreditLine(p) } : null,
    title: indoor ? `Indoor pick: ${indoor.short}` : parkName,
  };
}

/** The picture as a JPEG under 600 KB. */
export async function previewJpeg(input: PreviewInput): Promise<Buffer> {
  const png = await renderIssuePreview(input);
  for (const quality of [86, 78, 70, 60]) {
    const jpeg = await sharp(png)
      .resize(PREVIEW_SIZE.width, PREVIEW_SIZE.height)
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (jpeg.length <= PREVIEW_MAX_BYTES || quality === 60) return jpeg;
  }
  throw new Error("unreachable");
}
