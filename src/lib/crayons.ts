/** The crayon box. Every color in the app comes from here. */
export const CRAYONS = {
  red: "#e5432f",
  orange: "#f58a2c",
  yellow: "#f7c933",
  green: "#3aa35b",
  teal: "#1fa4a8",
  blue: "#2f78d4",
  purple: "#8a5cc6",
  pink: "#ee6aa7",
  brown: "#9a6a3f",
} as const;

export type CrayonName = keyof typeof CRAYONS;
export const CRAYON_NAMES = Object.keys(CRAYONS) as CrayonName[];

export function crayon(name: string): string {
  return CRAYONS[name as CrayonName] ?? CRAYONS.blue;
}

/** Stable color per town so the map reads like a coloring book. */
export function townCrayon(city: string): CrayonName {
  let h = 0;
  for (const ch of city) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CRAYON_NAMES[h % CRAYON_NAMES.length];
}

export const AVATARS = [
  "🦖",
  "🐻",
  "🦊",
  "🐸",
  "🦄",
  "🐝",
  "🐙",
  "🦉",
  "🐢",
  "🐳",
  "🦋",
  "🐿️",
];
