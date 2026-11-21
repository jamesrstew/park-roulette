import { get, put } from "@vercel/blob";
import { alertLater } from "@/lib/alerts";
import { loadParks, sentIssue, weatherIssue } from "./data";
import type { Issue } from "./issue";
import type { Plan } from "./plan-types";
import { photoUri, previewInput, previewJpeg } from "./preview-image";

/**
 * The issue's preview picture, rendered ONCE and kept as a static JPEG in
 * our (private) Blob store at news/previews/{date}.jpg. The page's
 * og:image and the Friday text's MMS both serve those same bytes through
 * /newsletter/{date}/preview.jpg (the store is private, so Twilio and
 * link-preview fetchers need our door), and the CDN caches them for good.
 * Stored only on Vercel; locally every request renders.
 */

export const previewPath = (issueDate: string) =>
  `news/previews/${issueDate}.jpg`;

const canStore = () =>
  process.env.VERCEL === "1" && !!process.env.BLOB_READ_WRITE_TOKEN;

/** The stored JPEG, or null. */
export async function storedPreview(issueDate: string): Promise<Buffer | null> {
  if (!canStore()) return null;
  const blob = await get(previewPath(issueDate), { access: "private" }).catch(
    () => null,
  );
  if (!blob?.stream) return null;
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}

/** Draw the picture: `complete` is false when the park photo didn't load. */
export async function renderPreview(issue: Issue, plan: Plan | null) {
  const slug = issue.wheel_pick.park;
  const park = (await loadParks()).find((p) => p.slug === slug);
  const wanted = issue.wheel_pick.photo?.src;
  const photo = await photoUri(wanted);
  const input = previewInput(issue, plan, park?.name ?? slug, photo);
  return { jpeg: await previewJpeg(input), complete: !wanted || !!photo };
}

/**
 * The picture for an issue that went out: the stored file, or render it
 * now and store it (only a complete one; a missing photo is retried).
 */
export async function sentPreview(
  issueDate: string,
): Promise<{ jpeg: Buffer; stored: boolean } | null> {
  const sent = await sentIssue(issueDate);
  if (!sent) return null;
  const kept = await storedPreview(issueDate);
  if (kept) return { jpeg: kept, stored: true };
  const { jpeg, complete } = await renderPreview(sent.issue, sent.plan);
  if (complete && canStore()) {
    try {
      await put(previewPath(issueDate), jpeg, {
        access: "private",
        contentType: "image/jpeg",
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      return { jpeg, stored: true };
    } catch (e) {
      // Two renders at once: the first one stored wins; same picture.
      if (/already exists/i.test((e as Error)?.message ?? ""))
        return { jpeg: (await storedPreview(issueDate)) ?? jpeg, stored: true };
      alertLater({
        key: `news:preview:${issueDate}`,
        subject: "Issue preview picture didn't save",
        text: `Saving news/previews/${issueDate}.jpg to Blob failed (${(e as Error)?.name}). Pages still render it each time.`,
        everyMinutes: 24 * 60,
      });
    }
  }
  return { jpeg, stored: false };
}

/** A draft's picture, for the dry run (never stored). */
export async function draftPreview(issueDate: string) {
  const found = await weatherIssue(issueDate);
  if (!found || found.frozen) return null;
  return (await renderPreview(found.issue, found.plan)).jpeg;
}
