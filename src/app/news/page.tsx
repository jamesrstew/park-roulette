import type { Metadata } from "next";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { Feed } from "@/components/news/Feed";
import { getMe } from "@/lib/data";
import { getFeed } from "@/lib/data-feed";

export const metadata: Metadata = { title: "What's new" };

async function News() {
  const me = await getMe();
  const items = await getFeed(me);
  const now = new Date();
  return <Feed items={items} signedIn={!!me} now={now.getTime()} />;
}

export default function NewsPage() {
  return (
    <Suspense fallback={<CrayonLoading label="Reading the news…" />}>
      <News />
    </Suspense>
  );
}
