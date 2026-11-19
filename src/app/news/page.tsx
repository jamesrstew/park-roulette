import type { Metadata } from "next";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { Feed } from "@/components/news/Feed";
import { getMe } from "@/lib/data";
import { getFeed } from "@/lib/data-feed";
import { sentIssues } from "@/lib/news/data";

export const metadata: Metadata = { title: "The scoop" };

async function News() {
  const me = await getMe();
  const [items, issues] = await Promise.all([getFeed(me), sentIssues(1)]);
  const now = new Date();
  return (
    <Feed items={items} issues={issues} signedIn={!!me} now={now.getTime()} />
  );
}

export default function NewsPage() {
  return (
    <Suspense fallback={<CrayonLoading label="Reading the news…" />}>
      <News />
    </Suspense>
  );
}
