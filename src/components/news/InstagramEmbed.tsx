"use client";

/* eslint-disable @next/next/no-img-element -- our own stored card image */
import { useEffect, useState } from "react";

declare global {
  interface Window {
    instgrm?: { Embeds: { process: () => void } };
  }
}

/**
 * Parents' corner on web issue pages: our stored card image of the post
 * (from our own domain), linked to it, and a "Load from Instagram" button.
 * Only a tap loads Instagram's official embed (embed.js), so nothing
 * reaches Instagram unless the reader asks for it.
 */
export function InstagramEmbed({
  permalink,
  username,
  image,
}: {
  permalink: string;
  username: string;
  image: { src: string; width: number; height: number; alt: string } | null;
}) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    if (window.instgrm) return window.instgrm.Embeds.process();
    const s = document.createElement("script");
    s.src = "https://www.instagram.com/embed.js";
    s.async = true;
    s.onload = () => window.instgrm?.Embeds.process();
    document.body.appendChild(s);
  }, [loaded]);
  if (loaded)
    return (
      <blockquote
        className="instagram-media"
        data-instgrm-permalink={permalink}
        data-instgrm-version="14"
        style={{ maxWidth: 540, width: "100%", margin: "0 auto" }}
      >
        <a href={permalink}>A post shared by @{username} on Instagram</a>
      </blockquote>
    );
  return (
    <div className="flex flex-col items-center gap-2">
      {image ? (
        <a href={permalink} className="block w-full max-w-[600px]">
          <img
            src={image.src}
            width={image.width}
            height={image.height}
            alt={image.alt}
            className="h-auto w-full rounded-xl"
          />
        </a>
      ) : (
        <a href={permalink} className="underline">
          See @{username}&apos;s post on Instagram
        </a>
      )}
      <button
        type="button"
        onClick={() => setLoaded(true)}
        className="chip min-h-11"
      >
        Load from Instagram
      </button>
      <p className="text-center text-xs text-ink-soft">
        Loads Instagram&apos;s own player, which sees your IP address.
      </p>
    </div>
  );
}
