# Park Roulette: notes for Claude sessions

A just-for-fun, mobile-first web app: the Stewarts' quest to visit every playground in Central Oregon. Spin a crayon roulette wheel, get a park, go. Map, passport, reviews to the tenth of a star, photos and videos, friends.

@AGENTS.md

## Stack

- Next.js 16 App Router with **Cache Components on** (`cacheComponents: true`). Read `node_modules/next/dist/docs/` before using an API you're unsure of. Dynamic reads (DB, cookies) go in an async component **inside `<Suspense>`**; mutations are server actions in `src/lib/actions.ts` that call `refresh()`.
- Tailwind v4 (tokens in `src/app/globals.css` `@theme`), Drizzle + Postgres (Railway), Vercel Blob for media, Leaflet + OSM tiles for maps.
- No passwords. An explorer is a signed cookie (src/lib/session.ts) that
  carries the explorer's `sessionEpoch`; bumping the epoch signs them out
  everywhere. **Your phone gets you in; links bring people in.** Sign-in is a
  code texted by Twilio Verify (src/lib/sms.ts, actions in
  src/lib/phone-actions.ts, UI in components/PhoneCode.tsx). Crews (called
  **families** everywhere people can see; "crew" is only the code name) share a
  passport (visits); reviews belong to explorers. Invite links:
  /join/<joinCode> (join a crew, or "That's me!", which texts a code to
  members who have a number) and /join/<friendCode> (a friend starts their own
  crew). Local dev: SMS_FAKE=1 makes every code 000000 (never on Vercel).
- Sessions also record how the phone signed in (session.ts `SignedInBy`): a
  family-link tap or shared-phone switch to someone without a number is
  untrusted and can't add a number, so a borrowed family link can't become a
  takeover. Members with a number are only reachable with a code.
- **Community rules (2026-11-13).** Grown-ups (18+) hold accounts; anyone can start a family at /start with a texted number (no invite needed). Kids (`explorers.is_kid`, made with "A kid on this phone") give stars and tags only: no words, photos, park edits or reports. A grown-up who hands the phone to a kid can switch back with no code (`pr_grownup` cookie, session.ts).
- **Who sees what** lives in one place, src/lib/visibility.ts (`canSee`, `canSeeMedia`, `visibleSql`). Every read of review text, photos or author names goes through it. Reviews are public / members / family; photos never show signed out; videos only to the author's family; another family's review waits an hour; hidden (reported) reviews only show to their own family. Admins get no extra reach (they see reported reviews on /admin). Stars and tags always count toward park scores.
- **Photos are private.** Vercel Blob private store; browsers only ever see `/photos/<mediaId>` (src/app/photos/[id]/route.ts), which checks `canSeeMedia` and redirects to a 1-hour signed link. Never send `media.url` to a browser. Uploads go to `reviews/<crewId>/…`; every removal path deletes the file (`deleteFiles`), and a daily cron (/api/cron/cleanup) deletes unsaved uploads.
- **Park facts need two families** (src/lib/park-votes.ts): status, play type and stickers change when two verified families (a grown-up with a number) agree, or an admin (`explorers.is_admin`, set by hand) says so. Family-added parks wait for one other family to confirm (`parks.approved_at`).
- **Legal:** /terms and /privacy (True Craft Ventures LLC, hello@parkroulette.quest). If you change what we collect, who sees it, or who we share with, update /privacy in the same change.
- Every export of a "use server" file is a public endpoint. Helpers that
  trust an explorer id (src/lib/phone-auth.ts) live in server-only files.

## Design laws (this app lives or dies on delight)

1. **Everything looks drawn by a kid with crayons.** Use the design system: `.doodle-box`, `.crayon-btn` + `.wax` + a `bg-crayon-*` color, `.chip`, `.highlight`, `.tape`, `.field`; SVG filters `url(#crayon)` / `url(#wobble)` / `url(#hatch-yellow)` from `CrayonDefs`; doodles in `components/Scribbles.tsx`; rough.js for scribbled fills. Fonts: `font-hand` (Gochi Hand: titles, labels, big numbers) and `font-body` (Shantell Sans). There is no third font; don't add one. Page titles use `<PageTitle>` (one crayon accent word, a two-color scribble underline). Icons use `<Icon name=…>` from `components/icons` (hand-drawn crayon set; preview at /icons), never emoji, except people-picked buddy avatars.
2. **Colors only from the crayon box** (`src/lib/crayons.ts` / `--color-crayon-*`), ink `#2b2a33`, paper `#fffaf0`.
3. **Mobile first, thumb first.** Design at 390px. Primary actions are big and low on the screen. Keep tap targets at least 44px. The bottom nav is fixed, so leave `pb-32`.
4. **Copy is short, warm, playful, and in American English.** Talk like a fun parent, not a SaaS app. ("Let's go!", "We went!", "Colored in").
5. **Delight with restraint.** Use confetti, wiggles, and sounds for real moments (spin result, first stamp, badge), not on every tap. Respect `prefers-reduced-motion`.
6. **Never a dead end.** Every empty state gets a doodle, a line, and a next action.

## Commands

- `pnpm db:local` starts local Postgres on :5544, then `pnpm db:migrate && pnpm db:seed`
- `pnpm dev`, `pnpm check` (lint + typecheck + test + prettier)
- `node scripts/shot.cjs <url> <out.png> [click-selector]` takes an iPhone-sized screenshot for design review. **Look at your screens.**
- Schema change: edit `src/db/schema.ts`, then run `pnpm db:generate --name <what>` and commit the SQL in `drizzle/`.

## Shipping (James, 2026-11-06)

- **Run `/scrutinize` on every change before it reaches `main`.** Pushing `main` deploys production on Vercel (parkroulette.quest), so main stays scrutinized. Fix the findings, then push.
- This project is separate from belief-systems. Run `railway`/`vercel` commands only from this folder; it's linked to the Railway project `park-roulette` and the Vercel project `park-roulette`. Never re-link or change CLI defaults for other folders.
- Prod DB is Railway Postgres (`park-roulette` project). Migrations are additive; never drop data (it's people's reviews and photos).

## Git

- Conventional Commits (`feat:`, `fix:`, `style:`, `chore:`, `docs:`, `refactor:`, `test:`). `main` deploys to production on Vercel; work on short branches, open PRs, and squash-merge.
