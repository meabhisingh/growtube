# GrowTube extension

Free, source-available YouTube creator toolkit (Chrome, Manifest V3): VPH and outlier badges,
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

## Publish (Chrome Web Store)

```sh
pnpm --filter extension zip:store  # .output/growtube-<version>-chrome.zip
```

- Builds against the production URLs in `.env.store` (`WXT_SERVER_URL`, `WXT_WEB_URL`:
  public values that ship in the extension, never secrets). `dev`, `build` and `zip` don't
  read it and stay on `http://localhost:3000`. A ZIP built against a plain-http server is
  named `growtube-<version>-chrome-localhost.zip`, so it can't be mistaken for the store
  package.
- It is the normal production `wxt zip` run under `node --env-file=.env.store`, not
  `wxt zip --mode store`: WXT 0.21 sets `NODE_ENV` to a custom mode's name, which bundles
  React's development build. Variables already set in your shell win over the file; if
  that makes the build point anywhere but `.env.store`'s `WXT_SERVER_URL`, `zip:store`
  stops without writing the ZIP (the `GROWTUBE_STORE_ZIP=1` check in `wxt.config.ts`).
- It reuses `.output/chrome-mv3`; run `pnpm --filter extension build` afterwards to get the
  localhost build back.
- Upload the ZIP in the developer dashboard; the store signs the `.crx` itself. Bump
  `version` in `package.json` (it becomes the manifest version) for every upload: each one
  must be higher than the last.
- After the first publish, set `EXTENSION_ORIGINS=chrome-extension://<store id>` on the
  server and redeploy it.

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
            ├─ lib/api      → GrowTube server (history, trending, ingest queue)
            └─ lib/ai       → user's AI provider (openai SDK, streaming)
```

Everything that touches the network runs in the background, so all tabs share one cache
and one rate limiter. See **[lib/README.md](lib/README.md)** for the full API reference
(messaging protocol, hooks, settings, YouTube data types, AI generators, UI conventions).

## Permissions

- `storage`, `unlimitedStorage`: settings, chat history, response cache
- `sidePanel`: open the side panel on the current tab
- `alarms`: flush the crowdsourced-stats queue, re-check the login every 12 h
- `declarativeNetRequestWithHostAccess`: one session rule that sets Origin/Referer to
  youtube.com on the extension's own InnerTube requests
- Hosts: `*.youtube.com`, `suggestqueries-clients6.youtube.com`, the configured server;
  `http(s)://*` are optional and requested one origin at a time for the AI provider or
  custom server the user picks.
- No `tabs`: tab `url`/`title` are only read for YouTube tabs, which the youtube.com host
  permission already exposes.

## Privacy

YouTube requests are anonymous (no cookies). Server requests carry the login token (sign-in
is required); the token stays in the extension origin's IndexedDB, which only the background
reads (content scripts can't open it, unlike `chrome.storage.local`), and is never handed to
pages or content scripts. Signed in, the extension looks up the public videos and channels
you see by id (that is how it shows their stats). Crowdsourced stats (public view/like/comment
counts and metadata of videos and channels you look at) are opt-in ("Share public stats" on
the sign-in form, in the popup or in Settings, off by default), are not linked to the account,
and skip unlisted and private videos (and their channels), YouTube Studio and everything on
your history, library and playlist pages. Your AI key stays in `chrome.storage.local` and is only sent to the
provider you configured. Settings → Server & privacy lists exactly what the server stores.

## Branding

The logo (a green "G" with a rising arrow and a play button) is our own. Its master is
`assets/brand/logo-source.png`; `scripts/generate-icons.mjs` (`pnpm --filter extension icons`)
builds `public/icon/*.png`, the inlined `components/common/logo-data.ts` and the web app's
icons in `apps/web/public`. GrowTube is not affiliated with vidIQ or YouTube.

The Chrome Web Store icon is `store/images/store-icon-128.png` (same script): the 128 px
icon with the artwork at 96x96 and 16 px of transparent padding, as the store asks.
