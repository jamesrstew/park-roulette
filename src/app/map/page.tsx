import type { Metadata } from "next";
import { Suspense } from "react";
import { MapLoading, MapScreen } from "@/components/map/MapScreen";
import { getBucketList, getMe } from "@/lib/data";

export const metadata: Metadata = { title: "Map" };

async function MapData() {
  const me = await getMe();
  const parks = await getBucketList(me);
  return <MapScreen parks={parks} signedIn={!!me} />;
}

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0">
          <MapLoading />
        </div>
      }
    >
      <MapData />
    </Suspense>
  );
}
