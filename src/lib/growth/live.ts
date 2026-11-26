import "server-only";
import sitemap from "@/app/sitemap";
import { allEvents, listed } from "@/lib/events/store";
import type { Live } from "./digest";

/**
 * The live-only content numbers: the sitemap's URLs (the guides among
 * them) and the event pages listed right now. Request-time only (the
 * sitemap waits on connection()), so the cron route and the admin page
 * pass these in.
 */
export const liveSources: Live = {
  sitemap: async () => await sitemap(),
  eventsListed: async () => {
    const now = new Date();
    return (await allEvents()).filter((e) => listed(e, now)).length;
  },
};
