import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * Who can see a review. Stars and report-card tags always count toward a
 * park's scores (anonymously); the review itself follows these rules.
 *
 *   public:  the words and stars show to everyone, even signed out.
 *            Photos still only show to signed-in families.
 *   members: signed-in families only
 *   family:  just the author's family
 *
 * Also:
 *   - Photos are never shown to people who aren't signed in, whatever the
 *     review says (they're often of kids).
 *   - Videos only show to the author's family (they can hold the place they
 *     were filmed, which we can't strip in the browser).
 *   - Another family's review waits an hour before it shows, so nothing on
 *     Park Roulette says where a family is right now.
 *   - Hidden reviews (reported) only show to the author's family.
 *   - Admins get no extra reach here. They see reported reviews on /admin.
 */
export const VISIBILITIES = ["public", "members", "family"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const DEFAULT_VISIBILITY: Visibility = "members";

/** Another family's review (or its latest edit) shows this long after. */
export const SHOW_AFTER_MS = 60 * 60 * 1000;

export const VISIBILITY_LABELS: Record<
  Visibility,
  { label: string; short: string; line: string; icon: "sun" | "heart" | "lock" }
> = {
  public: {
    label: "Everyone",
    short: "Everyone",
    line: "Anyone can read it. Photos still only show to signed-in families.",
    icon: "sun",
  },
  members: {
    label: "Signed-in families",
    short: "Families",
    line: "Families signed in to Park Roulette can see it.",
    icon: "heart",
  },
  family: {
    label: "Just our family",
    short: "Just us",
    line: "A private note for your family's passport.",
    icon: "lock",
  },
};

export function isVisibility(v: unknown): v is Visibility {
  return (
    typeof v === "string" && (VISIBILITIES as readonly string[]).includes(v)
  );
}

/** Who's looking: their family, or null when signed out. */
export type Viewer = { crewId: number } | null;

export function viewerOf(me: { crew: { id: number } } | null): Viewer {
  return me ? { crewId: me.crew.id } : null;
}

export type ReviewAccess = {
  visibility: string;
  hidden: boolean;
  crewId: number;
  createdAt: Date;
  /** Bumped by every save, so new words or photos wait an hour too. */
  updatedAt?: Date;
};

const lastChange = (r: ReviewAccess) =>
  Math.max(r.createdAt.getTime(), r.updatedAt?.getTime() ?? 0);

export function canSee(
  viewer: Viewer,
  review: ReviewAccess,
  now = Date.now(),
): boolean {
  if (viewer && viewer.crewId === review.crewId) return true;
  if (review.hidden) return false;
  if (now - lastChange(review) < SHOW_AFTER_MS) return false;
  if (review.visibility === "public") return true;
  return !!viewer && review.visibility === "members";
}

export function canSeeMedia(
  viewer: Viewer,
  review: ReviewAccess,
  kind: string,
  now = Date.now(),
): boolean {
  if (!viewer || !canSee(viewer, review, now)) return false;
  return kind === "image" || viewer.crewId === review.crewId;
}

/**
 * The same rule as `canSee`, as SQL, for queries over reviews. `crewId` is
 * the author's crew column (explorers.crew_id).
 */
export function visibleSql(
  viewer: Viewer,
  cols: {
    visibility: SQLWrapper;
    hiddenAt: SQLWrapper;
    createdAt: SQLWrapper;
    updatedAt: SQLWrapper;
    crewId: SQLWrapper;
  },
): SQL {
  const open = viewer
    ? sql`${cols.visibility} in ('public', 'members')`
    : sql`${cols.visibility} = 'public'`;
  const settled = sql`greatest(${cols.createdAt}, ${cols.updatedAt}) < now() - make_interval(secs => ${SHOW_AFTER_MS / 1000})`;
  const others = sql`(${cols.hiddenAt} is null and ${settled} and ${open})`;
  return viewer
    ? sql`(${cols.crewId} = ${viewer.crewId} or ${others})`
    : others;
}

/** Where a browser fetches a photo: our door, never the storage address. */
export function mediaSrc(id: number): string {
  return `/photos/${id}`;
}
