# 🎡 Park Roulette

**Every playground in Central Oregon. One spin at a time.**

Spin the crayon wheel, get a playground, tap "Let's go!" for directions. Stamp your crew's passport, rate parks to the tenth of a star, and add photos and videos. Then send the link to friends so they can play too.

## Run it

```bash
pnpm install
cp .env.example .env.local   # fill SESSION_SECRET: openssl rand -hex 32
pnpm db:local                # local Postgres on :5544
pnpm db:migrate && pnpm db:seed
pnpm dev
```

The seed prints your crew's invite links.

## Data

`data/parks.json` is the park list. It's built from OpenStreetMap and official park district pages by `data/scripts/` (see `data/README.md`). Explorers can add missing parks and flag ones with no playground right in the app.

## Stack

Next.js 16 · Tailwind v4 · Drizzle + Postgres (Railway) · Vercel Blob · Leaflet/OpenStreetMap · rough.js · Vercel.
