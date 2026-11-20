/**
 * An image's pixel size from its bytes (PNG, JPEG, GIF, WebP), read when
 * it's copied to Blob so the card can draw it at its own ratio. Null when
 * the format isn't one of those.
 */
export function imageSize(
  b: Uint8Array,
): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (o: number, n: number) =>
    String.fromCharCode(...b.subarray(o, o + n));
  // PNG: IHDR right after the signature.
  if (b.length > 24 && b[0] === 0x89 && ascii(1, 3) === "PNG")
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  // GIF: logical screen size.
  if (b.length > 10 && ascii(0, 3) === "GIF")
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  // WebP: VP8 (lossy), VP8L (lossless), VP8X (extended).
  if (b.length > 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ")
      return {
        width: dv.getUint16(26, true) & 0x3fff,
        height: dv.getUint16(28, true) & 0x3fff,
      };
    if (chunk === "VP8L") {
      const bits = dv.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8X")
      return {
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
      };
  }
  // JPEG: walk the segments to a start-of-frame marker.
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1];
      const len = dv.getUint16(o + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      )
        return { width: dv.getUint16(o + 7), height: dv.getUint16(o + 5) };
      o += 2 + len;
    }
  }
  return null;
}
