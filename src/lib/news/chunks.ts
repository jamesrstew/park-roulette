import type { OutEmail, SendResult } from "./resend";

/**
 * Sending an issue in chunks of 100, resumably. The audience snapshot puts
 * every reader in a numbered chunk; each chunk goes to Resend's batch API
 * with the Idempotency-Key news-<issue>-<chunk>-a<n>. The key stays the
 * same while Resend may have taken it (a timeout, a rate limit), so a
 * retry can never send a chunk twice, and moves to the next attempt only
 * when Resend clearly didn't take it (a 5xx). Pure: the store and the
 * sender are passed in, so tests can run it in memory.
 */

export const CHUNK_SIZE = 100;
export const MAX_ATTEMPTS = 3;

export type Recipient = {
  sendId: number;
  /** Null when they stopped (or bounced) after the snapshot: skipped. */
  email: string | null;
  token: string | null;
};

export interface ChunkStore {
  /** Chunks with anyone still queued or mid-send, lowest first. */
  pendingChunks(): Promise<number[]>;
  /** The chunk's queued or mid-send readers, with their address now. */
  recipients(chunk: number): Promise<{
    recipients: Recipient[];
    keyAttempt: number;
    /** The chunk switched to one email at a time on an earlier run. */
    oneByOne?: boolean;
    /** The send ids this key attempt went to, if it was tried before. */
    attemptIds?: number[] | null;
  }>;
  /** Write down who a key attempt goes to, before sending (first time only). */
  recordAttempt(
    chunk: number,
    keyAttempt: number,
    sendIds: number[],
  ): Promise<void>;
  /** This chunk goes one email at a time from now on, on every run. */
  markOneByOne(chunk: number): Promise<void>;
  /**
   * One-by-one emails Resend didn't take (a 5xx): back in the queue for
   * the next run, failed for good after MAX_ATTEMPTS.
   */
  retrySends(sendIds: number[]): Promise<void>;
  /** Mid-send, and one more attempt used. */
  markSending(chunk: number): Promise<void>;
  markSkipped(sendIds: number[]): Promise<void>;
  markSent(sent: { sendId: number; resendId: string | null }[]): Promise<void>;
  /** Failed for good. */
  markFailed(sendIds: number[]): Promise<void>;
  /**
   * Back in the queue for the next run (failed for good after
   * MAX_ATTEMPTS). `newKey`: Resend didn't take it, so the next try uses
   * the next attempt's key.
   */
  retryChunk(chunk: number, newKey: boolean): Promise<void>;
  /** The kill switch is off and our lease is renewed. False: stop now. */
  keepGoing(): Promise<boolean>;
}

export type ChunkOutcome = {
  chunk: number;
  outcome:
    | "sent"
    | "already_sent"
    | "retry"
    | "failed"
    | "one_by_one"
    | "later"
    | "empty";
  detail?: string;
};

export type ChunkRun = {
  sent: number;
  skipped: number;
  failed: number;
  outcomes: ChunkOutcome[];
  /** The kill switch, a lost lease, or Resend said slow down: resume later. */
  stoppedEarly: boolean;
};

export const batchKey = (issueId: number, chunk: number, attempt: number) =>
  `news-${issueId}-${chunk}-a${attempt}`;
export const singleKey = (issueId: number, chunk: number, sendId: number) =>
  `news-${issueId}-${chunk}-${sendId}`;

export async function processChunks(o: {
  issueId: number;
  store: ChunkStore;
  sendBatch: (emails: OutEmail[], key: string) => Promise<SendResult>;
  sendOne: (email: OutEmail, key: string) => Promise<SendResult>;
  /** The email for one reader (their own unsubscribe link and headers). */
  build: (r: { email: string; token: string }) => OutEmail;
  /** Pause between requests (Resend allows a few a second). */
  pause?: () => Promise<void>;
}): Promise<ChunkRun> {
  const run: ChunkRun = {
    sent: 0,
    skipped: 0,
    failed: 0,
    outcomes: [],
    stoppedEarly: false,
  };
  const { store } = o;
  const chunks = await store.pendingChunks();
  for (const [i, chunk] of chunks.entries()) {
    if (!(await store.keepGoing())) {
      run.stoppedEarly = true;
      break;
    }
    if (i > 0) await o.pause?.();
    const {
      recipients: all,
      keyAttempt,
      oneByOne,
      attemptIds,
    } = await store.recipients(chunk);
    const gone = all.filter((r) => !r.email || !r.token);
    const live = all.filter(
      (r): r is Recipient & { email: string; token: string } =>
        !!r.email && !!r.token,
    );
    if (gone.length) {
      await store.markSkipped(gone.map((r) => r.sendId));
      run.skipped += gone.length;
    }
    if (!live.length) {
      run.outcomes.push({ chunk, outcome: "empty" });
      continue;
    }
    await store.markSending(chunk);
    if (oneByOne) {
      run.outcomes.push({ chunk, outcome: "one_by_one" });
      if (await sendSingles(o, chunk, live, run)) break;
      continue;
    }
    const ids = live.map((r) => r.sendId).sort((a, b) => a - b);
    // Who this key goes to, written down before Resend sees it, so a later
    // "you already sent this key" is matched against exactly those readers.
    if (!attemptIds) await store.recordAttempt(chunk, keyAttempt, ids);
    const res = await o.sendBatch(
      live.map((r) => o.build(r)),
      batchKey(o.issueId, chunk, keyAttempt),
    );
    const detail = res.ok ? undefined : `${res.status} ${res.error}`;
    if (!res.ok && res.outcome === "accepted") {
      // Resend took this key on an earlier run (a crash before we wrote it
      // down), with the readers recorded then. Those got it: never send to
      // them again. Anyone else (none, unless the list changed) goes on the
      // next key.
      const took = new Set(attemptIds ?? ids);
      const got = live.filter((r) => took.has(r.sendId));
      const rest = live.filter((r) => !took.has(r.sendId));
      await store.markSent(
        got.map((r) => ({ sendId: r.sendId, resendId: null })),
      );
      run.sent += got.length;
      if (rest.length) await store.retryChunk(chunk, true);
      run.outcomes.push({
        chunk,
        outcome: "already_sent",
        detail: rest.length
          ? `${detail}; ${rest.length} not in that attempt, retried on a new key`
          : detail,
      });
    } else if (res.ok) {
      await store.markSent(
        live.map((r, j) => ({
          sendId: r.sendId,
          resendId: res.ids[j] ?? null,
        })),
      );
      run.sent += live.length;
      run.outcomes.push({ chunk, outcome: "sent" });
    } else if (res.outcome === "later") {
      run.outcomes.push({ chunk, outcome: "later", detail });
      run.stoppedEarly = true;
      break;
    } else if (res.outcome === "server") {
      await store.retryChunk(chunk, true);
      run.outcomes.push({ chunk, outcome: "retry", detail });
    } else if (res.outcome === "fatal") {
      await store.markFailed(live.map((r) => r.sendId));
      run.failed += live.length;
      run.outcomes.push({ chunk, outcome: "failed", detail });
    } else {
      // 400 or 422: one bad address (or header) sinks a whole batch. Send
      // this chunk one email at a time so the rest still go, and keep it
      // that way on every later run.
      await store.markOneByOne(chunk);
      run.outcomes.push({ chunk, outcome: "one_by_one", detail });
      if (await sendSingles(o, chunk, live, run)) break;
    }
  }
  return run;
}

/** One email each. True when Resend said slow down (stop this run). */
async function sendSingles(
  o: Parameters<typeof processChunks>[0],
  chunk: number,
  live: (Recipient & { email: string; token: string })[],
  run: ChunkRun,
): Promise<boolean> {
  const retry: number[] = [];
  let stop = false;
  for (const r of live) {
    await o.pause?.();
    const one = await o.sendOne(
      o.build(r),
      singleKey(o.issueId, chunk, r.sendId),
    );
    if (one.ok || one.outcome === "accepted") {
      await o.store.markSent([
        { sendId: r.sendId, resendId: one.ok ? (one.ids[0] ?? null) : null },
      ]);
      run.sent++;
    } else if (one.outcome === "later") {
      // The rest stay mid-send and resume on the next run.
      stop = true;
      break;
    } else if (one.outcome === "server") {
      // Resend didn't take it: like a chunk, try again next run.
      retry.push(r.sendId);
    } else {
      await o.store.markFailed([r.sendId]);
      run.failed++;
    }
  }
  if (retry.length) await o.store.retrySends(retry);
  if (stop) run.stoppedEarly = true;
  return stop;
}
