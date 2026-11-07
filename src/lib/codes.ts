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

/** Friendly but unguessable invite codes, e.g. "wiggly-otter-48213". */
export function inviteCode(): string {
  return `${ADJ[randomInt(ADJ.length)]}-${NOUN[randomInt(NOUN.length)]}-${randomInt(10000, 99999)}${randomInt(100, 999)}`;
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
