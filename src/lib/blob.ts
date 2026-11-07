/**
 * Our Vercel Blob store's public host, derived from the read/write token
 * (vercel_blob_rw_<storeId>_<secret>). Reviews may only attach media from
 * this host, never from someone else's store or the open web.
 */
export function ourBlobHost(
  token = process.env.BLOB_READ_WRITE_TOKEN,
): string | null {
  const m = token?.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/);
  return m ? `${m[1].toLowerCase()}.public.blob.vercel-storage.com` : null;
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
