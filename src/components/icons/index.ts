export {
  Icon,
  ICON_NAMES,
  isIconName,
  type DrawingName,
  type IconName,
} from "./Icon";
export { ALIASES } from "./drawings";
import type { IconName } from "./Icon";

/** Bottom nav tabs, by route. */
export const NAV_ICONS = {
  "/": "spin",
  "/map": "map",
  "/list": "list",
  "/passport": "passport",
  "/me": "me",
} as const satisfies Record<string, IconName>;

/** PLAY_TYPES keys → icon. */
export const PLAY_ICONS = {
  playground: "playground",
  nature: "nature",
  none: "park",
} as const satisfies Record<string, IconName>;

/** CROSS_OFF_REASONS keys → icon. */
export const CROSS_OFF_ICONS = {
  no_playground: "park",
  closed: "closed",
  private: "private",
} as const satisfies Record<string, IconName>;

/** SMART_FILTERS keys → icon. */
export const SMART_FILTER_ICONS = {
  littles: "toddler_area",
  splash: "splash_pad",
  dogs: "dog_friendly",
  potty: "restrooms",
  shade: "shade",
  safe: "safe",
} as const satisfies Record<string, IconName>;
