import { ImageResponse } from "next/og";
import { handFont } from "@/components/me/og-card";
import { WeatherCard, weatherSize } from "@/components/news/WeatherCard";
import { weatherIssue } from "@/lib/news/data";
import { cardDays, hasWeatherCard } from "@/lib/news/template";
import { draftImageKeyOk } from "@/lib/news/image-key";
import { isIsoDate } from "@/lib/news/time";

/**
 * The weather card in an issue (The weekend ahead), drawn from the
 * forecast stored in the issue, never a live one, so an email opened next
 * month shows what it said on Thursday. Serves any issue whose send has
 * started (frozen: cached for good) and the latest checked draft (for the
 * dry run: cached briefly). Skipped weeks and unknown dates get a 404.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  const found = isIsoDate(date) ? await weatherIssue(date) : null;
  // A draft's images need the dry-run key; a started send's are public.
  const keyed =
    found?.frozen ||
    draftImageKeyOk(date, new URL(req.url).searchParams.get("k"));
  const days = found?.issue.weekend_ahead?.days;
  if (!found || !keyed || !days || !hasWeatherCard(days))
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  // The note is HTML text below the image in the email, never drawn in.
  const card = cardDays(days);
  return new ImageResponse(<WeatherCard days={card} />, {
    ...weatherSize(card),
    fonts: await handFont(),
    headers: {
      "cache-control": found.frozen
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300",
    },
  });
}
