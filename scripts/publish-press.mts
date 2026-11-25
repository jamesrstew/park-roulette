/**
 * Publish a one-off press post (lib/social/press.ts): the Instagram feed
 * carousel, then the Instagram Stories (one per slide, in order), then the Facebook Page photo post,
 * in that order, printing each id. The images are the committed JPEGs in
 * public/press/, fetched by Meta from parkroulette.quest/press/, so deploy
 * them first: the script checks that each public file is byte-for-byte the
 * local one before it calls Meta, and stops if not.
 *
 *   pnpm exec tsx --conditions react-server --env-file=<prod env file> \
 *     scripts/publish-press.mts [--dry-run] [--only ig,story,fb]
 *
 * Needs IG_ACCESS_TOKEN, IG_USER_ID (and IG_APP_SECRET when set) for
 * Instagram, plus FB_PAGE_ID for Facebook, the same variables the
 * publisher cron reads (lib/social/settings.ts). Get them with
 * `vercel env pull --environment=production <file>`; never print them.
 *
 * --dry-run checks the files and the variables and prints the plan and the
 * captions; it never calls Meta. --only re-runs some steps (after a
 * partial run), so nothing that already went out goes out twice.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  containerStatus,
  createContainer,
  facebookPost,
  type GraphOpts,
  publishContainer,
} from "../src/lib/social/graph";
import {
  BULLETIN_2026_11,
  pressFiles,
  pressUrl,
} from "../src/lib/social/press";

const STEPS = ["ig", "story", "fb"] as const;
type Step = (typeof STEPS)[number];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyAt = args.indexOf("--only");
const only = new Set<Step>(
  onlyAt >= 0
    ? (args[onlyAt + 1] ?? "").split(",").map((s) => {
        if (!(STEPS as readonly string[]).includes(s))
          throw new Error(`--only takes ${STEPS.join(",")}; got "${s}".`);
        return s as Step;
      })
    : STEPS,
);

const p = BULLETIN_2026_11;
const files = pressFiles(p);

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Each public file must be the committed one (Meta fetches the public one). */
async function checkPublic(file: string): Promise<string> {
  const url = pressUrl(file);
  const local = await readFile(join(process.cwd(), "public/press", file));
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}. Deploy first.`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/jpeg"))
    throw new Error(`${url} is ${type || "untyped"}, not image/jpeg.`);
  const remote = new Uint8Array(await res.arrayBuffer());
  if (sha(remote) !== sha(local))
    throw new Error(`${url} isn't the committed file. Deploy first.`);
  console.log(`ok  ${url}`);
  return url;
}

function igOpts(): GraphOpts {
  const token = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;
  if (!token || !igUserId || !/^\d{5,25}$/.test(igUserId))
    throw new Error("Set IG_ACCESS_TOKEN and IG_USER_ID (see the header).");
  return {
    token,
    igUserId,
    appSecret: process.env.IG_APP_SECRET || undefined,
  };
}

function pageId(): string {
  const id = process.env.FB_PAGE_ID;
  if (!id || !/^\d{5,25}$/.test(id))
    throw new Error("Set FB_PAGE_ID (see the header).");
  return id;
}

/** Wait until Meta has fetched and processed a container (up to 3 minutes). */
async function finished(id: string, o: GraphOpts): Promise<void> {
  for (let i = 0; i < 36; i++) {
    const s = await containerStatus(id, o);
    if (s.code === "FINISHED") return;
    if (s.code !== "IN_PROGRESS")
      throw new Error(`Container ${id} is ${s.code} (${s.detail ?? ""}).`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`Container ${id} still IN_PROGRESS after 3 minutes.`);
}

async function main() {
  const feedUrls: string[] = [];
  for (const f of files.feed) feedUrls.push(await checkPublic(f));
  const storyUrls: string[] = [];
  for (const f of files.stories) storyUrls.push(await checkPublic(f));

  const ig = only.has("ig") || only.has("story") ? igOpts() : null;
  const page = only.has("fb") ? pageId() : null;
  console.log(
    `Steps: ${[...only].join(", ")}. Variables present: ${[
      ig ? "Instagram" : null,
      page ? "Facebook Page" : null,
    ]
      .filter(Boolean)
      .join(", ")}.`,
  );

  if (dryRun) {
    console.log("\n--- Instagram caption ---\n" + p.igCaption);
    console.log("\n--- Facebook caption ---\n" + p.fbCaption);
    console.log("\nDry run: Meta was not called. Nothing was posted.");
    return;
  }

  if (only.has("ig") && ig) {
    const children: string[] = [];
    for (const [i, url] of feedUrls.entries())
      children.push(
        await createContainer(
          { kind: "carousel_item", imageUrl: url, altText: p.feedAlts[i] },
          ig,
        ),
      );
    for (const c of children) await finished(c, ig);
    const carousel = await createContainer(
      { kind: "carousel", children, caption: p.igCaption },
      ig,
    );
    await finished(carousel, ig);
    const media = await publishContainer(carousel, ig);
    console.log(`Instagram feed post published: media id ${media}`);
  }

  if (only.has("story") && ig) {
    // One Story per frame, in order: each published before the next is made.
    for (const [i, url] of storyUrls.entries()) {
      const story = await createContainer({ kind: "story", imageUrl: url }, ig);
      await finished(story, ig);
      const media = await publishContainer(story, ig);
      console.log(`Instagram Story ${i + 1} published: media id ${media}`);
    }
  }

  if (only.has("fb") && page) {
    const post = await facebookPost(
      page,
      { imageUrls: feedUrls, caption: p.fbCaption },
      igOpts(),
    );
    console.log(`Facebook Page post published: post id ${post}`);
  }
}

main().catch((e) => {
  console.error((e as Error)?.message ?? e);
  process.exitCode = 1;
});
