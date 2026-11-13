/**
 * Our Vercel Blob store, from the read/write token
 * (vercel_blob_rw_<storeId>_<secret>). Reviews may only attach media from
 * this store, never from someone else's store or the open web.
 */
export function ourStoreId(
  token = process.env.BLOB_READ_WRITE_TOKEN,
): string | null {
  const m = token?.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/);
  return m ? m[1].toLowerCase() : null;
}

/** The store's host. Photos live in a private store (they need our door). */
export function ourBlobHost(
  token = process.env.BLOB_READ_WRITE_TOKEN,
  access: "public" | "private" = "private",
): string | null {
  const id = ourStoreId(token);
  return id ? `${id}.${access}.blob.vercel-storage.com` : null;
}

export function isOurBlobUrl(url: string, host = ourBlobHost()): boolean {
  if (!host) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname.toLowerCase() === host &&
      u.pathname.startsWith("/reviews/")
    );
  } catch {
    return false;
  }
}

/** A blob in a private store: only readable with our token or a signed URL. */
export function isPrivateBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname
      .toLowerCase()
      .endsWith(".private.blob.vercel-storage.com");
  } catch {
    return false;
  }
}
