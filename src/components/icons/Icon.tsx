import type { SVGProps } from "react";
import { ALIASES, DRAWINGS } from "./drawings";
import { compile, type Mark } from "./kit";

export type DrawingName = keyof typeof DRAWINGS;
export type IconName = DrawingName | keyof typeof ALIASES;

export const ICON_NAMES = Object.keys(DRAWINGS) as DrawingName[];

export function isIconName(name: string): name is IconName {
  return name in DRAWINGS || name in ALIASES;
}

const cache = new Map<DrawingName, Mark[]>();

function marksFor(name: IconName): Mark[] {
  const key: DrawingName =
    name in ALIASES
      ? ALIASES[name as keyof typeof ALIASES]
      : (name as DrawingName);
  let marks = cache.get(key);
  if (!marks) {
    marks = compile(key, DRAWINGS[key]);
    cache.set(key, marks);
  }
  return marks;
}

type Props = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: IconName;
  /** Rendered size in px (default 28). */
  size?: number;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  title?: string;
};

/**
 * A hand-drawn crayon icon. Server-component friendly: no hooks, no client
 * JS, no filters. Pass `title` when the icon is the only label.
 */
export function Icon({ name, size = 28, title, ...rest }: Props) {
  const marks = marksFor(name);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      data-icon={name}
      {...rest}
      style={{ overflow: "visible", flexShrink: 0, ...rest.style }}
    >
      {marks.map((m, i) => (
        <path
          key={i}
          d={m.d}
          fill={m.fill ?? "none"}
          fillRule={m.rule}
          stroke={m.stroke}
          strokeWidth={m.sw}
          strokeDasharray={m.dash}
          opacity={m.opacity}
          transform={m.t}
        />
      ))}
    </svg>
  );
}
