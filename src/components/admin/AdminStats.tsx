import type { AdminStats as Stats } from "@/lib/data-admin";

/** The numbers James checks: the family funnel, two weeks, today's texts. */
export function AdminStats({
  stats,
  budgets,
}: {
  stats: Stats;
  budgets: { known: number; unknown: number };
}) {
  const f = stats.funnel;
  const pct = (n: number) =>
    f.families ? `${Math.round((n / f.families) * 100)}%` : "–";
  const steps: [string, number][] = [
    ["Families", f.families],
    ["Stamped a park", f.stamped],
    ["Stamped 3+ parks", f.stamped3],
    ["Wrote a review", f.reviewed],
    ["Added someone", f.grew],
  ];
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-hand text-3xl">How it&apos;s going</h2>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ["New today", f.families1],
          ["New this week", f.families7],
          ["Grown-ups with a number", `${f.withNumber}/${f.grownups}`],
        ].map(([label, n]) => (
          <div key={label} className="doodle-box p-2">
            <p className="font-hand text-3xl">{n}</p>
            <p className="text-xs leading-tight text-ink-soft">{label}</p>
          </div>
        ))}
      </div>

      <div className="doodle-box-alt p-3">
        <h3 className="mb-2 font-hand text-xl">Family funnel (all time)</h3>
        <ol className="flex flex-col gap-1.5">
          {steps.map(([label, n]) => (
            <li key={label} className="flex items-center gap-2 text-sm">
              <span className="w-32 shrink-0">{label}</span>
              <span className="h-3 flex-1 overflow-hidden rounded-full bg-ink/10">
                <span
                  className="block h-full rounded-full bg-crayon-green"
                  style={{
                    width: f.families ? `${(n / f.families) * 100}%` : 0,
                  }}
                />
              </span>
              <span className="w-16 text-right tabular-nums">
                {n} <span className="text-ink-soft">{pct(n)}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-ink-soft">
          {f.stamps} stamps · {f.reviews} reviews · {f.photos} photos · {f.kids}{" "}
          kids
        </p>
      </div>

      <div className="doodle-box-alt p-3 text-sm">
        <h3 className="mb-1 font-hand text-xl">Sign-in texts, last 24 hours</h3>
        <p>
          New numbers: {stats.texts.unknown} of {budgets.unknown} · Sign-ins:{" "}
          {stats.texts.known} of {budgets.known}
        </p>
      </div>

      <div className="doodle-box-alt overflow-x-auto p-3">
        <h3 className="mb-1 font-hand text-xl">Last two weeks</h3>
        <table className="w-full text-left text-sm tabular-nums">
          <thead>
            <tr className="text-ink-soft">
              <th scope="col" className="py-1 font-normal">
                Day
              </th>
              <th scope="col" className="py-1 font-normal">
                Families
              </th>
              <th scope="col" className="py-1 font-normal">
                Stamps
              </th>
              <th scope="col" className="py-1 font-normal">
                Reviews
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.days.map((d) => (
              <tr key={d.day} className="border-t border-ink/10">
                <td className="py-1">{d.day}</td>
                <td className="py-1">{d.families}</td>
                <td className="py-1">{d.stamps}</td>
                <td className="py-1">{d.reviews}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-soft">
        Taps and spins live in Vercel → Analytics → Events.
      </p>
    </section>
  );
}
