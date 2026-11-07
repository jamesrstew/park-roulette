"use client";

import type { SVGProps } from "react";
import { ALIASES, DRAWINGS } from "./drawings";
import { compile, type Mark } from "./kit";

export type DrawingName = keyof typeof DRAWINGS;
export type IconName = DrawingName | keyof typeof ALIASES;

export const ICON_NAMES = Object.keys(DRAWINGS) as DrawingName[];

export function isIconName(name: string): name is IconName {
  // hasOwn, not `in`: "constructor" or "toString" are not icons.
  return Object.hasOwn(DRAWINGS, name) || Object.hasOwn(ALIASES, name);
}

/** At or below this size, crayon zigzags become a flat wash (lighter pages). */
const LITE_SIZE = 22;

const cache = new Map<DrawingName, Mark[]>();

function marksFor(name: IconName): Mark[] {
  const key: DrawingName = Object.hasOwn(ALIASES, name)
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
 * A hand-drawn crayon icon. Pass `title` when the icon is the only label.
 *
 * It's a client component on purpose: from a server component, React then
 * sends just {name, size} instead of the whole drawing a second time in the
 * page data. No hooks, no filters; paths are computed once per icon and cached.
 */
export function Icon({ name, size = 28, title, ...rest }: Props) {
  const lite = size <= LITE_SIZE;
  const marks = lite ? marksFor(name).filter((m) => !m.zig) : marksFor(name);
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
      {title ? <title>{title}</title> : null}
      {marks.map((m, i) => (
        <path
          key={i}
          d={m.d}
          fill={m.fill ?? "none"}
          fillRule={m.rule}
          stroke={m.stroke}
          strokeWidth={m.sw}
          strokeDasharray={m.dash}
          opacity={lite && m.wash ? 0.8 : m.opacity}
          transform={m.t}
        />
      ))}
    </svg>
  );
}
