/**
 * Who our fetches say they are, plainly: our name, our site and an
 * address to write to. No "Mozilla/5.0 (compatible; ...)" prefix: we
 * aren't a browser, and some firewalls (Old Mill District's, November
 * 2026) drop that prefix on non-browsers as a fake browser, resetting the
 * connection, while they answer an honest bot name with the page.
 */
export const UA =
  "ParkRouletteNews/1.0 (+https://parkroulette.quest; hello@parkroulette.quest)";
