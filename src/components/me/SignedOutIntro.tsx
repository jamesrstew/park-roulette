import Link from "next/link";
import { PageTitle } from "@/components/PageTitle";
import { Pines } from "@/components/Scribbles";
import { PasteInvite } from "./PasteInvite";
import { DoodleGo, DoodleSpin, DoodleStamp } from "./Doodles";

const STEPS = [
  {
    Doodle: DoodleSpin,
    title: "Spin",
    line: "Give the crayon wheel a whirl. It picks a playground.",
    hl: "#f7c933",
  },
  {
    Doodle: DoodleGo,
    title: "Go",
    line: "Pile in the car and go play. Slides first, snacks after.",
    hl: "#1fa4a8",
  },
  {
    Doodle: DoodleStamp,
    title: "Stamp & rate",
    line: "Stamp your passport and give it stars. Tenths count!",
    hl: "#ee6aa7",
  },
];

/** /me when nobody's signed in: what this is, and how to get in. */
export function SignedOutIntro() {
  return (
    <div className="flex flex-col gap-7 pt-4">
      <PageTitle
        lead="Welcome to"
        accent="Park Roulette"
        color="red"
        underline="teal"
        underlineWidth="w-60"
        subtitle={
          <p className="mx-auto max-w-xs text-balance">
            Every playground in Central Oregon, one spin at a time.
          </p>
        }
      />

      <ol className="flex flex-col gap-4">
        {STEPS.map(({ Doodle, title, line, hl }, i) => (
          <li
            key={title}
            className={`${i % 2 ? "doodle-box-alt" : "doodle-box"} flex items-center gap-4 px-4 py-3`}
            style={{ rotate: `${[-1, 1, -0.5][i]}deg` }}
          >
            <Doodle className="size-20 shrink-0" />
            <div>
              <h2 className="text-3xl">
                <span className="mr-1 font-hand text-ink-soft">{i + 1}.</span>
                <span className="highlight" style={{ ["--hl" as string]: hl }}>
                  {title}
                </span>
              </h2>
              <p className="leading-snug">{line}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="doodle-box wax relative bg-crayon-yellow/40 px-5 py-5 text-center shadow-[3px_4px_0_#2b2a33]">
        <span
          className="tape -top-3 left-1/2 -translate-x-1/2 -rotate-2"
          aria-hidden
        />
        <h2 className="text-3xl">Want to play along?</h2>
        <p className="mt-1 leading-snug">
          Ask your crew for an invite link. Tap it and you&apos;re in. No
          passwords, promise.
        </p>
        <div className="mt-4">
          <PasteInvite />
        </div>
      </section>

      <section className="flex flex-col items-center gap-3 text-center">
        <p className="font-hand text-2xl leading-tight">
          Just looking? You can spin and read reviews without joining.
        </p>
        <Link
          href="/"
          className="crayon-btn wax w-full max-w-xs bg-crayon-orange"
        >
          Take it for a spin 🎡
        </Link>
      </section>

      <Pines className="mx-auto w-48 opacity-90" />
    </div>
  );
}
