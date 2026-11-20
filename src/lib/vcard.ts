import { VCARD_PHOTO_JPEG } from "./vcard-photo";

/**
 * Park Roulette's contact card (vCard 3.0), sent with the Weekend Pick
 * confirmation as MMS so a family can save the number and know a Friday
 * text is us. Served at /park-roulette.vcf.
 */
export const VCARD_NOTE = "Weekend Pick: one playground every Friday";

/** RFC 6350 / 2425 folding: lines of 75 octets, continued with a space. */
export function fold(line: string): string {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += i === 0 ? 75 : 74)
    out.push((i === 0 ? "" : " ") + line.slice(i, i === 0 ? 75 : i + 74));
  return out.join("\r\n");
}

/** Escape a text value (commas, semicolons, backslashes, newlines). */
function text(s: string): string {
  return s.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
}

export function parkRouletteVcard(opts: {
  /** The texts number (E.164), or null to leave TEL out. */
  number: string | null;
  site: string;
  photo?: string;
}): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Park Roulette",
    "N:;Park Roulette;;;",
    "ORG:Park Roulette",
    ...(opts.number ? [`TEL;TYPE=CELL,VOICE:${opts.number}`] : []),
    `URL:${opts.site}`,
    `NOTE:${text(VCARD_NOTE)}`,
    `PHOTO;ENCODING=b;TYPE=JPEG:${opts.photo ?? VCARD_PHOTO_JPEG}`,
    "END:VCARD",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
