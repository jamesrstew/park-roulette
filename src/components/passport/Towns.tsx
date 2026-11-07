import Link from "next/link";
import { CROSS_OFF_ICONS, Icon } from "@/components/icons";
import { crayon, townCrayon } from "@/lib/crayons";
import type { PassportPark } from "@/lib/data-passport";
import { CROSS_OFF_REASONS, hasPlayground, isCrossedOff } from "@/lib/features";
import { ScribbleBar, SectionTitle } from "./bits";

type Town = {
  name: string;
  /** Playgrounds: these are what the bar counts. */
  parks: PassportPark[];
  /** Parks without a playground: listed as a bonus, not counted. */
  extras: PassportPark[];
  colored: number;
  crossed: number;
};

export function Towns({
  parks,
  visitedIds,
}: {
  parks: PassportPark[];
  visitedIds: Set<number>;
}) {
  const map = new Map<string, Town>();
  for (const p of parks) {
    const t = map.get(p.city) ?? {
      name: p.city,
      parks: [],
      extras: [],
      colored: 0,
      crossed: 0,
    };
    map.set(p.city, t);
    if (!hasPlayground(p)) {
      t.extras.push(p);
      continue;
    }
    t.parks.push(p);
    if (isCrossedOff(p)) t.crossed++;
    else if (visitedIds.has(p.id)) t.colored++;
  }
  // A town with only grassy parks has no playgrounds to count.
  const towns = [...map.values()]
    .filter((t) => t.parks.length > 0)
    .sort(
      (a, b) => b.parks.length - a.parks.length || a.name.localeCompare(b.name),
    );
  const explored = towns.filter((t) => t.colored > 0).length;

  return (
    <section aria-labelledby="towns-h">
      <SectionTitle
        icon="home"
        color="#3aa35b"
        aside={
          <span className="pb-2 font-hand text-lg text-ink-soft">
            {explored} of {towns.length} explored
          </span>
        }
      >
        <span id="towns-h">Towns</span>
      </SectionTitle>

      <ul className="flex flex-col gap-1.5">
        {towns.map((t) => {
          const done = t.colored + t.crossed;
          const all = done === t.parks.length;
          const rows = [
            ...t.parks.map((p) => ({ p, extra: false })),
            ...t.extras.map((p) => ({ p, extra: true })),
          ];
          const color = crayon(townCrayon(t.name));
          return (
            <li key={t.name}>
              <details className="group doodle-box-alt overflow-hidden">
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-1 [&::-webkit-details-marker]:hidden">
                  <span className="w-[7.5rem] shrink-0 truncate font-hand text-xl leading-tight">
                    {t.name}
                    {all && (
                      <Icon
                        name="crown"
                        size={20}
                        title="every playground done"
                        className="ml-1 inline-block -rotate-6 align-[-2px]"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <ScribbleBar
                      done={t.colored}
                      crossed={t.crossed}
                      total={t.parks.length}
                      color={color}
                    />
                  </span>
                  <span className="w-11 shrink-0 text-right font-hand text-lg text-ink-soft">
                    {done}/{t.parks.length}
                  </span>
                  <span
                    aria-hidden
                    className="font-hand text-xl transition-transform group-open:rotate-90"
                  >
                    ›
                  </span>
                </summary>

                <ul className="border-t-2 border-dashed border-ink/20 px-2 py-1">
                  {rows.map(({ p, extra }) => {
                    const crossed = isCrossedOff(p);
                    const been = visitedIds.has(p.id);
                    const reason =
                      CROSS_OFF_REASONS[
                        p.status as keyof typeof CROSS_OFF_REASONS
                      ];
                    return (
                      <li key={p.id}>
                        <Link
                          href={`/parks/${p.slug}`}
                          className="flex min-h-11 items-center gap-3 rounded-lg px-1 active:bg-paper-dark"
                        >
                          <CheckBox
                            state={crossed ? "x" : been ? "y" : "n"}
                            color={color}
                          />
                          <span
                            className={`flex-1 leading-tight ${crossed ? "text-ink-soft line-through decoration-2" : extra ? "text-ink-soft" : ""}`}
                          >
                            {p.name}
                          </span>
                          {extra && !crossed && (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 text-sm text-ink-soft"
                              title="A park without a playground. Bonus!"
                            >
                              <Icon name="park" size={18} /> bonus
                            </span>
                          )}
                          {crossed && reason && (
                            <Icon
                              name={
                                CROSS_OFF_ICONS[
                                  p.status as keyof typeof CROSS_OFF_ICONS
                                ]
                              }
                              size={20}
                              title={reason.label}
                              className="opacity-70"
                            />
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A drawn box: empty, checked in crayon, or crossed off in pencil. */
function CheckBox({ state, color }: { state: "y" | "n" | "x"; color: string }) {
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" aria-hidden>
      <path
        d="M4 5 C 10 3, 18 4, 24 4 C 25 10, 24 18, 24 24 C 17 25, 10 24, 4 24 C 3 17, 4 10, 4 5 Z"
        fill={state === "y" ? `${color}33` : "none"}
        stroke="#2b2a33"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {state === "y" && (
        <path
          d="M7 14 L12 20 L26 3"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#crayon)"
        />
      )}
      {state === "x" && (
        <path
          d="M8 8 L20 20 M20 8 L8 20"
          fill="none"
          stroke="#5d5a6b"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      )}
      <title>
        {state === "y"
          ? "Colored in"
          : state === "x"
            ? "Crossed off"
            : "Not yet"}
      </title>
    </svg>
  );
}
