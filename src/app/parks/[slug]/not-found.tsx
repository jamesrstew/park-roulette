import Link from "next/link";
import { Icon } from "@/components/icons";
import { Cloud, Pines } from "@/components/Scribbles";

export default function ParkNotFound() {
  return (
    <div className="flex flex-col items-center gap-5 pt-10 text-center">
      <div className="relative h-44 w-64">
        <Cloud className="absolute top-0 left-2 w-24 animate-float" />
        <svg
          viewBox="0 0 120 120"
          className="absolute -top-2 right-0 w-24 rotate-12"
          fill="none"
          aria-hidden
        >
          {/* A lost little magnifying glass */}
          <g filter="url(#crayon)" strokeLinecap="round">
            <circle
              cx="50"
              cy="50"
              r="28"
              fill="#fffdf7"
              stroke="#2b2a33"
              strokeWidth="5"
            />
            <path d="M71 71 L100 100" stroke="#9a6a3f" strokeWidth="10" />
            <path
              d="M40 44 Q 50 34 60 44 M50 58 v4"
              stroke="#e5432f"
              strokeWidth="4"
            />
          </g>
        </svg>
        <Pines className="absolute bottom-0 left-0 w-3/4" />
      </div>
      <h1 className="font-sketch text-4xl font-bold">Hmm, no park here!</h1>
      <p className="max-w-xs font-hand text-xl text-ink-soft">
        We looked under every slide. This page must have wandered off.
      </p>
      <div className="flex flex-col gap-3">
        <Link href="/" className="crayon-btn wax bg-crayon-yellow">
          <Icon name="spin" size={28} /> Spin for a real one
        </Link>
        <Link href="/map" className="crayon-btn bg-paper text-lg">
          <Icon name="map" size={26} /> Browse the map
        </Link>
      </div>
    </div>
  );
}
