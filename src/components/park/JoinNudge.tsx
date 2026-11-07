import Link from "next/link";

/** The friendly "you need to join first" card for signed-out visitors. */
export function JoinNudge({
  emoji = "🖍️",
  line = "Join to add your stars!",
  onClose,
}: {
  emoji?: string;
  line?: string;
  onClose?: () => void;
}) {
  return (
    <div className="doodle-box flex animate-pop-in items-center gap-3 bg-[color-mix(in_srgb,var(--color-crayon-purple)_10%,#fffdf7)] p-3">
      <span className="animate-float text-4xl" aria-hidden>
        {emoji}
      </span>
      <div className="flex-1">
        <p className="font-hand text-xl leading-tight">{line}</p>
        <p className="text-sm text-ink-soft">
          It takes ten seconds. No passwords.
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Link
          href="/me"
          className="crayon-btn wax min-h-11 bg-crayon-purple px-3 text-lg text-white [text-shadow:1px_1px_0_#2b2a33]"
        >
          Join
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
