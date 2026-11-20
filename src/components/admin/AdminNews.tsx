"use client";

import { useState, useTransition } from "react";
import { ErrorLine } from "@/components/ErrorLine";
import { setNewsSwitch } from "@/lib/client-actions";

type IssueRow = {
  id: number;
  issueDate: string;
  status: string;
  subject: string | null;
  skipReason: string | null;
  dryRun: boolean;
  started: boolean;
  ok: boolean | null;
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
};

/** Bend Playground Passport: the two switches and the recent issues. */
export function AdminNews({
  paused,
  dryRun,
  textsPaused,
  textsDryRun,
  textsPausedReason,
  heartbeat,
  audience,
  issues,
}: {
  paused: boolean;
  dryRun: boolean;
  textsPaused: boolean;
  textsDryRun: boolean;
  textsPausedReason: string | null;
  /** When the Thursday sender last ran, as text. */
  heartbeat: string;
  /** Confirmed subscribers right now. */
  audience: number;
  issues: IssueRow[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-hand text-3xl">Bend Playground Passport</h2>
      <div className="doodle-box-alt flex flex-col gap-2 p-3">
        <Switch
          which="paused"
          on={paused}
          label="Kill switch"
          line={
            paused
              ? "On: nothing sends, and a send in progress stops."
              : "Off: Thursday's issue sends as usual."
          }
        />
        <Switch
          which="dryRun"
          on={dryRun}
          label="Dry run"
          line={
            dryRun
              ? "On: each issue goes only to ALERT_EMAIL, labeled."
              : "Off: each issue goes to every confirmed subscriber."
          }
        />
        <h3 className="mt-2 font-hand text-2xl">Weekend Pick (Friday texts)</h3>
        <Switch
          which="textsPaused"
          on={textsPaused}
          label="Texts kill switch"
          line={
            textsPaused
              ? `On: no Weekend Pick goes out.${textsPausedReason ? ` ${textsPausedReason}` : ""}`
              : "Off: Friday's Weekend Pick sends as usual."
          }
        />
        <Switch
          which="textsDryRun"
          on={textsDryRun}
          label="Texts dry run"
          line={
            textsDryRun
              ? "On: the Weekend Pick goes only to admins' numbers (or the log)."
              : "Off: it goes to every confirmed number."
          }
        />
        <p className="text-sm text-ink-soft">
          {audience} confirmed {audience === 1 ? "subscriber" : "subscribers"}.
          Sender last ran {heartbeat}.
        </p>
      </div>
      {issues.length === 0 ? (
        <p className="text-sm text-ink-soft">No issues yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {issues.map((i) => (
            <li key={i.id} className="doodle-box p-3 text-sm">
              <p className="flex items-baseline justify-between gap-2">
                <b>{i.issueDate}</b>
                <span className="chip text-xs">
                  {i.status === "draft" && i.started
                    ? "sending"
                    : i.status === "draft" && i.dryRun
                      ? "draft (dry run sent)"
                      : i.status}
                </span>
              </p>
              {i.subject ? <p className="truncate">{i.subject}</p> : null}
              {i.skipReason ? (
                <p className="text-ink-soft">{i.skipReason.split("\n")[0]}</p>
              ) : null}
              {i.status === "draft" && i.ok === false ? (
                <p className="text-ink-soft">Last check failed.</p>
              ) : null}
              {i.started || i.status === "sent" ? (
                <p className="text-ink-soft">
                  {i.sent} sent · {i.queued} queued · {i.failed} failed ·{" "}
                  {i.skipped} stopped first
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Switch({
  which,
  on,
  label,
  line,
}: {
  which: "paused" | "dryRun" | "textsPaused" | "textsDryRun";
  on: boolean;
  label: string;
  line: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          className="size-6"
          checked={on}
          disabled={pending}
          onChange={(e) =>
            start(async () => {
              setError(null);
              const r = await setNewsSwitch(which, e.target.checked);
              if (!r.ok) setError(r.error);
            })
          }
        />
        <span className="font-hand text-xl">{label}</span>
      </label>
      <p className="text-sm text-ink-soft">{line}</p>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </div>
  );
}
