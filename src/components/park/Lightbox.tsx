"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";

export type MediaItem = { id: number | string; url: string; kind: string };

/** Full-screen photo/video viewer. Swipe, arrow keys, or the big buttons. */
export function Lightbox({
  items,
  start,
  onClose,
}: {
  items: MediaItem[];
  start: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(start);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const n = items.length;
  const go = (d: number) => {
    setDx(0);
    setI((cur) => (cur + d + n) % n);
  };

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((c) => (c + 1) % n);
      if (e.key === "ArrowLeft") setI((c) => (c - 1 + n) % n);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [n, onClose]);

  const item = items[i];
  return createPortal(
    <div
      className="fixed inset-0 z-[3000] flex flex-col bg-ink text-paper"
      role="dialog"
      aria-modal
      aria-label="Photos and videos"
    >
      <div className="flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <span className="font-hand text-xl">
          {n > 1 ? `${i + 1} of ${n}` : ""}
        </span>
        <button
          type="button"
          className="grid h-12 w-12 place-items-center rounded-full border-2 border-paper/70 text-2xl"
          aria-label="Close"
          onClick={onClose}
          autoFocus
        >
          ✕
        </button>
      </div>

      <div
        className="relative flex flex-1 touch-pan-y items-center justify-center overflow-hidden"
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && item.kind === "video") return;
          drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (drag.current?.id === e.pointerId)
            setDx(e.clientX - drag.current.x);
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          const moved = e.clientX - drag.current.x;
          const down = e.clientY - drag.current.y;
          drag.current = null;
          setDragging(false);
          if (n > 1 && Math.abs(moved) > 60) go(moved < 0 ? 1 : -1);
          else if (down > 120 && Math.abs(moved) < 60) onClose();
          else setDx(0);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          setDx(0);
        }}
      >
        <div
          key={item.id}
          className="flex h-full w-full animate-pop-in items-center justify-center p-3"
          style={{
            transform: `translateX(${dx}px) rotate(${dx / 40}deg)`,
            transition: dragging ? "none" : "transform 0.2s ease",
          }}
        >
          {item.kind === "video" ? (
            <video
              src={item.url}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full rounded-md border-4 border-white"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- Blob URLs, no image optimizer
            <img
              src={item.url}
              alt=""
              draggable={false}
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
              className="max-h-full max-w-full rounded-sm border-[6px] border-white object-contain select-none"
            />
          )}
        </div>
      </div>

      {n > 1 && (
        <div className="flex items-center justify-between gap-4 px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <button
            type="button"
            className="crayon-btn min-h-12 bg-paper px-5"
            aria-label="Previous"
            onClick={() => go(-1)}
          >
            <Icon name="arrow_left" size={26} />
          </button>
          <div className="flex gap-1.5" aria-hidden>
            {items.map((m, j) => (
              <span
                key={m.id}
                className={`h-2.5 w-2.5 rounded-full border border-paper ${j === i ? "bg-crayon-yellow" : ""}`}
              />
            ))}
          </div>
          <button
            type="button"
            className="crayon-btn min-h-12 bg-paper px-5"
            aria-label="Next"
            onClick={() => go(1)}
          >
            <Icon name="arrow_right" size={26} />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Thumbnails that open the lightbox. */
export function MediaGrid({ items }: { items: MediaItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!items.length) return null;
  const shown = items.slice(0, 6);
  const extra = items.length - shown.length;
  return (
    <>
      <ul className="grid grid-cols-3 gap-2">
        {shown.map((m, j) => (
          <li key={m.id} style={{ rotate: `${((j * 7) % 5) - 2}deg` }}>
            <button
              type="button"
              className="relative block aspect-square w-full overflow-hidden border-[3px] border-white bg-paper-dark shadow-[1px_2px_0_rgb(43_42_51/0.35)] outline-2 outline-ink/70"
              onClick={() => setOpen(j)}
              aria-label={`Open ${m.kind === "video" ? "video" : "photo"} ${j + 1}`}
            >
              {m.kind === "video" ? (
                <>
                  <video
                    src={`${m.url}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute inset-0 grid place-items-center">
                    <span className="grid h-10 w-10 place-items-center rounded-full border-2 border-ink bg-crayon-yellow pl-0.5 text-lg">
                      ▶
                    </span>
                  </span>
                </>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- Blob URLs, no image optimizer
                <img
                  src={m.url}
                  alt=""
                  loading="lazy"
                  onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                  className="h-full w-full object-cover"
                />
              )}
              {j === shown.length - 1 && extra > 0 && (
                <span className="absolute inset-0 grid place-items-center bg-ink/55 font-hand text-2xl text-white">
                  +{extra}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {open != null && (
        <Lightbox items={items} start={open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
