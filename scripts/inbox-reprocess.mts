/**
 * Run one received email through the newsletter inbox again: the exact
 * path the webhook takes (lib/inbox/inbound.ts handleReceived: fetch from
 * Resend, raw message, our DKIM check, decide, clean, store). For an
 * issue that was dropped by a check that has since been fixed.
 *
 * Dry run (the default): says what would happen; stores nothing, sends
 * no alerts.
 *
 *   DATABASE_URL=<url> RESEND_INBOUND_API_KEY=<key> INBOX_ADDRESS=<addr> \
 *   INBOX_FORWARDER=<gmail> INBOX_SENDERS=<senders> \
 *     pnpm exec tsx --conditions react-server \
 *     scripts/inbox-reprocess.mts <resend_receiving_id>
 *
 * Store it (the same env): add --apply. A Message-ID already stored is
 * reported as a duplicate; the 2-a-day limit still applies. No alerts.
 *
 * Env comes from the command line (.env.local isn't read), e.g. after
 * `vercel env pull .env.prod --environment production`:
 *   set -a; . ./.env.prod; set +a
 */
export {};

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
if (!id || !/^[0-9a-f-]{36}$/i.test(id))
  throw new Error("Give the Resend receiving id (a UUID).");
for (const k of [
  "DATABASE_URL",
  "RESEND_INBOUND_API_KEY",
  "INBOX_ADDRESS",
  "INBOX_FORWARDER",
  "INBOX_SENDERS",
])
  if (!process.env[k]) throw new Error(`Set ${k}.`);

async function main() {
  const { handleReceived, inboxConfig } =
    await import("../src/lib/inbox/inbound");
  const { liveResolver } = await import("../src/lib/inbox/dkim");
  const r = await handleReceived(id!, fetch, inboxConfig(), liveResolver, {
    dryRun: !apply,
    quiet: true,
  });
  console.log(`${apply ? "Applied" : "Dry run"}: ${id}`);
  console.log(JSON.stringify(r, null, 2));
  if (!apply && r.outcome === "would_store")
    console.log("Looks good: run again with --apply to store it.");
  process.exit(r.outcome === "failed" ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
