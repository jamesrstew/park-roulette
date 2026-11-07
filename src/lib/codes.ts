import { randomInt } from "node:crypto";

const ADJ = [
  "wobbly",
  "giggly",
  "bouncy",
  "sparkly",
  "zippy",
  "sneaky",
  "fuzzy",
  "loopy",
  "swirly",
  "jolly",
  "wiggly",
  "snappy",
];
const NOUN = [
  "crayon",
  "slide",
  "swing",
  "sandbox",
  "pinecone",
  "otter",
  "rocket",
  "monkeybar",
  "marmot",
  "puddle",
  "seesaw",
  "kite",
];

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l lookalikes

/**
 * Friendly but unguessable invite codes, e.g. "wiggly-otter-k7pqm2vx9a".
 * 10 random chars from a 32-letter alphabet = 50 bits, plus ~7 from the words.
 */
export function inviteCode(): string {
  let tail = "";
  for (let i = 0; i < 10; i++) tail += ALPHABET[randomInt(ALPHABET.length)];
  return `${ADJ[randomInt(ADJ.length)]}-${NOUN[randomInt(NOUN.length)]}-${tail}`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
