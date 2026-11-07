# Backlog

Known follow-ups, newest first. Each has a reason it isn't done yet.

## From the first /scrutinize (2026-11-06)

- **Milestones on the park page.** Stamping from a park page doesn't fire the first-stamp / town-finished celebration (the List, Map and Spin do). Needs the park page to load bucket-list progress.
- **Map chip label.** The map shows every park (tree pins for parks without playgrounds), while its header counts playgrounds. Rename the "All" chip to "All parks" so the numbers read right. Do it when merging the icon swap, which rewrites those same lines.
- **Wheel vs. page scroll.** The wheel captures touches so you can flick it, which also means a swipe that starts on the wheel can't scroll the page. Idea: only capture drags that start on the outer ring, or detect circular motion before claiming the gesture.
- **Video location data.** Photos are re-encoded in the browser, which strips EXIF/GPS. Videos upload as-is and may carry location metadata. Options: a note in the composer, or server-side processing.
- **Orphaned uploads.** Photos uploaded to Blob but never saved with a review (closed tab, failed save) stay in the store. Add a periodic cleanup of blobs with no `media` row.
- **Error reporting.** Server actions now log failures (`[action:<name>]`) to Vercel's function logs, but nothing alerts us. Consider Sentry or a log drain if the app grows.
- **Unknown park URLs return HTTP 200.** The page streams, so the status is sent before the DB says "no such park." The not-found UI renders with `noindex`, so this is cosmetic.
