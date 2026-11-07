import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Lost!", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-5xl">This page wandered off</h1>
      <p className="max-w-xs font-hand text-xl text-ink-soft">
        We looked under every slide. Let&apos;s find you a playground instead.
      </p>
      <Link href="/" className="crayon-btn wax bg-crayon-green text-white">
        Spin the wheel
      </Link>
    </div>
  );
}
