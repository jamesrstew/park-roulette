"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useRef, useState, useTransition } from "react";
import { saveReview } from "@/lib/actions";
import { CRAYONS } from "@/lib/crayons";
import type { ReviewView } from "@/lib/data";
import { ATTR_GROUPS, ATTRIBUTES } from "@/lib/features";
import { AttrToggle } from "./AttrChip";
import { CrayonProgress } from "./Doodles";
import { compressImage, formatMB, isVideo, safeName } from "./compress";
import { StarInput } from "../StarInput";

const MAX_NEW = 12;
const MAX_BYTES = 300 * 1024 * 1024;
const BAR_COLORS = [
  CRAYONS.green,
  CRAYONS.blue,
  CRAYONS.pink,
  CRAYONS.orange,
  CRAYONS.purple,
  CRAYONS.teal,
];

type Upload = {
  key: string;
  file: File;
  kind: "image" | "video";
  preview: string;
  status: "prep" | "uploading" | "done" | "error";
  pct: number;
  url?: string;
  error?: string;
};

export function ReviewComposer({
  parkId,
  parkFeatures,
  initial,
  firstCritic,
  startStars = null,
  onCancel,
  onSaved,
}: {
  parkId: number;
  parkFeatures: string[];
  initial: ReviewView | null;
  firstCritic: boolean;
  startStars?: number | null;
  onCancel?: () => void;
  onSaved: (tenths: number) => void;
}) {
  const [stars, setStars] = useState<number | null>(
    initial ? initial.ratingTenths / 10 : startStars,
  );
  const [tags, setTags] = useState<string[]>(
    initial?.tags.filter((t) => ATTRIBUTES[t]) ?? [],
  );
  const [body, setBody] = useState(initial?.body ?? "");
  const [removed, setRemoved] = useState<number[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const patch = (key: string, p: Partial<Upload>) =>
    setUploads((us) => us.map((u) => (u.key === key ? { ...u, ...p } : u)));

  async function send(u: Upload) {
    patch(u.key, { status: "prep", pct: 0, error: undefined });
    let file = u.file;
    if (u.kind === "image") {
      file = await compressImage(file);
      patch(u.key, { file });
    }
    if (file.size > MAX_BYTES) {
      patch(u.key, {
        status: "error",
        error: "Too big (300 MB max). Try a shorter clip!",
      });
      return;
    }
    patch(u.key, { status: "uploading" });
    try {
      const blob = await upload(
        `reviews/${parkId}/${safeName(file.name)}`,
        file,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          contentType: file.type || undefined,
          multipart: file.size > 20 * 1024 * 1024,
          onUploadProgress: ({ percentage }) =>
            patch(u.key, { pct: percentage }),
        },
      );
      patch(u.key, { status: "done", pct: 100, url: blob.url });
    } catch {
      patch(u.key, {
        status: "error",
        error: "The photo box is stuck.",
      });
    }
  }

  function pick(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_NEW - uploads.length;
    const fresh: Upload[] = [...files].slice(0, room).map((file) => {
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      return {
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        kind: isVideo(file) ? "video" : "image",
        preview,
        status: "prep",
        pct: 0,
      };
    });
    if (files.length > room)
      setError(`That's a lot of memories! We kept the first ${room}.`);
    setUploads((us) => [...us, ...fresh]);
    fresh.forEach(send);
  }

  function drop(key: string) {
    setUploads((us) => {
      const u = us.find((x) => x.key === key);
      if (u) {
        URL.revokeObjectURL(u.preview);
        previews.current.delete(u.preview);
      }
      return us.filter((x) => x.key !== key);
    });
  }

  const busy = uploads.some(
    (u) => u.status === "prep" || u.status === "uploading",
  );
  const failed = uploads.filter((u) => u.status === "error").length;
  const kept = initial?.media.filter((m) => !removed.includes(m.id)) ?? [];

  function save() {
    if (stars == null) {
      setError("Color in some stars first! Even zero counts. Tap the stars.");
      return;
    }
    setError(null);
    start(async () => {
      const res = await saveReview({
        parkId,
        stars,
        body,
        tags,
        addMedia: uploads
          .filter((u) => u.status === "done" && u.url)
          .map((u) => ({ url: u.url!, kind: u.kind })),
        removeMediaIds: removed,
      });
      if (!res.ok) return setError(res.error);
      onSaved(Math.round(stars * 10));
    });
  }

  return (
    <div className="doodle-box flex flex-col gap-5 bg-[#fffdf7] p-4">
      <div>
        <h3 className="font-hand text-[1.9rem] leading-none">
          {initial
            ? "Fix up your review"
            : firstCritic
              ? "No stars yet. Be the first critic!"
              : "Your turn, critic!"}
        </h3>
        {!initial && (
          <p className="mt-1 text-sm text-ink-soft">
            Four quick steps. Only the stars are required.
          </p>
        )}
      </div>

      <Step n={1} title="How many stars?">
        <StarInput value={stars} onChange={setStars} />
      </Step>

      <Step n={2} title="Report card">
        <ReportCardPicker
          tags={tags}
          setTags={setTags}
          parkFeatures={parkFeatures}
        />
      </Step>

      <Step n={3} title="Tell us more">
        <textarea
          className="field min-h-28 resize-y leading-relaxed"
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Best slide in town? Too many wasps? Spill it!"
          aria-label="Your review"
        />
      </Step>

      <Step n={4} title="Photos & videos">
        <div className="flex flex-col gap-3">
          {(kept.length > 0 || uploads.length > 0) && (
            <ul className="grid grid-cols-3 gap-2.5">
              {kept.map((m) => (
                <li key={m.id} className="relative">
                  <Thumb url={m.url} kind={m.kind} />
                  <RemoveDot
                    label="Remove this one"
                    onClick={() => setRemoved((r) => [...r, m.id])}
                  />
                </li>
              ))}
              {uploads.map((u, i) => (
                <li key={u.key} className="relative flex flex-col gap-1">
                  <Thumb
                    url={u.preview}
                    kind={u.kind}
                    dim={u.status !== "done"}
                  />
                  <RemoveDot
                    label="Remove this one"
                    onClick={() => drop(u.key)}
                  />
                  <CrayonProgress
                    pct={u.status === "error" ? 100 : u.pct}
                    color={BAR_COLORS[i % BAR_COLORS.length]}
                    failed={u.status === "error"}
                  />
                  <span className="text-center font-hand text-sm leading-tight">
                    {u.status === "prep" && "Shrinking…"}
                    {u.status === "uploading" && `${Math.round(u.pct)}%`}
                    {u.status === "done" && "✅ Ready!"}
                    {u.status === "error" && (
                      <button
                        type="button"
                        className="min-h-8 text-crayon-red underline"
                        onClick={() => send(u)}
                      >
                        😕 Try again
                      </button>
                    )}
                  </span>
                  {u.kind === "video" && u.status !== "error" && (
                    <span className="text-center text-[0.7rem] leading-tight text-ink-soft">
                      {formatMB(u.file.size)} video
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {failed > 0 && (
            <div className="flex gap-2 rounded-lg border-2 border-dashed border-crayon-red/60 bg-[color-mix(in_srgb,var(--color-crayon-orange)_10%,#fffdf7)] p-3 text-sm leading-snug">
              <span className="text-xl" aria-hidden>
                🙈
              </span>
              <p>
                {failed === 1 ? "One upload" : `${failed} uploads`} got stuck.
                Tap &ldquo;Try again,&rdquo; or just save. Your stars and words
                still count!
                {uploads
                  .find((u) => u.status === "error")
                  ?.error?.startsWith("Too big") && " (One file is too big.)"}
              </p>
            </div>
          )}

          <input
            ref={input}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="crayon-btn min-h-12 w-full border-dashed bg-paper text-xl"
            onClick={() => input.current?.click()}
            disabled={uploads.length >= MAX_NEW}
          >
            📸 Add photos or videos
          </button>
          <p className="-mt-1 text-center text-xs text-ink-soft">
            Photos get shrunk to save data. Videos go up full size, so Wi-Fi
            helps.
          </p>
        </div>
      </Step>

      {error && (
        <p
          className="animate-wiggle font-hand text-xl leading-tight text-crayon-red"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex gap-3">
        {onCancel && (
          <button
            type="button"
            className="crayon-btn min-h-14 bg-paper px-4 text-lg"
            onClick={onCancel}
          >
            Never mind
          </button>
        )}
        <button
          type="button"
          className="crayon-btn wax min-h-14 flex-1 bg-crayon-yellow text-[1.5rem]"
          disabled={saving || busy}
          onClick={save}
        >
          {saving
            ? "Saving…"
            : busy
              ? "Waiting on photos…"
              : initial
                ? "Save changes ⭐"
                : "Post it! ⭐"}
        </button>
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="flex items-center gap-2 font-hand text-[1.45rem] leading-none">
        <span
          className="grid h-8 w-8 place-items-center rounded-full border-2 border-ink bg-crayon-yellow/70 text-lg"
          aria-hidden
        >
          {n}
        </span>
        {title}
      </h4>
      {children}
    </section>
  );
}

const PREVIEW_PER_GROUP = 4;

function ReportCardPicker({
  tags,
  setTags,
  parkFeatures,
}: {
  tags: string[];
  setTags: (f: (t: string[]) => string[]) => void;
  parkFeatures: string[];
}) {
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (k: string) =>
    setTags((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]));

  const group = (g: string) => {
    const all = Object.keys(ATTRIBUTES).filter(
      (k) => ATTRIBUTES[k].group === g,
    );
    // Things the map already knows go first, so the common case is quick.
    const known = all.filter((k) => parkFeatures.includes(k));
    const rest = all.filter((k) => !parkFeatures.includes(k));
    const ordered = [...known, ...rest];
    if (open.includes(g)) return { shown: ordered, hidden: 0 };
    const cut = Math.max(PREVIEW_PER_GROUP, known.length);
    const shown = ordered.filter((k, i) => i < cut || tags.includes(k));
    return { shown, hidden: ordered.length - shown.length };
  };

  const renderGroup = (g: string) => {
    const { shown, hidden } = group(g);
    return (
      <div className="mt-1 flex flex-wrap gap-2">
        {shown.map((k) => (
          <AttrToggle
            key={k}
            k={k}
            on={tags.includes(k)}
            hint={parkFeatures.includes(k)}
            onClick={() => toggle(k)}
          />
        ))}
        {hidden > 0 && (
          <button
            type="button"
            className="min-h-11 px-2 font-hand text-lg text-crayon-blue underline decoration-dashed underline-offset-4"
            onClick={() => setOpen((o) => [...o, g])}
          >
            +{hidden} more
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-snug text-ink-soft">
        Tap what you noticed.{" "}
        {parkFeatures.length > 0 && <>🗺️ means the map says it&apos;s here.</>}
      </p>
      <div className="flex flex-col gap-2.5">
        <p className="font-hand text-xl leading-none text-crayon-green">
          ⭐ Good stuff
        </p>
        {ATTR_GROUPS.filter((g) => g.key !== "heads_up").map((g) => (
          <fieldset key={g.key}>
            <legend className="font-hand text-base text-ink-soft">
              {g.label}
            </legend>
            {renderGroup(g.key)}
          </fieldset>
        ))}
      </div>
      <fieldset className="rounded-[var(--radius-wobbly-2)] border-[2.5px] border-dashed border-crayon-red/70 bg-[color-mix(in_srgb,var(--color-crayon-orange)_10%,#fffdf7)] p-3 pt-1">
        <legend className="px-1 font-hand text-xl text-crayon-red">
          ⚠️ Heads up
        </legend>
        <p className="text-xs text-ink-soft">
          Anything a parent should know before they go?
        </p>
        {renderGroup("heads_up")}
      </fieldset>
    </div>
  );
}

function Thumb({
  url,
  kind,
  dim = false,
}: {
  url: string;
  kind: string;
  dim?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={`relative grid aspect-square w-full place-items-center overflow-hidden border-[3px] border-white bg-paper-dark outline-2 outline-ink/70 ${dim ? "opacity-70" : ""}`}
    >
      {broken ? (
        <span className="text-3xl" aria-hidden>
          🖼️
        </span>
      ) : kind === "video" ? (
        <video
          src={`${url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- local previews and Blob URLs
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      )}
      {kind === "video" && (
        <span className="absolute bottom-1 left-1 rounded bg-ink/70 px-1 text-xs text-white">
          ▶ video
        </span>
      )}
    </div>
  );
}

function RemoveDot({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute -top-3 -right-3 grid h-11 w-11 place-items-center"
    >
      <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-ink bg-white text-sm shadow-[1px_1px_0_#2b2a33]">
        ✕
      </span>
    </button>
  );
}
