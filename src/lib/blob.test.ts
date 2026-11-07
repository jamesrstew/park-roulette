import { describe, expect, it } from "vitest";
import { isOurBlobUrl, ourBlobHost } from "./blob";

describe("blob url guard", () => {
  const host = ourBlobHost("vercel_blob_rw_AbC123_secret")!;
  it("derives the store host", () => {
    expect(host).toBe("abc123.public.blob.vercel-storage.com");
  });
  it("accepts only our store's review uploads", () => {
    expect(isOurBlobUrl(`https://${host}/reviews/3/a-x1.jpg`, host)).toBe(true);
    expect(
      isOurBlobUrl(
        "https://evil.public.blob.vercel-storage.com/reviews/a.jpg",
        host,
      ),
    ).toBe(false);
    expect(isOurBlobUrl(`http://${host}/reviews/a.jpg`, host)).toBe(false);
    expect(isOurBlobUrl(`https://${host}/other/a.jpg`, host)).toBe(false);
    expect(isOurBlobUrl(`https://${host}.evil.com/reviews/a.jpg`, host)).toBe(
      false,
    );
    expect(isOurBlobUrl("javascript:alert(1)", host)).toBe(false);
    expect(isOurBlobUrl("https://x/reviews/a.jpg", null)).toBe(false);
  });
});
