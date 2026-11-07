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

/**
 * Shrink a photo to a ~2000px JPEG before upload. If the browser can't decode
 * it (HEIC on most non-Apple browsers), the original goes up untouched.
 */
export async function compressImage(file: File): Promise<File> {
  if (file.type === "image/gif") return file;
  try {
    const src = await decode(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
    const w = Math.round(src.width * scale);
    const h = Math.round(src.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    if ("close" in src && typeof src.close === "function") src.close();
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/jpeg", 0.85),
    );
    if (
      !blob ||
      (scale === 1 && blob.size >= file.size && file.type === "image/jpeg")
    )
      return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
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
