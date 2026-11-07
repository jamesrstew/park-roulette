import { crayon } from "@/lib/crayons";

/** Light crayons need ink text on top; the rest read fine in white. */
export function inkOn(color: string) {
  return color === "yellow" || color === "orange" ? "#2b2a33" : "#ffffff";
}

/**
 * A "HELLO my name is" sticker: the explorer's badge everywhere in
 * onboarding and on /me. Pure presentational, so it can live-preview a form.
 */
export function NameTag({
  name,
  color,
  avatar,
  crewName,
  tilt = -2,
  className = "",
}: {
  name: string;
  color: string;
  avatar: string;
  crewName?: string;
  tilt?: number;
  className?: string;
}) {
  const hex = crayon(color);
  return (
    <div
      className={`relative mx-auto w-full max-w-[18rem] ${className}`}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <span
        className="tape -top-3 left-1/2 z-10 -translate-x-1/2 rotate-[3deg]"
        aria-hidden
      />
      <div className="doodle-box overflow-hidden shadow-[4px_5px_0_#2b2a33]">
        <div
          className="wax px-4 pt-2 pb-1.5 text-center transition-colors duration-300"
          style={{ backgroundColor: hex, color: inkOn(color) }}
        >
          <p className="font-hand text-3xl leading-none">HELLO</p>
          <p className="font-hand text-lg leading-tight">my name is</p>
        </div>
        <div className="flex min-h-24 items-center gap-3 px-4 py-3">
          <span
            key={avatar}
            className="grid size-16 shrink-0 animate-pop-in place-items-center rounded-[var(--radius-blob)] border-[2.5px] border-ink text-4xl"
            style={{
              backgroundColor: `color-mix(in srgb, ${hex} 30%, #fffdf7)`,
            }}
            aria-hidden
          >
            {avatar}
          </span>
          {name.trim() ? (
            <span
              className="highlight min-w-0 font-hand text-4xl break-words"
              style={{ ["--hl" as string]: hex }}
            >
              {name.trim()}
            </span>
          ) : (
            <span className="font-hand text-4xl text-ink-soft/50">You!</span>
          )}
        </div>
        {crewName ? (
          <p className="border-t-2 border-dashed border-ink/25 px-4 py-1.5 text-center font-hand text-lg text-ink-soft">
            Crew: <span className="text-ink">{crewName}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A round buddy blob with the avatar inside, in the explorer's crayon. */
export function AvatarBlob({
  avatar,
  color,
  size = "md",
}: {
  avatar: string;
  color: string;
  size?: "sm" | "md" | "lg";
}) {
  const s =
    size === "lg"
      ? "size-20 text-5xl"
      : size === "sm"
        ? "size-10 text-2xl"
        : "size-14 text-3xl";
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-[var(--radius-blob)] border-[2.5px] border-ink ${s}`}
      style={{
        backgroundColor: `color-mix(in srgb, ${crayon(color)} 35%, #fffdf7)`,
        boxShadow: `2px 3px 0 ${crayon(color)}`,
      }}
      aria-hidden
    >
      {avatar}
    </span>
  );
}
