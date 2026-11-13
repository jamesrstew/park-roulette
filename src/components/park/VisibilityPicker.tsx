"use client";

import { Icon } from "@/components/icons";
import {
  VISIBILITIES,
  VISIBILITY_LABELS,
  type Visibility,
} from "@/lib/visibility";

/** "Who sees your words?" Three big choices (stars are always public), the safe one picked to start. */
export function VisibilityPicker({
  value,
  onChange,
  isKid = false,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  /** Kids' reviews stay with signed-in families (no "Everyone"). */
  isKid?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-2"
      role="radiogroup"
      aria-label="Who can see your words and photos?"
    >
      {VISIBILITIES.filter((v) => !isKid || v !== "public").map((v) => {
        const on = v === value;
        const l = VISIBILITY_LABELS[v];
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v)}
            className={`chip min-h-14 items-start justify-start gap-3 py-2 text-left ${on ? "bg-crayon-yellow/40 shadow-[2px_2px_0_#2b2a33]" : ""}`}
          >
            <Icon name={l.icon} size={28} className="mt-0.5 shrink-0" />
            <span className="flex flex-col">
              <span className="font-hand text-xl leading-tight">{l.label}</span>
              <span className="text-sm leading-snug text-ink-soft">
                {l.line}
              </span>
            </span>
          </button>
        );
      })}
      <p className="text-xs leading-snug text-ink-soft">
        Your stars always show to everyone and count toward the park&apos;s
        score. This picks who sees your words and photos.
      </p>
    </div>
  );
}

/** A small tag on your own review: who can see it. */
export function VisibilityTag({ value }: { value: string }) {
  const l = VISIBILITY_LABELS[value as Visibility];
  if (!l) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
      <Icon name={l.icon} size={16} /> {l.short}
    </span>
  );
}
