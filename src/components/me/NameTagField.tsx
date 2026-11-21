"use client";

import { type Ref, useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { crayon } from "@/lib/crayons";
import { NameTag } from "./NameTag";

/** Names this long and up step the font down a size (two lines at most). */
export const NAME_STEP_AT = 14;

/** The name's size: smaller steps as it grows, so it stays on two lines. */
export function nameSize(name: string): string {
  const n = name.length;
  if (n >= 26) return "text-xl leading-[1.15]";
  if (n >= 20) return "text-2xl leading-[1.1]";
  if (n >= NAME_STEP_AT) return "text-[1.7rem] leading-[1.1]";
  return "text-4xl leading-[1.1]";
}

/** What saves when the family line is left empty: "Sam's Family". */
export function familyDefault(name: string): string {
  // Family names are 40 characters at most: a long name is cut to fit.
  const n = name
    .trim()
    .slice(0, FAMILY_MAX - SUFFIX.length)
    .trim();
  return n ? `${n}${SUFFIX}` : "";
}
const SUFFIX = "'s Family";
/** The family name's limit (the join and start actions take up to 40). */
export const FAMILY_MAX = 40;

/** Newlines out (Enter moves on; a paste can't make a second line). */
export function oneLine(v: string): string {
  return v.replace(/[\r\n]+/g, " ");
}

/**
 * The name tag as the field (batch 6): tap the tag and write on it. A
 * borderless one-row textarea that grows to two lines, with the highlight
 * painting under the letters as they're typed. Empty, it says "Tap to
 * write" with a pencil and wiggles once. On /start and friend links the
 * family line is a write-in too; on /join it's the family's name.
 */
export function NameTagField({
  name,
  onName,
  color,
  avatar,
  family,
  nameRef,
  familyRef,
  error,
  shake,
  nameHintId,
}: {
  name: string;
  onName: (v: string) => void;
  color: string;
  avatar: string;
  /** A write-in (start, friend links) or read-only (join). */
  family:
    | { kind: "write"; value: string; onChange: (v: string) => void }
    | { kind: "read"; name: string };
  nameRef: Ref<HTMLTextAreaElement>;
  familyRef?: Ref<HTMLInputElement>;
  /** The name is missing: the line turns red. */
  error: boolean;
  /** Bump to wiggle the tag again (an empty submit). */
  shake: number;
  /** The hint under the tag, for aria-describedby. */
  nameHintId: string;
}) {
  const id = useId();
  const hex = crayon(color);
  const [focus, setFocus] = useState<"name" | "family" | null>(null);
  // One wiggle when the page opens (the tag is empty then), and one per
  // empty submit. The Web Animations API replays it without remounting
  // the field (a remount would drop the focus). None with reduced motion.
  const wiggleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    wiggleRef.current?.animate?.(
      [
        { transform: "rotate(0)" },
        { transform: "rotate(-4deg)" },
        { transform: "rotate(4deg)" },
        { transform: "rotate(0)" },
      ],
      { duration: 500, easing: "ease-in-out" },
    );
  }, [shake]);
  // Empty, "Tap to write" has to fit one line beside the pencil.
  const size = name ? nameSize(name) : "text-[1.65rem] leading-[1.25]";
  const empty = !name;
  const line = error
    ? "border-crayon-red"
    : focus === "name"
      ? ""
      : "border-ink/30";

  const nameSlot = (
    <div className="relative min-w-0 flex-1">
      <div
        className={`grid border-b-[3px] border-dashed pb-1 ${line}`}
        style={focus === "name" && !error ? { borderColor: hex } : undefined}
      >
        {/* The highlight, under the letters (the textarea's twin). */}
        <span
          aria-hidden
          className={`pointer-events-none invisible col-start-1 row-start-1 font-hand break-words whitespace-pre-wrap ${size}`}
        >
          {name ? (
            <span
              className="highlight visible [box-decoration-break:clone] text-transparent"
              style={{ ["--hl" as string]: hex }}
            >
              {name}
            </span>
          ) : null}{" "}
        </span>
        <textarea
          ref={nameRef}
          id={`${id}-name`}
          rows={1}
          value={name}
          maxLength={40}
          aria-label="Hello, my name is"
          aria-describedby={nameHintId}
          aria-invalid={error || undefined}
          autoComplete="given-name"
          autoCapitalize="words"
          enterKeyHint="next"
          placeholder="Tap to write"
          onFocus={() => setFocus("name")}
          onBlur={() => setFocus(null)}
          onChange={(e) => onName(oneLine(e.target.value))}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            // Enter moves on: to the family line, or off the tag.
            if (family.kind === "write")
              document.getElementById(`${id}-family`)?.focus();
            else e.currentTarget.blur();
          }}
          className={`col-start-1 row-start-1 resize-none overflow-hidden border-0 bg-transparent p-0 font-hand break-words text-ink caret-ink outline-none placeholder:text-ink-soft ${size} ${empty ? "pr-7" : ""}`}
        />
      </div>
      {empty ? (
        <Icon
          name="pencil"
          size={26}
          className="pointer-events-none absolute top-1.5 right-0"
        />
      ) : null}
    </div>
  );

  const familySlot =
    family.kind === "write" ? (
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2">
        <span className="sr-only">Your family&apos;s name</span>
        <input
          ref={familyRef}
          id={`${id}-family`}
          value={family.value}
          maxLength={40}
          onChange={(e) => family.onChange(e.target.value)}
          onFocus={() => setFocus("family")}
          onBlur={() => setFocus(null)}
          placeholder={familyDefault(name) || "Your family name"}
          enterKeyHint="done"
          aria-describedby={`${id}-family-hint`}
          className="h-11 min-w-0 flex-1 border-0 border-b-2 border-dashed border-ink/25 bg-transparent font-hand text-lg text-ink outline-none placeholder:text-ink-soft/80 focus:border-ink/50"
        />
        <Icon name="pencil" size={20} className="shrink-0" />
        <span id={`${id}-family-hint`} className="sr-only">
          It shows on your reviews. You can change it later.
        </span>
      </label>
    ) : (
      <span className="text-ink">{family.name}</span>
    );

  return (
    <div className="flex flex-col gap-3">
      <div ref={wiggleRef}>
        <NameTag
          name={name}
          color={color}
          avatar={avatar}
          tilt={focus ? 0 : -2}
          outline={focus ? hex : undefined}
          nameSlot={nameSlot}
          familySlot={familySlot}
        />
      </div>
      <p
        id={nameHintId}
        className="mx-auto max-w-[19rem] text-center text-sm leading-snug text-ink-soft"
      >
        {focus === "family"
          ? "It shows on your reviews. You can change it later."
          : "What your family calls you, like “Mom” or “Sam.” Other families see it with your family name."}
      </p>
    </div>
  );
}
