import Link from "next/link";
import { Stars } from "@/components/Stars";
import { Icon, type IconName } from "@/components/icons";
import { criticStyle, type PassportStats } from "@/lib/badges";
import { crayon } from "@/lib/crayons";
import { formatStars } from "@/lib/rating";
import { SectionTitle } from "./bits";

type Member = { id: number; name: string; color: string; avatar: string };

/** A stat line. `emoji` is for an explorer's own avatar; UI rows use `icon`. */
function Row({
  icon,
  emoji,
  children,
}: {
  icon?: IconName;
  emoji?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span
        aria-hidden
        className="flex h-7 w-8 shrink-0 items-center justify-center text-2xl"
      >
        {icon ? <Icon name={icon} size={28} /> : emoji}
      </span>
      <span className="flex-1 text-[1.02rem] leading-snug">{children}</span>
    </li>
  );
}

export function FunStats({
  stats,
  members,
  townsExplored,
  townsTotal,
}: {
  stats: PassportStats;
  members: Member[];
  townsExplored: number;
  townsTotal: number;
}) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const big = (n: number | string) => (
    <b className="font-sketch text-[1.3rem] font-bold">{n}</b>
  );
  return (
    <section aria-labelledby="stats-h">
      <SectionTitle icon="confetti" color="#8a5cc6">
        <span id="stats-h">Fun stats</span>
      </SectionTitle>
      <ul className="doodle-box-alt divide-y-2 divide-dashed divide-ink/15 px-3 py-1">
        <Row icon="playground">
          {big(stats.totalVisits)} trip{stats.totalVisits === 1 ? "" : "s"} to
          the park
        </Row>
        <Row icon="map">
          {big(townsExplored)} of {townsTotal} towns explored
        </Row>
        <Row icon={stats.monthStreak >= 2 ? "flame" : "calendar"}>
          {stats.thisMonth > 0 ? (
            <>
              {big(stats.thisMonth)} park{stats.thisMonth === 1 ? "" : "s"} this
              month
              {stats.monthStreak >= 2 && (
                <> · {stats.monthStreak}-month streak!</>
              )}
            </>
          ) : stats.streakAtRisk ? (
            <>
              {stats.monthStreak >= 2
                ? `${stats.monthStreak}-month streak on the line!`
                : "Nothing yet this month."}{" "}
              Squeeze one in?
            </>
          ) : (
            <>Nothing yet this month. Perfect day for a spin!</>
          )}
        </Row>
        {stats.favorite ? (
          <Row icon="heart">
            Crew favorite:{" "}
            <Link
              href={`/parks/${stats.favorite.slug}`}
              className="font-hand text-xl underline decoration-crayon-yellow decoration-4 underline-offset-2"
            >
              {stats.favorite.name}
            </Link>{" "}
            <Stars tenths={stats.favorite.avgTenths} size={14} />
          </Row>
        ) : (
          <Row icon="heart">No favorite yet. Rate a park to crown one!</Row>
        )}
        {stats.critics.map((c) => {
          const m = byId.get(c.id);
          return (
            <Row
              key={c.id}
              icon={m?.avatar ? undefined : "crayon"}
              emoji={m?.avatar}
            >
              <b
                className="font-hand text-xl"
                style={{ color: m ? crayon(m.color) : undefined }}
              >
                {c.name}
              </b>{" "}
              {criticStyle(c.avgTenths)}: {big(formatStars(c.avgTenths))} avg
              over {c.reviews} review{c.reviews === 1 ? "" : "s"}
            </Row>
          );
        })}
      </ul>
    </section>
  );
}
