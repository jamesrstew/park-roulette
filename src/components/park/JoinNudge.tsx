"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";

/**
 * The friendly "hop in first" card for signed-out visitors. Works for both
 * returning explorers (sign in with your phone) and new ones (invite link),
 * and brings you back to this page afterward.
 */
export function JoinNudge({
  icon = "crayon",
  line = "Hop in to add your stars!",
  onClose,
}: {
  icon?: IconName;
  line?: string;
  onClose?: () => void;
}) {
  const path = usePathname();
  return (
    <div className="doodle-box flex animate-pop-in items-center gap-3 bg-[color-mix(in_srgb,var(--color-crayon-purple)_10%,#fffdf7)] p-3">
      <span className="animate-float">
        <Icon name={icon} size={42} />
      </span>
      <div className="flex-1">
        <p className="font-hand text-xl leading-tight">{line}</p>
        <p className="text-sm text-ink-soft">
          New or played before, sign in with your phone. No passwords.
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Link
          href={`/me?next=${encodeURIComponent(path)}#signin`}
          className="crayon-btn wax min-h-11 bg-crayon-purple px-3 text-lg text-white [text-shadow:1px_1px_0_#2b2a33]"
        >
          Hop in
        </Link>
        {onClose && (
          <button
            type="button"
            className="min-h-8 px-1 text-sm text-ink-soft underline"
            onClick={onClose}
          >
            later
          </button>
        )}
      </div>
    </div>
  );
}
