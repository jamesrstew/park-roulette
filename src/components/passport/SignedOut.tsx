import Link from "next/link";
import { Icon } from "@/components/icons";
import { Arrow } from "@/components/Scribbles";
import { PageTitle } from "../PageTitle";

const PREVIEW = [
  { icon: "ticket", title: "First Stamp", color: "#f7c933", rot: -8 },
  { icon: "car", title: "Road Trip", color: "#2f78d4", rot: 6 },
  { icon: "splash_pad", title: "Splash Master", color: "#1fa4a8", rot: -3 },
] as const;

/** Signed out: what the passport is, and how to get one. Never a dead end. */
export function SignedOut() {
  return (
    <div className="flex flex-col gap-6 pt-2">
      <PageTitle
        lead="The"
        accent="Passport"
        color="purple"
        underline="orange"
        underlineWidth="w-44"
        subtitle={<p>One little book for your whole family.</p>}
      />

      {/* A peek inside: two stamps and a dashed "next one" */}
      <div className="doodle-box relative mx-2 rotate-[-1.5deg] px-4 pt-6 pb-5 shadow-[4px_5px_0_#2b2a33]">
        <span className="tape -top-3 left-1/2 -translate-x-1/2 rotate-[-4deg]" />
        <div className="grid grid-cols-3 gap-3">
          <FakeStamp
            town="Bend"
            name="Drake Park"
            date="JUN 8"
            color="#e5432f"
            round
          />
          <FakeStamp
            town="Sisters"
            name="Creekside"
            date="JUL 4"
            color="#2f78d4"
          />
          <div className="flex aspect-square rotate-6 items-center justify-center rounded-full border-[3px] border-dashed border-ink/25 p-2 text-center font-hand leading-tight text-ink-soft">
            Yours next!
          </div>
        </div>
        <ul className="mt-5 flex justify-around">
          {PREVIEW.map((s) => (
            <li key={s.title} className="flex flex-col items-center">
              <span
                className="wax flex h-14 w-14 items-center justify-center rounded-[var(--radius-blob)] border-[3px] border-white"
                style={{
                  backgroundColor: s.color,
                  transform: `rotate(${s.rot}deg)`,
                  boxShadow:
                    "0 0 0 2px #2b2a33, 2px 3px 0 1px rgb(43 42 51 / 0.2)",
                }}
                aria-hidden
              >
                <Icon name={s.icon} size={32} />
              </span>
              <span className="mt-1 font-hand text-sm">{s.title}</span>
            </li>
          ))}
        </ul>
      </div>

      <ul className="flex flex-col gap-3 px-1">
        {(
          [
            ["crayon", "Every playground you visit gets colored in."],
            ["stamp", "You get a stamp for each one, with the date."],
            [
              "star",
              "Earn stickers: road trips, splash pads, all four seasons…",
            ],
            ["heart", "Your family shares one passport, so every trip counts."],
          ] as const
        ).map(([icon, t]) => (
          <li
            key={t}
            className="flex items-start gap-3 text-[1.05rem] leading-snug"
          >
            <Icon name={icon} size={28} className="-mt-0.5" />
            {t}
          </li>
        ))}
      </ul>

      <div className="doodle-box-alt relative flex flex-col items-center gap-3 px-4 py-5 text-center">
        <h2 className="text-[1.7rem]">Want in?</h2>
        <p className="leading-snug text-ink-soft">
          Start your family&apos;s passport free, or sign in with your phone if
          you&apos;ve played before.
        </p>
        <Arrow className="absolute top-12 -left-1 h-10 w-14 -scale-x-100 rotate-[200deg] opacity-70" />
        <Link href="/start" className="crayon-btn wax w-full bg-crayon-yellow">
          <Icon name="sparkles" size={28} /> Start our family
        </Link>
        <Link
          href="/me?next=%2Fpassport#signin"
          className="crayon-btn w-full bg-paper text-xl"
        >
          <Icon name="phone" size={26} /> Sign in
        </Link>
        <Link
          href="/"
          className="flex min-h-11 items-center font-hand text-xl underline decoration-crayon-blue decoration-wavy decoration-2 underline-offset-4"
        >
          Or just spin the wheel →
        </Link>
      </div>
    </div>
  );
}

function FakeStamp({
  town,
  name,
  date,
  color,
  round,
}: {
  town: string;
  name: string;
  date: string;
  color: string;
  round?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={`relative flex aspect-square flex-col items-center justify-center border-[3px] p-1 text-center mix-blend-multiply ${round ? "-rotate-6 rounded-full" : "rotate-3 rounded-[10px]"}`}
      style={{ borderColor: color, color, filter: "url(#wobble)" }}
    >
      <div
        className={`absolute inset-1 border-[1.5px] border-dashed ${round ? "rounded-full" : "rounded-[8px]"}`}
        style={{ borderColor: color }}
      />
      <span className="text-[0.6rem] font-bold tracking-[0.15em] uppercase">
        {town}
      </span>
      <span className="font-hand leading-none">{name}</span>
      <span className="font-hand text-xs">{date}</span>
    </div>
  );
}
