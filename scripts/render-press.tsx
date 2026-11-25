/**
 * Draw a one-off press post (lib/social/press.ts) into public/press/: the
 * feed slides (1080 x 1350) and one Story frame per slide (1080 x 1920), as the same
 * sRGB JPEGs the publisher uses. No database, no Meta.
 *
 *   pnpm exec tsx --conditions react-server scripts/render-press.tsx [<out-dir>]
 *
 * <out-dir> defaults to public/press. Commit the files there, deploy, then
 * publish with scripts/publish-press.mts.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { handFont } from "../src/components/me/og-card";
import {
  PressCover,
  PressQuote,
  PressStoryCover,
  PressStoryQuote,
} from "../src/components/social/PressSlides";
import { FEED, STORY } from "../src/lib/social/model";
import { BULLETIN_2026_11, pressFiles } from "../src/lib/social/press";
import { toJpeg } from "../src/lib/social/render";

const out = process.argv[2] ?? join(process.cwd(), "public/press");
const p = BULLETIN_2026_11;

async function draw(
  el: ReactElement,
  size: { width: number; height: number },
): Promise<Buffer> {
  const res = new ImageResponse(el, { ...size, fonts: await handFont() });
  return toJpeg(Buffer.from(await res.arrayBuffer()));
}

async function main() {
  await mkdir(out, { recursive: true });
  const files = pressFiles(p);
  const of = files.feed.length;
  const feed = [
    <PressCover key="cover" p={p} of={of} />,
    <PressQuote key="quote" p={p} quote={0} n={2} of={of} />,
  ];
  for (const [i, el] of feed.entries()) {
    await writeFile(join(out, files.feed[i]), await draw(el, FEED));
    console.log(`wrote ${join(out, files.feed[i])}`);
  }
  // One Story frame per feed slide, in order: the same content, re-laid out.
  const stories = [
    <PressStoryCover key="cover" p={p} />,
    <PressStoryQuote key="quote" p={p} quote={0} />,
  ];
  for (const [i, el] of stories.entries()) {
    await writeFile(join(out, files.stories[i]), await draw(el, STORY));
    console.log(`wrote ${join(out, files.stories[i])}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
