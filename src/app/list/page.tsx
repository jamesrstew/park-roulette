import type { Metadata } from "next";
import { Suspense } from "react";
import { BucketList } from "@/components/list/BucketList";
import { CrayonLoading } from "@/components/Loading";
import { getBucketList, getMe } from "@/lib/data";

export const metadata: Metadata = { title: "The Bucket List" };

async function List() {
  const me = await getMe();
  const parks = await getBucketList(me?.crew.id ?? null);
  return <BucketList parks={parks} signedIn={!!me} />;
}

export default function ListPage() {
  return (
    <Suspense fallback={<CrayonLoading label="Unrolling the list…" />}>
      <List />
    </Suspense>
  );
}
