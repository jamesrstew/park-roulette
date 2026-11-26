import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { PairingPage } from "@/components/seo/PairingPage";
import { allPairingGuides } from "@/lib/pairing-guides-data";
import { guidesForPage, pairingPagePath } from "@/lib/pairing-pages";
import { allPairingPages, loadPairingPage } from "@/lib/pairing-pages-data";
import { socialPost } from "@/lib/social/public";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug;
  await connection(); // live data, never a build-time snapshot
  const v = await loadPairingPage(slug, new Date());
  // Here, before the page streams, so a gone page is a real 404.
  if (!v) notFound();
  return {
    title: { absolute: v.title },
    description: v.description,
    alternates: { canonical: pairingPagePath(v.slug) },
    // Most of its pairs are on a newer page: that one is the one to find.
    ...(v.superseded ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: v.title,
      description: v.description,
      type: "article",
    },
  };
}

async function Page({ params }: Props) {
  const slug = (await params).slug;
  await connection();
  const now = new Date();
  const v = await loadPairingPage(slug, now);
  if (!v) notFound();
  const want = new Set(guidesForPage(v).map((g) => g.slug));
  const [guides, all, post] = await Promise.all([
    allPairingGuides(now),
    allPairingPages(now),
    socialPost(v.postId).catch(() => null),
  ]);
  return (
    <PairingPage
      v={v}
      guides={guides.filter((g) => want.has(g.def.slug))}
      // The newest others, its own theme first.
      others={[
        ...all.filter((o) => o.slug !== v.slug && o.theme === v.theme),
        ...all.filter((o) => o.slug !== v.slug && o.theme !== v.theme),
      ].slice(0, 3)}
      postShown={!!post}
    />
  );
}

export default function PairingPageRoute(props: Props) {
  return (
    <Suspense fallback={<CrayonLoading label="Opening the guide…" />}>
      <Page {...props} />
    </Suspense>
  );
}
