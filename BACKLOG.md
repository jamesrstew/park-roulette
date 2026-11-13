# Backlog

Known follow-ups, newest first. Each has a reason it isn't done yet.

## Community launch (2026-11-13)

- **Get pinged on reports.** Reports show as a count on the admin's Me page only. Twilio Verify can't send arbitrary texts; a texting number needs A2P 10DLC registration. Options: ntfy push, email via Resend.
- **Refuse VoIP numbers when a family starts** (Twilio Lookup line type, about $0.008 each). Today one person with two numbers can be two "families" for park-fix votes and reports.
- **Strip video location server-side**, then let videos follow the review's visibility like photos (today they stay in the family).
- **Lawyer review** of /terms and /privacy, especially the assumption-of-risk section and whether the crayon look makes the app "directed to children" under COPPA.
- **Register a DMCA agent** at dmca.copyright.gov ($6, renews every 3 years) and add the agent's name to /terms section 7.
- **Stalled park fixes.** With few families, suggestions wait for an admin. Idea: auto-apply a sticker fix nobody disputed after 7 days.
- **Home base.** Ask "Where's home?" before the first spin and default the wheel to nearby parks (first spin in Bend sent a tester to Prineville).
- **Install prompt timing.** Offer "Put it on your Home Screen" after the first stamp, not in the welcome.
- **A numberless grown-up on a new phone** (see below) could be vouched for by a family member with a number.
- **"Bye" note.** Deleting an account lands on /?bye=1 with no message yet.

## Phone sign-in (2026-11-07)

- **Lost or changed number.** A member with a number can only be claimed by a code to that number. If they lose the number with no phone still signed in, they're stuck (James can clear `explorers.phone` by hand). A family-member "forget number" button was considered and dropped: anyone who claims a phone-less kid by link could use it to take over a grown-up.
- **Make a new family link.** Rotating `crews.join_code` is the only real fix for a leaked family link (anyone with it can still claim members who have no number).
- **A grown-up with no number on a new phone stays numberless.** Getting back in by family link is an untrusted sign-in, which can't add a number (on purpose: see `SignedInBy`). Today they can add one only on the phone they joined with. Idea: a trusted family member types the person's number and they read back the code.
- **Switching on a shared phone downgrades trust.** Switching to a family member with no number (kid or grown-up) is an untrusted sign-in, so a numberless grown-up who switches away and back can't add a number on that phone anymore. Fine for kids; grown-ups should add a number first (the nudge asks).
- **Twilio usage alerts.** Set a Usage Trigger in the Twilio console (for example, email when Verify spend passes $10 in a month). The app logs `[sms] cap …` when its own limits trip, but nothing pages anyone.
- **Custom text wording** ("Happy exploring!") needs a custom Twilio Verify template, which Twilio approves case by case.

## From the first /scrutinize (2026-11-06)

- **Milestones on the park page.** Stamping from a park page doesn't fire the first-stamp / town-finished celebration (the List, Map and Spin do). Needs the park page to load bucket-list progress.
- **Wheel vs. page scroll.** The wheel captures touches so you can flick it, which also means a swipe that starts on the wheel can't scroll the page. Idea: only capture drags that start on the outer ring, or detect circular motion before claiming the gesture.
- **Video location data.** Photos are re-encoded in the browser, which strips EXIF/GPS. Videos upload as-is and may carry location metadata. Options: a note in the composer, or server-side processing.
- **Orphaned uploads.** Photos uploaded to Blob but never saved with a review (closed tab, failed save) stay in the store. Add a periodic cleanup of blobs with no `media` row.
- **Error reporting.** Server actions now log failures (`[action:<name>]`) to Vercel's function logs, but nothing alerts us. Consider Sentry or a log drain if the app grows.
- **Unknown park URLs return HTTP 200.** The page streams, so the status is sent before the DB says "no such park." The not-found UI renders with `noindex`, so this is cosmetic.
