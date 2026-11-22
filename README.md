# GrowTube

**A free, source-available YouTube creator toolkit.** A Chrome extension plus a small
server that give you the creator-growth features usually locked behind a
subscription: views per hour, outlier scores, keyword research, SEO scoring,
controversial-keyword checks, a Studio optimizer and an AI coach.

- **Free and unlimited.** No plans, no credits, no usage limits. You need a free
  account (email and password) to use it, and then every feature is on, including the
  ones other tools paywall (controversial keywords, unlimited AI coach chats, unlimited
  research).
- **Bring your own AI.** Use any OpenAI-compatible provider (OpenAI, OpenRouter, Groq,
  Together AI, DeepSeek, Mistral, Google Gemini, a custom endpoint) or a free local model
  through Ollama or LM Studio. Your API key stays in your browser and requests go
  straight from the extension to your provider.
- **Crowdsourced history.** The extension can share the public numbers you already see
  on YouTube (views, likes, comments, subscribers) with the GrowTube server. That
  builds view-history charts and a trending board for everyone. It's opt-in (a checkbox
  on the sign-in form, and a switch in the popup and in Settings), nothing personal is
  ever sent, and the server stores the numbers without any link to your account.

GrowTube is an independent project. It is not affiliated with YouTube, Google or
vidIQ.

## Features

### On youtube.com

- **Feed badges** on home, search, subscriptions, channel pages, related videos and
  Shorts shelves: views per hour (VPH), an outlier score against the channel's typical
  views, and the channel's subscriber count.
- **Watch page panel**
  - **Views:** engagement rate, outlier score, VPH, and a views-over-time chart (first
    24 hours, first 7 days, first 28 days, all time) from crowdsourced snapshots.
  - **Overview:** channel card with a subscriber and total-views history chart, the
    controversial-keyword scan (title, description, tags and transcript), SEO score with
    a checklist, channel and video tags with each tag's search rank (copy or download),
    average and median views, uploads per week, and best posting times in your local
    time.
  - **AI Coach:** chat about the video with its stats, channel, recent uploads and
    transcript as context. Presets include "Analyze the hook" and "Why did this video do
    well?"; you can continue any conversation in the side panel.
- **Shorts controls:** playback speed (0.25x–3x), seek ±5 s or ±10 s, a seek bar,
  auto-scroll to the next Short, keyboard shortcuts, and mini stats (VPH, outlier,
  engagement).

### In YouTube Studio

- **Live SEO score** while you edit or upload, with a target keyword and keyword
  suggestions from YouTube autocomplete.
- **Controversial keywords** in the title, description and tags.
- **AI tools** with Apply and Undo: 10 title ideas, a description draft (it keeps your
  links and adds chapters from the captions), a tag set that fits YouTube's 500-character
  limit, and thumbnail concepts with optional image generation. Nothing is saved until
  you click Studio's Save.
- **Tag rank checker** (your video's position in search for each tag) and length
  counters for the title, description and tags.

### Side panel toolkit

- **AI Coach:** unlimited chats about any video or channel, with saved conversations.
- **Keyword Research:** expands a seed keyword through autocomplete and estimates
  volume, competition and an overall score (formulas are shown in the UI); AI insights
  per keyword and CSV export.
- **Trends:** the crowdsourced trending board (24 h / 7 days, long-form / Shorts) plus
  outlier videos from your competitors.
- **Competitors:** track channels in your niche.
- **Daily Ideas:** AI video ideas based on your channel and what's trending.
- **Thumbnails:** find similar thumbnails, generate concepts and images, and preview
  them in a YouTube-style card.
- **Optimize:** titles, description, tags and SEO score for any video or topic.
- **Clip Finder:** finds the best short-form clips in a video's transcript.
- **Channel Audit:** a scored audit with strengths, weaknesses and next actions.

### Website (`apps/web`)

- Landing page, sign-in, a **trending board**, **video** and **channel** stat pages
  with history charts, and a **lookup** box (video and channel links, ids, `@handles`).
- An **MCP** page explaining how to connect Claude, ChatGPT, Claude Code or Cursor to
  the server's MCP endpoint, where you create and revoke your MCP API keys.

### Server (`apps/server`)

- Accounts (Better Auth, email and password): a session cookie for the website, a
  bearer token for the extension.
- A REST API, for signed-in users only, for ingesting crowdsourced stats (stored
  without the uploader) and reading history, trending and batch stats; rate limits
  against abuse; Redis caching.
- An hourly cron that refreshes tracked videos and channels through the YouTube Data
  API (optional key), prunes old snapshots and cleans up expired sessions and keys.
- An **MCP server** (`POST /mcp`, with a personal API key) with `get_video_stats`,
  `get_video_history`, `get_channel_history` and `get_trending`.

Details: [`apps/server/README.md`](apps/server/README.md) and
[`apps/extension/lib/README.md`](apps/extension/lib/README.md).

## Monorepo layout

pnpm workspaces + Turborepo, TypeScript everywhere, Biome for linting and formatting.

```
growtube/
├── apps/
│   ├── extension/   # Chrome MV3 extension (WXT + React 19)
│   │   ├── entrypoints/   # background, youtube + studio content scripts, bridge, popup, side panel, options
│   │   ├── components/    # injected/ (youtube.com UI), studio/, pages/ (popup, side panel, options), common/
│   │   └── lib/           # messaging, settings, YouTube (InnerTube) client and parsers, AI layer, server client
│   ├── server/      # Hono on Cloudflare Workers: REST API, cron, MCP
│   └── web/         # Public site: TanStack Router + Vite + Tailwind v4
├── packages/
│   ├── shared/      # HTTP contract (zod), metrics (VPH, outliers), SEO score, formatting, YouTube ids
│   ├── db/          # Drizzle schema (auth + youtube tables) for Postgres
│   ├── auth/        # Better Auth config (accounts, extension bearer tokens, MCP API keys)
│   ├── ui/          # shadcn/ui components and global styles
│   ├── infra/       # Alchemy deployment (Cloudflare)
│   └── config/      # shared tsconfig
```

## Local development

Requirements: Node 22+, pnpm 11, Docker (or any local Postgres and Redis), and Chrome
or Edge 116+.

### 1. Install

```bash
pnpm install
```

### 2. Start Postgres and Redis

Any Postgres 15+ and Redis 6+ work. With Docker:

```bash
docker run -d --name growtube-postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=growtube postgres:17
docker run -d --name growtube-redis -p 6379:6379 redis:7
```

Every Redis key the server writes starts with `ovq:`, so a Redis instance shared with
other projects is fine.

### 3. Configure

Each app declares its variables in a `.env.schema` file
([Varlock](https://varlock.dev)); put your values in a git-ignored `.env` next to it.

`apps/server/.env`:

```bash
NODE_ENV=development
DATABASE_URL=postgres://postgres:postgres@localhost:5432/growtube
REDIS_URL=redis://localhost:6379
BETTER_AUTH_SECRET=change-me-to-a-random-string-of-32-chars-or-more
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3001
# Optional: enables the hourly refresh cron (YouTube Data API v3 key)
# YOUTUBE_API_KEY=
# Optional: pin extension sign-in to your extension id(s), comma-separated
# EXTENSION_ORIGINS=chrome-extension://abcdefghijklmnopabcdefghijklmnop
```

`apps/web/.env` (local development only; the deploy sets `VITE_SERVER_URL` itself):

```bash
VITE_SERVER_URL=http://localhost:3000
```

`apps/extension/.env` (optional; copy `.env.example`): `WXT_SERVER_URL` is the default
server URL and is added to the manifest's host permissions at build time. It defaults to
`http://localhost:3000`.

After changing a `.env.schema`, run `pnpm env:generate`.

### 4. Create the tables

```bash
pnpm db:push
```

### 5. Run

```bash
pnpm dev:server      # API on http://localhost:3000 (wrangler dev, local workerd)
pnpm dev:web         # website on http://localhost:3001
pnpm dev:extension   # extension dev mode: opens a browser with it loaded, hot reload
```

`pnpm dev` starts all three. To trigger the cron locally:
`curl "http://localhost:3000/__scheduled?cron=0+*+*+*+*"`.

To use the extension in your own Chrome instead of the dev browser:

```bash
pnpm --filter extension build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and
pick `apps/extension/.output/chrome-mv3`. The settings page opens on first install. Add
your AI provider there (the extension asks for permission to reach that provider's
origin), or skip it: everything except the AI features works without one.

### Checks

```bash
pnpm check-types                    # TypeScript across the monorepo
pnpm build                          # server, web and extension builds
pnpm check                          # Biome lint + format (writes fixes)
pnpm --filter extension live-check  # YouTube parsers against saved fixtures and live YouTube
```

## Deploy

The server and the website deploy together to Cloudflare Workers with
[Alchemy](https://alchemy.run) (`packages/infra/alchemy.run.ts`), with the server's
hourly cron trigger included.

1. **Connect Cloudflare** once:

   ```bash
   cd packages/infra
   pnpm exec alchemy profile edit --profile default --add Cloudflare
   ```

   This needs a workers.dev subdomain on the account (Workers & Pages in the
   dashboard). Use the Workers Paid plan: password hashing at sign-in and sign-up
   takes ~50 ms of CPU, over the Free plan's 10 ms per request. Alchemy's
   telemetry also crashes the CLI on exit on Windows; turn it off once with a
   file `~/.alchemy/telemetry-disabled` containing `true`.

2. **Provision the data stores.** Any Postgres reachable from Workers works; a
   [Neon](https://neon.tech) database is the easiest (give the Worker the
   **pooled** `-pooler` connection string). For Redis, use any Redis reachable over
   TCP (Upstash, Redis Cloud, Aiven…) with a `rediss://` URL (TLS; Upstash requires
   it). Put both in the same region and set `placement.region` in
   `packages/infra/alchemy.run.ts` to match (it is `aws:ap-southeast-1`).

3. **Set the production values** in `apps/server/.env.production.local`
   (git-ignored), values in single quotes: `DATABASE_URL`, `REDIS_URL`,
   `BETTER_AUTH_SECRET` (a new 32+ character random string), `CORS_ORIGIN` (the exact
   origin of the website, `https://growtube.<your-subdomain>.workers.dev`, no trailing
   slash; see step 4) and, optionally, `YOUTUBE_API_KEY` and `EXTENSION_ORIGINS` (your
   published extension's `chrome-extension://<id>`; without it any extension origin may
   call sign-in and sign-up, cookie-less requests only). The Alchemy CLI always runs with
   `NODE_ENV=production`, so this file is layered over `apps/server/.env`. Any key
   missing from it silently falls back to the local value in `apps/server/.env`;
   add `# @disable=forEnv(production)` and `# ---` as the first two lines of
   `apps/server/.env` to turn that into an error. `BETTER_AUTH_URL` is set by
   Alchemy to the server Worker's URL.

   Then create the tables in the production database, ideally over Neon's
   **direct** (non-pooler) connection string set for this one command:

   ```bash
   DATABASE_URL='postgres://…' pnpm --filter @growtube/db db:push
   ```

4. **Deploy:**

   ```bash
   pnpm run deploy --stage production
   ```

   Use `pnpm run deploy`, not `pnpm deploy` (a built-in pnpm command), and always the
   same `--stage production`. It deploys two Workers and prints both URLs at the end:
   - **`growtube-api`**, the server, at `https://growtube-api.<your-subdomain>.workers.dev`.
   - **`growtube`**, the website, at `https://growtube.<your-subdomain>.workers.dev`.
     Alchemy builds `apps/web` with `VITE_SERVER_URL` set to the deployed server's URL
     (no `apps/web` env file is needed for production) and serves `apps/web/dist`, with
     security headers and long-lived caching for the hashed `/assets/*` files. Unknown
     page paths fall back to `index.html` (single-page app), so routes like `/privacy`
     and `/dashboard` load directly. A small script (`packages/infra/web-worker.ts`)
     answers only requests that match no file: missing files get a real 404 (so a tab
     left open across a deploy reloads itself instead of caching HTML as a script), and
     page paths fetched by crawlers and link previews get `index.html`. The site is
     rebuilt only when `apps/web`, `packages/shared`, `packages/ui`, their tsconfigs or
     the lockfile change.

   The server's `CORS_ORIGIN` (step 3) must equal the website's URL, or sign-in from the
   website is refused; if you change it, deploy again. Run deploys from the repo root
   (or `packages/infra`): the paths in `alchemy.run.ts` are relative to `packages/infra`.
   `pnpm run destroy --stage production` tears both Workers down.

5. **Extension:** build the Chrome Web Store package:

   ```bash
   pnpm --filter extension zip:store
   ```

   This writes `apps/extension/.output/growtube-<version>-chrome.zip`, built against the
   production URLs in `apps/extension/.env.store` (`WXT_SERVER_URL` and `WXT_WEB_URL`,
   public values that ship in the extension; point them at your own deployment). Local
   `dev` and `build` don't read that file and stay on `http://localhost:3000`.
   `zip:store` reuses `apps/extension/.output/chrome-mv3`, so run
   `pnpm --filter extension build` afterwards to get the localhost build back. A ZIP
   built against a plain-http server (a plain `pnpm --filter extension zip`) is named
   `growtube-<version>-chrome-localhost.zip`; never upload that one.

   Upload the ZIP in the Chrome Web Store developer dashboard: the store takes the ZIP
   and signs the `.crx` itself. Bump `"version"` in `apps/extension/package.json` for
   every upload (each one must be higher than the last). After the first publish, add
   `EXTENSION_ORIGINS=chrome-extension://<store id>` to the server's production values
   (step 3) and deploy the server again. Users of an existing build can instead point
   **Settings → Server & privacy** at any server.

## Accounts & privacy

GrowTube only works signed in: the extension, the website's tools, the REST API and
MCP all need a (free) account. This is exactly what the server stores:

- **Account:** your name, your email address and a hash of your password (scrypt,
  via Better Auth). No email is ever sent, so the address is not verified.
- **Sessions:** one row per sign-in with a random token, its expiry (7 days, extended
  while you use it), created/updated times and your user id. **No IP address and no
  user agent** are stored. Expired sessions are deleted daily.
- **MCP API keys:** only a SHA-256 hash of each key, plus its first 8 characters (so
  you can tell keys apart), the name you gave it, and its created, last-used and
  optional expiry times. The full key is shown once, when you create it.
- **Crowdsourced uploads are not linked to accounts.** Uploads need a signed-in
  extension, but the server never stores who sent what: video and channel rows and
  snapshots have no user column. With crowdsourcing on (it is opt-in, off until the
  user ticks "Share public stats"), the extension sends only
  public numbers and metadata: video id, title, channel id and name, publish date,
  duration, Short or not, views, likes and comments, and for channels their handle,
  name, avatar (only a YouTube image URL is kept), subscribers, total views, video
  count, join date, country and keywords. The API rounds every time that comes from
  a browser's report (a video's "first seen" and "last snapshot", and view-history
  points) down to the hour. Unlisted and private videos are never uploaded, opening
  one uploads nothing about its channel, and nothing from YouTube Studio is uploaded.
  With a YouTube Data API key the server also re-checks the visibility of the videos
  it refreshes every hour, and deletes one that became unlisted or private together
  with its history.
- **Stats lookups** happen whenever you're signed in, sharing on or off: the extension
  asks the server about the public videos and channels it shows you (and your
  competitors' channels) by id, and Trends sends its search text. They are answered
  from the database and not stored with the account.
- **Rate limits** count requests in Redis under an HMAC of your user id (or, for
  sign-in, sign-up and account deletion, of your IP address or its IPv6 /64, and for
  sign-in also of the email address), never the id, IP or email itself; the counters
  expire after two windows (two minutes, or 30 minutes for the per-account sign-in
  and deletion limits). Trending searches are cached for 5 minutes under an HMAC of
  the search text, never the text itself.
- **Logs** contain the request method, the route pattern (like
  `/v1/videos/:id/history`, without the actual id), the status and the duration. No
  query strings, headers, IP addresses, request bodies or SQL values. Cloudflare's
  platform itself still sees IP addresses (request metadata and, if you enable them,
  Workers Logs or Logpush), outside this code.
- **Deleting your account** (with your password) removes the user, the password hash,
  all sessions and all API keys (the database deletes the keys with the account, so
  not even a key created at that moment survives). Your past uploads stay, because
  they were never linked to you.

In the extension and browser:

- The extension talks to YouTube anonymously (no cookies) and caches results locally.
  It keeps your GrowTube session token in extension storage.
- AI requests go from your browser to the provider you configure, with your own key.
  The GrowTube server never sees them.

## License

No license file has been chosen yet, so the code is source-available, not open source.
Add one (for example MIT or AGPL-3.0) before publishing the repository; the website,
the extension and the store listing then can say "open source" again.
