# open-vidiq extension

Free, open-source YouTube creator toolkit (Chrome, Manifest V3): VPH and outlier badges,
watch-page stats, SEO, keyword research, competitor tracking and an AI coach that runs on
your own OpenAI-compatible provider. Free account required; no plans, no credits, no
limits.

Built with [WXT](https://wxt.dev) 0.21 + React 19.

## Develop

```sh
cp .env.example .env              # WXT_SERVER_URL=http://localhost:3000 (+ optional WXT_WEB_URL)
pnpm --filter extension dev       # opens Chrome with the extension loaded (HMR)
pnpm --filter extension build     # .output/chrome-mv3 (load unpacked in chrome://extensions)
pnpm --filter extension check-types
node scripts/run-live-check.mjs   # parsers vs fixtures + live YouTube smoke test
```

The server (`pnpm --filter server dev`) holds the accounts and powers view history,
trending and crowdsourced stats. The extension can't be used without signing in to it
(Settings → Account; see lib/README.md §0).

## How it fits together

```
youtube.com page ─┬─ MAIN world: entrypoints/youtube-bridge.content.ts (ytcfg + page data)
                  │        │ private MessagePort
                  └─ isolated content scripts (badges, watch panel, Shorts, Studio)
                           │ runtime messages / "ai-chat" Port
popup, side panel, options ┤
                           ▼
          background service worker (entrypoints/background.ts)
            ├─ lib/youtube  → InnerTube (youtube.com/youtubei/v1, anonymous, cached)
            ├─ lib/api      → open-vidiq server (history, trending, ingest queue)
            └─ lib/ai       → user's AI provider (openai SDK, streaming)
```

Everything that touches the network runs in the background, so all tabs share one cache
and one rate limiter. See **[lib/README.md](lib/README.md)** for the full API reference
(messaging protocol, hooks, settings, YouTube data types, AI generators, UI conventions).

## Permissions

- `storage`, `unlimitedStorage`: settings, chat history, response cache
- `sidePanel`, `tabs`: open the side panel on the current tab
- `alarms`: flush the crowdsourced-stats queue, re-check the login every 12 h
- Hosts: `*.youtube.com`, `suggestqueries-clients6.youtube.com`, `i.ytimg.com`, the
  configured server; `http(s)://*` are optional and requested one origin at a time for the AI
  provider the user picks.

## Privacy

YouTube requests are anonymous (no cookies). Server requests carry the login token (sign-in
is required); the token stays in the extension origin's IndexedDB, which only the background
reads (content scripts can't open it, unlike `chrome.storage.local`), and is never handed to
pages or content scripts. Crowdsourced stats (public view/like/comment counts of videos you
look at) are not linked to the account, skip unlisted and private videos (and their channels),
YouTube Studio and everything on your history, library and playlist pages, and can be turned
off in Settings. Your AI key stays in `chrome.storage.local` and is only sent to the
provider you configured. Settings → Server & privacy lists exactly what the server stores.

## Branding

The logo (a green "G" with a rising arrow and a play button) is our own. Its master is
`assets/brand/logo-source.png`; `scripts/generate-icons.mjs` (`pnpm --filter extension icons`)
builds `public/icon/*.png`, the inlined `components/common/logo-data.ts` and the web app's
icons in `apps/web/public`. open-vidiq is not affiliated with vidIQ or YouTube.
