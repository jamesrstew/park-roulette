/** Ratings are stored as integer tenths (0..50) and shown as "4.3". */
export function toTenths(stars: number): number {
  if (!Number.isFinite(stars)) throw new Error("rating must be a number");
  const t = Math.round(stars * 10);
  return Math.min(50, Math.max(0, t));
}

export function formatStars(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

export function averageTenths(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** A playful verdict for a score. */
export function verdict(tenths: number): string {
  if (tenths >= 48) return "Legendary!!";
  if (tenths >= 43) return "So so good";
  if (tenths >= 38) return "Super fun";
  if (tenths >= 30) return "Pretty good";
  if (tenths >= 20) return "It's okay";
  if (tenths >= 10) return "Meh";
  return "Nope";
}
