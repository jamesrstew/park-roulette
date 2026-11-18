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

1. **Sign-up holds up under a surge** (Claude). New-number texts were
   capped at 60 a day site-wide, and over the cap the code silently never
   arrives. Raise the caps for a few hundred sign-ups in a day, keep the
   per-network abuse limits, and alert James before any cap is hit.
2. **Twilio money: balance, auto-recharge, spend alerts** (James, Twilio
   console; Claude wrote the steps). The CLI key can't read billing.
3. **Hear about problems first** (Claude; James creates a Resend account
   and adds its DNS records at Porkbun). Email hello@ on: a report (right
   away), a new park to confirm, a suggested park fix, sign-up caps
   nearing or hit, Twilio send failures, and a burst of server errors.
   Throttled so a bad hour sends one email, not a hundred.
4. **Know what people do** (Claude). Vercel custom events (Pro) for the
   key steps, no personal data; and an admin stats page from our own
   database with the funnel: started, verified a code, family created,
   first spin, first stamp, first review, invited another family.

## Next

5. **Stay in touch, the light way** (Claude builds; designer + critic).
   Optional, never at sign-up: after a happy moment (first stamp) and in
   Family & settings, offer park news by email, and separately by text,
   each with its own unchecked consent that says exactly what we'll send.
   Update Terms and Privacy in the same change. Email doubles as account
   recovery for a lost number.
6. **Before the first marketing text: A2P 10DLC registration** (James,
   Twilio console). Required for any non-code texts in the US; codes keep
   going through Verify. Also a mailing address for marketing emails
   (CAN-SPAM): a PO box or virtual address for True Craft Ventures LLC.
7. **Register a DMCA agent** (James, $6 at dmca.copyright.gov; Claude
   updates Terms §7 with the agent). Keeps the copyright safe harbor for
   photos people upload.

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
