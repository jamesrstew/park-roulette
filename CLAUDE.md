# Park Roulette: notes for Claude sessions

A just-for-fun, mobile-first web app: the Stewarts' quest to visit every playground in Central Oregon. Spin a crayon roulette wheel, get a park, go. Map, passport, reviews to the tenth of a star, photos and videos, friends.

@AGENTS.md

## Stack

- Next.js 16 App Router with **Cache Components on** (`cacheComponents: true`). Read `node_modules/next/dist/docs/` before using an API you're unsure of. Dynamic reads (DB, cookies) go in an async component **inside `<Suspense>`**; mutations are server actions in `src/lib/actions.ts` that call `refresh()`.
- Tailwind v4 (tokens in `src/app/globals.css` `@theme`), Drizzle + Postgres (Railway), Vercel Blob for media, Leaflet + OSM tiles for maps.
- No accounts/passwords: an explorer is a signed cookie (`src/lib/session.ts`). Crews share a passport (visits); reviews belong to explorers. Invite links: `/join/<joinCode>` (join a crew) and `/join/<friendCode>` (a friend starts their own crew).

## Design laws (this app lives or dies on delight)

1. **Everything looks drawn by a kid with crayons.** Use the design system: `.doodle-box`, `.crayon-btn` + `.wax` + a `bg-crayon-*` color, `.chip`, `.highlight`, `.tape`, `.field`; SVG filters `url(#crayon)` / `url(#wobble)` / `url(#hatch-yellow)` from `CrayonDefs`; doodles in `components/Scribbles.tsx`; rough.js for scribbled fills. Fonts: `font-hand` (Gochi Hand, headings/labels), `font-body` (Shantell Sans), `font-sketch` (Cabin Sketch, wordmark and big numbers).
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
- **Run `/scrutinize` on every change before it reaches `main`.** Pushing `main` deploys production on Vercel (park-roulette.vercel.app), so main stays scrutinized. Fix the findings, then push.
- This project is separate from belief-systems. Run `railway`/`vercel` commands only from this folder; it's linked to the Railway project `park-roulette` and the Vercel project `park-roulette`. Never re-link or change CLI defaults for other folders.
- Prod DB is Railway Postgres (`park-roulette` project). Migrations are additive; never drop data (it's people's reviews and photos).

## Git

- Conventional Commits (`feat:`, `fix:`, `style:`, `chore:`, `docs:`, `refactor:`, `test:`). `main` deploys to production on Vercel; work on short branches, open PRs, and squash-merge.
