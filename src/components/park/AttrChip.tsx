import type { ButtonHTMLAttributes } from "react";
import { ATTRIBUTES } from "@/lib/features";

const HEADS_UP_BG =
  "bg-[color-mix(in_srgb,var(--color-crayon-orange)_22%,#fffdf7)]";

/** A read-only report-card sticker: emoji, label, and how many critics said so. */
export function AttrSticker({
  k,
  count,
  fromMap,
  tilt = 0,
}: {
  k: string;
  /** Explorer reports. */
  count: number;
  /** Shown only because the map says so (not checked yet). */
  fromMap: boolean;
  tilt?: number;
}) {
  const a = ATTRIBUTES[k];
  if (!a) return null;
  const heads = a.kind === "heads_up";
  return (
    <li
      className={`chip text-[1.05rem] ${heads ? `${HEADS_UP_BG} border-crayon-red` : ""} ${fromMap ? "border-dashed border-ink/50 text-ink-soft" : ""}`}
      style={{ rotate: `${tilt}deg` }}
      title={
        fromMap
          ? "From the map. Might be wrong!"
          : `${count} critic${count === 1 ? "" : "s"} said so`
      }
    >
      <span aria-hidden>{a.emoji}</span>
      {a.label}
      {count > 1 && (
        <span
          className={`-mr-1 ml-0.5 rounded-full px-1.5 text-sm leading-5 font-bold text-white ${heads ? "bg-crayon-red" : "bg-ink"}`}
          aria-label={`${count} reports`}
        >
          ×{count}
        </span>
      )}
    </li>
  );
}

/** A tappable attribute chip for pickers. */
export function AttrToggle({
  k,
  on,
  hint,
  ...p
}: { k: string; on: boolean; hint?: boolean } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
>) {
  const a = ATTRIBUTES[k];
  if (!a) return null;
  const heads = a.kind === "heads_up";
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`chip relative min-h-11 text-[1.05rem] ${heads ? "border-crayon-red" : ""} ${heads && on ? "!bg-crayon-orange" : ""}`}
      {...p}
    >
      <span aria-hidden>{a.emoji}</span>
      {a.label}
      {hint && !on && (
        <span
          className="absolute -top-2 -right-1.5 rounded-full border-2 border-ink bg-white px-1 text-[0.7rem] leading-4"
          title="The map says it's here"
          aria-label="(on the map)"
        >
          🗺️
        </span>
      )}
    </button>
  );
}
