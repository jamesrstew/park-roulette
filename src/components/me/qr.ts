/**
 * A tiny QR code encoder (byte mode, error correction level M, versions 1-10).
 * Enough for invite links (up to ~213 bytes). Ported from the approach in
 * Project Nayuki's QR Code generator (MIT). Returns a square boolean grid,
 * true = dark module.
 */

const ECC_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const FORMAT_BITS_M = 0;

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(ver: number): number {
  return (
    Math.floor(rawDataModules(ver) / 8) -
    ECC_PER_BLOCK_M[ver - 1] * BLOCKS_M[ver - 1]
  );
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
  }
  return result;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step)
    result.splice(1, 0, pos);
  return result;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

export function encodeQr(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  for (; ver <= 10; ver++) {
    const cap = dataCodewords(ver) * 8;
    if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap) break;
  }
  if (ver > 10) throw new Error("Text too long for this little QR encoder");

  // ---- data bits
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const capBits = dataCodewords(ver) * 8;
  push(0, Math.min(4, capBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }

  // ---- error correction + interleave
  const numBlocks = BLOCKS_M[ver - 1];
  const eccLen = ECC_PER_BLOCK_M[ver - 1];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((blk, j) => {
      if (i !== shortLen - eccLen || j >= numShort) codewords.push(blk[i]);
    });

  // ---- function patterns
  const size = ver * 4 + 17;
  const grid = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  const isFn = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  const setFn = (x: number, y: number, dark: boolean) => {
    grid[y][x] = dark;
    isFn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size)
          setFn(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align = alignmentPositions(ver);
  const last = align.length - 1;
  align.forEach((ax, i) =>
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last)) return;
      if (i === last && j === 0) return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const drawFormat = (mask: number) => {
    const d = (FORMAT_BITS_M << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(f, i));
    setFn(8, 7, bit(f, 6));
    setFn(8, 8, bit(f, 7));
    setFn(7, 8, bit(f, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(f, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(f, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(f, i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit(v, i));
      setFn(b, a, bit(v, i));
    }
  }

  // ---- data modules (zigzag)
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && i < codewords.length * 8) {
          grid[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
  }

  // ---- masks: pick the one with the lowest (simplified) penalty
  const maskFn = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!isFn[y][x] && maskFn[m](x, y)) grid[y][x] = !grid[y][x];
  };
  const penalty = () => {
    let p = 0;
    let dark = 0;
    for (let a = 0; a < size; a++) {
      for (const horiz of [true, false]) {
        let run = 0;
        let prev: boolean | null = null;
        for (let b = 0; b < size; b++) {
          const c = horiz ? grid[a][b] : grid[b][a];
          if (c === prev) {
            run++;
            if (run === 5) p += 3;
            else if (run > 5) p++;
          } else {
            run = 1;
            prev = c;
          }
        }
      }
      for (let b = 0; b < size; b++) {
        if (grid[a][b]) dark++;
        if (
          a < size - 1 &&
          b < size - 1 &&
          grid[a][b] === grid[a][b + 1] &&
          grid[a][b] === grid[a + 1][b] &&
          grid[a][b] === grid[a + 1][b + 1]
        )
          p += 3;
      }
    }
    const total = size * size;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  };
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const s = penalty();
    if (s < bestScore) {
      best = m;
      bestScore = s;
    }
    applyMask(m); // undo (XOR)
  }
  applyMask(best);
  drawFormat(best);
  return grid;
}
