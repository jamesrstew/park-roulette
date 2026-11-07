"use client";

import confetti from "canvas-confetti";
import { useEffect, useRef, useState } from "react";
import type { Badge } from "@/lib/badges";
import { Icon } from "@/components/icons";
import { CRAYONS, crayon } from "@/lib/crayons";
import { tilt } from "./bits";
import { sfx } from "@/lib/sound";

/**
 * The sticker book. Earned stickers are peel-and-stick colorful; locked ones
 * are a pencil outline. A sticker the crew hasn't seen yet pops in (once) with
 * a little confetti when it scrolls into view. "Seen" lives in localStorage.
 */
export function StickerBook({
  badges,
  crewId,
}: {
  badges: Badge[];
  crewId: number;
}) {
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLUListElement>(null);
  const earnedIds = badges.filter((b) => b.earned).map((b) => b.id);
  const earnedKey = earnedIds.join(",");

  useEffect(() => {
    const key = `pr:stickers:${crewId}`;
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem(key) ?? "[]");
    } catch {}
    const ids = earnedKey ? earnedKey.split(",") : [];
    const newOnes = ids.filter((id) => !seen.includes(id));
    if (newOnes.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of what's been seen
    setFresh(new Set(newOnes));
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        setPlaying(true);
        localStorage.setItem(
          key,
          JSON.stringify([...new Set([...seen, ...ids])]),
        );
        const box = el.getBoundingClientRect();
        sfx.sticker();
        confetti({
          particleCount: 90,
          spread: 75,
          origin: {
            x: 0.5,
            y: Math.min(0.9, (box.top + 80) / window.innerHeight),
          },
          colors: Object.values(CRAYONS),
          scalar: 0.9,
          disableForReducedMotion: true,
        });
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [crewId, earnedKey]);

  return (
    <ul ref={ref} className="grid grid-cols-3 gap-x-2 gap-y-4">
      {badges.map((b, i) => (
        <Sticker
          key={b.id}
          b={b}
          i={i}
          fresh={fresh.has(b.id)}
          pop={playing && fresh.has(b.id)}
          delay={Math.min([...fresh].indexOf(b.id) * 0.08, 0.7)}
        />
      ))}
    </ul>
  );
}

function Sticker({
  b,
  i,
  fresh,
  pop,
  delay,
}: {
  b: Badge;
  i: number;
  fresh: boolean;
  pop: boolean;
  delay: number;
}) {
  const color = crayon(b.color);
  const rot = tilt(i + 3, 8);
  return (
    <li className="flex flex-col items-center text-center">
      <div
        className="relative"
        style={
          pop
            ? {
                animation: `pop-in 0.5s cubic-bezier(0.2,1.4,0.4,1) ${delay}s both`,
              }
            : undefined
        }
      >
        {b.earned ? (
          <div
            className="wax relative flex h-[5.25rem] w-[5.25rem] items-center justify-center rounded-[var(--radius-blob)] border-[4px] border-white text-[2.6rem]"
            style={{
              backgroundColor: color,
              transform: `rotate(${rot}deg)`,
              boxShadow: "0 0 0 2px #2b2a33, 3px 5px 0 2px rgb(43 42 51 / 0.2)",
            }}
          >
            <span
              aria-hidden
              className="drop-shadow-[1px_2px_0_rgb(0_0_0/0.15)]"
            >
              {b.icon ? <Icon name={b.icon} size={46} /> : b.emoji}
            </span>
            {/* Glossy sticker shine */}
            <span
              aria-hidden
              className="absolute top-2.5 left-3 h-2.5 w-6 -rotate-[35deg] rounded-full bg-white/45"
            />
          </div>
        ) : (
          <div
            className="relative flex h-[5.25rem] w-[5.25rem] items-center justify-center rounded-[var(--radius-blob)] border-[2.5px] border-dashed border-ink/35 text-[2.2rem]"
            style={{ transform: `rotate(${rot / 2}deg)` }}
          >
            <span aria-hidden className="opacity-25 grayscale">
              {b.icon ? <Icon name={b.icon} size={40} /> : b.emoji}
            </span>
            {b.progress && b.progress.need > 0 && (
              <span className="absolute -bottom-2 rounded-full border-[1.5px] border-ink/40 bg-paper px-1.5 font-hand text-sm leading-5 text-ink-soft">
                {b.progress.have}/{b.progress.need}
              </span>
            )}
          </div>
        )}
        {fresh && (
          <span className="absolute -top-2 -left-2 -rotate-12 rounded-md border-2 border-ink bg-crayon-yellow px-1 font-hand text-sm leading-5 shadow-[1px_1px_0_#2b2a33]">
            New!
          </span>
        )}
      </div>
      <span
        className={`mt-2 font-hand text-[1.1rem] leading-none ${b.earned ? "" : "text-ink-soft"}`}
      >
        {b.title}
      </span>
      <span className="mt-0.5 text-[0.72rem] leading-tight text-ink-soft">
        {b.line}
      </span>
      <span className="sr-only">{b.earned ? "Earned" : "Not yet"}</span>
    </li>
  );
}
