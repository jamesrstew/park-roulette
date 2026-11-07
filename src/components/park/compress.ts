const MAX_SIDE = 2000;

export function isVideo(file: File) {
  return (
    file.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(file.name)
  );
}

async function decode(
  file: File,
): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Safari can show some formats (like HEIC) in an <img> even when
    // createImageBitmap won't take them.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return Object.assign(img, {
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** The browser couldn't open this photo (e.g. HEIC outside Safari). */
export class UnreadablePhoto extends Error {}

/**
 * Re-draw every photo as a ~2000px JPEG before upload. Re-encoding also strips
 * EXIF (including GPS location), which matters because uploads are public.
 * Photos the browser can't decode are refused rather than uploaded raw: a raw
 * HEIC would show as a broken image for everyone not on Safari.
 */
export async function compressImage(file: File): Promise<File> {
  if (file.type === "image/gif") return file;
  let src: Awaited<ReturnType<typeof decode>>;
  try {
    src = await decode(file);
  } catch {
    throw new UnreadablePhoto(file.name);
  }
  {
    const scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
    const w = Math.round(src.width * scale);
    const h = Math.round(src.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UnreadablePhoto(file.name);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    if ("close" in src && typeof src.close === "function") src.close();
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/jpeg", 0.85),
    );
    if (!blob) throw new UnreadablePhoto(file.name);
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  }
}

/** A tidy, URL-safe file name for the blob path. */
export function safeName(name: string) {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "bin";
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "photo"}.${ext}`;
}

export function formatMB(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb < 1
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}
