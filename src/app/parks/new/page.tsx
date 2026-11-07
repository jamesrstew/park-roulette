import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CrayonLoading } from "@/components/Loading";
import { Icon } from "@/components/icons";
import { Pines, Underline } from "@/components/Scribbles";
import { AddParkForm } from "@/components/map/AddParkForm";
import { getMe } from "@/lib/data";
import { getParkPins, townsOf } from "@/lib/data-map";

export const metadata: Metadata = { title: "Add a park" };

function coord(v: string | string[] | undefined, min: number, max: number) {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

async function AddPark({
  searchParams,
}: {
  searchParams: PageProps<"/parks/new">["searchParams"];
}) {
  const me = await getMe();
  if (!me) return <JoinNudge />;
  const [pins, sp] = await Promise.all([getParkPins(), searchParams]);
  const lat = coord(sp.lat, 42, 46.5);
  const lng = coord(sp.lng, -124.7, -116.4);
  return (
    <AddParkForm
      towns={townsOf(pins)}
      others={pins}
      start={lat != null && lng != null ? { lat, lng } : null}
    />
  );
}

function JoinNudge() {
  return (
    <div className="doodle-box mt-2 flex flex-col items-center gap-3 p-7 text-center">
      <span className="animate-float">
        <Icon name="crayon" size={64} />
      </span>
      <h2 className="text-3xl">Hop in first!</h2>
      <p className="text-ink-soft">
        Explorers can add playgrounds to the map. Played before? Sign in with
        your phone. New here? Ask someone who plays for an invite link.
      </p>
      <Link
        href="/me?next=%2Fparks%2Fnew#signin"
        className="crayon-btn wax bg-crayon-green text-white"
      >
        Hop in
      </Link>
      <Link
        href="/map"
        className="flex min-h-11 items-center font-hand text-lg text-ink-soft underline"
      >
        Back to the map
      </Link>
    </div>
  );
}

export default function NewParkPage(props: PageProps<"/parks/new">) {
  return (
    <div className="flex flex-col gap-4">
      <header className="relative pt-2">
        <Link
          href="/map"
          className="-ml-2 inline-flex min-h-11 items-center gap-1 px-2 font-hand text-lg text-ink-soft"
        >
          <Icon name="arrow_left" size={20} /> Map
        </Link>
        <h1 className="text-[2.6rem]">
          Add a missing <span className="text-crayon-orange">playground</span>
        </h1>
        <Underline className="-mt-1 h-3.5 w-48" color="#f58a2c" />
        <p className="mt-2 text-ink-soft">
          Found one that&apos;s not on our map? Draw it in for everyone.
        </p>
        <Pines className="pointer-events-none absolute top-0 right-0 h-12 w-24 opacity-80" />
      </header>
      <Suspense fallback={<CrayonLoading label="Getting the crayons out…" />}>
        <AddPark searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
