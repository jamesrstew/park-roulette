# Roadmap

The one place for future work, in priority order. Each item says who owns
it (Claude builds, James decides or does account/console steps) and why it
matters. BACKLOG.md keeps known issues and their reasons; anything we
decide to do moves here.

Process (James, 2026-11-18): nothing reaches production without
/scrutinize. Anything people see is designed by a world-class UX designer
and critiqued by a second, fresh-eyed designer before it ships.

## Where it's headed

Park Roulette goes from a family hobby to a Central Oregon community app.
The Bend Bulletin is writing a story, so the next weeks are about being
ready for a wave of new families: sign-up that holds up under a surge,
hearing about problems before users do, knowing what people actually do,
and a light, respectful way to stay in touch, without losing the simple,
playful first experience.

## Now (before the Bulletin story)

1. **Twilio money: balance, auto-recharge, spend alerts** (James, Twilio
   console). The CLI key can't read billing.
2. **Turn alerts on: Resend account, DNS at Porkbun, `RESEND_API_KEY` in
   Vercel** (James). Alerts are built and live; until the key exists they
   only go to the server logs.
3. **Check six parks in person** (James): Skyline Sports Complex (small
   playground?), Stone Creek (structure or nature play only?), Culver City
   Park (playground?), Coffield Community Center (playground still there?),
   Fort Rock in Sunriver (what equipment?), Bean Park in Madras (add it?
   pin?). Also the Little Fawn pin (the address geocodes ~165 m away).
   Sources: data/audits/2026-11-18-*.md.

## Next

4. **Before the first park news email** (Claude, once Resend is set up):
   a confirmation email (single opt-in today, so anyone could add someone
   else's address), a one-click unsubscribe link that works signed out,
   List-Unsubscribe headers, open/click tracking off at the provider, the
   provider named in Privacy, and a postal address in every email
   (CAN-SPAM: a PO box or virtual address for True Craft Ventures LLC,
   James).
5. **Park news by text** (after James registers A2P 10DLC in Twilio): a
   separate Messaging Service and number with Advanced Opt-Out, a texts row
   in settings with its own consent, a confirmation text at opt-in, and the
   Terms §3 and phone-field wording changes.
6. **Register a DMCA agent** (James, $6 at dmca.copyright.gov; Claude adds
   the agent to Terms §9).
7. **Temporarily closed parks** (Claude): a real "closed until …" state
   that keeps a park off the wheel without crossing it off. Today the
   closures (Columbia until summer 2027, Sylvan's playground until spring
   2027, Sawyer's parking lot) are in each park's notes. Revisit those
   notes when they reopen.

## Later

- Lawyer review of Terms and Privacy (assumption of risk; whether the
  crayon look reads as "directed to children" under COPPA).
- Refuse VoIP numbers when a family starts (Twilio Lookup), so one person
  can't be two families in park-fix votes.
- Strip video location server-side, then let videos follow the review's
  visibility like photos.
- Reset a family link from the app (a leaked link today needs a database
  change).
- Stalled park fixes: auto-apply a sticker fix nobody disputed after 7
  days.
- Install prompt after the first stamp instead of in the welcome.
- Record which Terms version each person agreed to.
- Local links: parks department, PTA newsletters, parent groups (the
  biggest SEO lever).
- More guides once data supports them: fenced playgrounds, nature play.

## Done or dropped

- Done 2026-11-18: launch readiness (sign-up caps for a news-story day,
  "texts are backed up" note, email alerts, funnel events, admin stats);
  park news by email (optional, inline), "The scoop" tab, "Name from
  Family" bylines, kids shown as "A kid" to other families; park data audit
  (103 fixes, 2 new parks, sources in data/audits).

- Done 2026-11-18: SEO and AI search (town and feature guides, structured
  data, sitemap, llms.txt), four-tab nav, desktop panel, Vercel Web
  Analytics, stars always public.
- Done 2026-11-13: community launch (private photos, review privacy,
  two-family park fixes, News, reports and admin, Terms and Privacy,
  start a family without an invite).
- Dropped 2026-11-18: "Where's home?" before the first spin. Near me
  already covers it, and the question adds friction (James).
- Dropped 2026-11-18: magic-link email sign-in as a way to collect email.
  It solves sign-in, not staying in touch.
