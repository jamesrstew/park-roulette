# Backlog

Known follow-ups, newest first. Each has a reason it isn't done yet.

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
