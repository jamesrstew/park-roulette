/** Why someone reported a review. "my_kid" hides it right away. */
export const REPORT_REASONS = ["my_kid", "not_ok", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_LABELS: Record<ReportReason, string> = {
  my_kid: "It shows my kid",
  not_ok: "Not okay for kids",
  spam: "Spam or not a real visit",
  other: "Something else",
};
