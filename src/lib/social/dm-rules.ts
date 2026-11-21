import type { IgComment, IgMessage } from "./graph";

/** Which comments and Story replies get the keyword DM. Pure. */

/** The whole comment is PARK (any case, give or take punctuation). */
export const PARK_WORD = /^\W*park\W*$/i;
/** A Story reply that is PICK (alone, give or take punctuation). */
export const PICK_REPLY = /^\W*pick\W*$/i;

/** A Story reply opens a 24-hour window for our answer. */
const MESSAGE_HOURS = 24;

export function wantsLink(c: IgComment, ownId: string): boolean {
  if (!c.id || !c.text || c.from?.id === ownId) return false;
  return PARK_WORD.test(c.text);
}

export function wantsPick(
  m: IgMessage,
  ownIds: Set<string>,
  now: Date,
): boolean {
  if (!m.id || !m.message || !m.from?.id || ownIds.has(m.from.id)) return false;
  if (!m.story?.reply_to) return false;
  const at = m.created_time ? Date.parse(m.created_time) : NaN;
  if (!(now.getTime() - at < MESSAGE_HOURS * 3_600_000)) return false;
  return PICK_REPLY.test(m.message);
}
