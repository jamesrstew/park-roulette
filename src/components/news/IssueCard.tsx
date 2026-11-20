import type { Issue } from "@/lib/news/issue";
import {
  CARD_EMAIL_WIDTH,
  MEME_SECTION,
  postImageUrl,
  renderArchiveCard,
  renderArchiveSplit,
  type RenderOptions,
} from "@/lib/news/template";
import { InstagramEmbed } from "./InstagramEmbed";

/**
 * A sent issue on the web. An Instagram Parents' corner renders in its
 * own slot: our stored card, and a button that loads Instagram's embed
 * only when tapped. Every string in the HTML halves is escaped by the
 * template.
 */
export function IssueCard({
  issue,
  options,
  className,
}: {
  issue: Issue;
  options: RenderOptions;
  className: string;
}) {
  const ig =
    issue.meme?.snapshot?.kind === "instagram" ? issue.meme.snapshot : null;
  if (!ig)
    return (
      <div
        className={className}
        dangerouslySetInnerHTML={{ __html: renderArchiveCard(issue, options) }}
      />
    );
  const { before, after } = renderArchiveSplit(issue, options);
  const card = ig.card && options.memeImage !== false ? ig.card : null;
  return (
    <div className={className}>
      <div dangerouslySetInnerHTML={{ __html: before }} />
      <section
        aria-label={MEME_SECTION}
        className="flex flex-col gap-2 px-8 pt-8"
      >
        <p className="text-[13px] font-bold tracking-wider uppercase">
          <span className="border-b-4 border-crayon-purple">
            {MEME_SECTION}
          </span>
        </p>
        <InstagramEmbed
          permalink={ig.permalink}
          username={ig.username}
          image={
            card
              ? {
                  src: postImageUrl(options.site, issue)!,
                  width: CARD_EMAIL_WIDTH,
                  height: Math.round(
                    (CARD_EMAIL_WIDTH * card.height) / card.width,
                  ),
                  alt: card.alt,
                }
              : null
          }
        />
      </section>
      {after ? <div dangerouslySetInnerHTML={{ __html: after }} /> : null}
    </div>
  );
}
