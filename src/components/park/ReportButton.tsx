"use client";

import { useState, useTransition } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { toastNow } from "@/components/HelloToast";
import { Icon } from "@/components/icons";
import { reportReview } from "@/lib/client-actions";
import {
  REPORT_LABELS,
  REPORT_REASONS,
  type ReportReason,
} from "@/lib/reports";
import { sfx } from "@/lib/sound";

/** A quiet "Report" link under someone else's review. */
export function ReportButton({
  reviewId,
  hasPhotos,
}: {
  reviewId: number;
  hasPhotos: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reasons = REPORT_REASONS.filter((r) => r !== "my_kid" || hasPhotos);

  if (done)
    return (
      <p className="text-sm text-ink-soft">
        Thanks for telling us. We&apos;ll take a look.
      </p>
    );
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 self-end px-1 text-sm text-ink-soft underline underline-offset-2"
      >
        Report
      </button>
    );
  const send = (reason: ReportReason) =>
    start(async () => {
      setError(null);
      const r = await reportReview({ reviewId, reason });
      if (!r.ok) return (sfx.oops(), setError(r.error));
      setDone(true);
      toastNow(
        r.hidden
          ? "Hidden while we take a look."
          : "Thanks! We'll take a look.",
      );
    });
  return (
    <div className="flex animate-pop-in flex-col gap-2 border-t-2 border-dashed border-ink/15 pt-3">
      <p className="flex items-center gap-2 font-hand text-xl">
        <Icon name="warning" size={24} /> What&apos;s wrong?
      </p>
      {reasons.map((r) => (
        <button
          key={r}
          type="button"
          disabled={pending}
          onClick={() => send(r)}
          className="chip min-h-11 justify-start text-lg"
        >
          {REPORT_LABELS[r]}
        </button>
      ))}
      {hasPhotos && (
        <p className="text-xs leading-snug text-ink-soft">
          &ldquo;It shows my kid&rdquo; hides it right away.
        </p>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="min-h-11 self-start text-sm text-ink-soft underline"
      >
        Never mind
      </button>
    </div>
  );
}
