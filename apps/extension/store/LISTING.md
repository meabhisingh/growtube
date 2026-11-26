# Chrome Web Store listing: GrowTube (first submission)

A copy-paste sheet for every field of the Chrome Web Store Developer Dashboard. Each statement
below was checked against the code (manifest: `apps/extension/wxt.config.ts`; data flows:
`lib/api.ts`, `lib/auth-session.ts`, `lib/token-store.ts`, `lib/ai/*`, `lib/youtube/*`,
`components/injected/**`, `components/studio/**`, `entrypoints/*`; server storage:
`packages/db/src/schema`, `packages/auth`, `apps/server`). If the code changes, re-check
the sections marked with the file they depend on.

Production URLs used below:

- API server: `https://growtube-api.meabhisingh25.workers.dev`
- Website: `https://growtube.meabhisingh25.workers.dev`
- Privacy policy: `https://growtube.meabhisingh25.workers.dev/privacy`
- Repository: `https://github.com/meabhisingh/growtube`

Read **Owner decisions** (near the end) before you upload. Items 1 and 2 there must be done
before the first submission and item 3 is strongly recommended; the rest are choices with a
recommendation.

---

## 1. Store listing tab

### Name

`GrowTube`. It comes from the manifest `name`, so you can't edit it in the dashboard.

### Summary (short description)

The dashboard takes this from the manifest `description`: plain text, at most 132 characters.
Since 1.0.1 the text is (100 characters):

```text
Free YouTube creator toolkit: views per hour, outlier scores, SEO, keyword research and an AI coach.
```

1.0.0 said "VPH" and ended with "No limits.". "VPH" is spelled out because new users don't
know it, and "No limits." was dropped as an unprovable claim. To change it, edit
`description` in `apps/extension/wxt.config.ts` and rebuild the ZIP: the store summary
always shows the manifest's text.

### Detailed description

The first submission was rejected on 2026-11-23 (Yellow Argon, keyword spam) for listing AI provider names. This version names no providers, uses no content word more than 5 times, and matches the privacy policy.

This is plain text: the store shows no Markdown. Paste everything inside the block.

```text

GrowTube is a free toolkit that helps YouTube creators research, optimize and grow their channel. It adds video and channel stats as you browse and watch, an SEO panel in Studio, and research tools in Chrome's side panel. There are no paid plans, credits or daily caps.

WHILE YOU WATCH
• A panel next to each video with views per hour, an outlier score (how it compares with the creator's usual uploads), a view-history chart, an SEO score, video and channel tags with the search rank of the top tags, and an AI Coach tab.
• Badges on video cards in home, search, subscriptions and channel pages: views per hour, outlier score and subscriber count at a glance.
• Shorts review controls for studying what works: playback speed, 5-second skips, a seek bar, auto-scroll and quick numbers.

WHILE YOU EDIT IN STUDIO
• A live SEO score and checklist for your title, description and tags, the search rank of each tag, and suggestions.

IN THE SIDE PANEL
• AI Coach: ask questions about any upload or creator.
• Keyword Research: find search terms with demand and weak competition.
• Trends: see what's taking off in the stats users share, and your competitors' outliers.
• Competitors: follow the creators you compete with.
• Daily Ideas: fresh ideas based on what works for you.
• Thumbnails: research and preview thumbnails, and generate new ones with a service that makes images.
• Optimize: improve titles, descriptions and tags with a live score.
• Clip Finder: find moments worth turning into Shorts.
• Channel Audit: best posting times, outliers and an AI review.

USE YOUR OWN AI
Coach, ideas, clips, thumbnail generation and the writing suggestions work with any service that offers an OpenAI-compatible API, using your own key, or with a model running on your own computer. Requests, with the details, transcript or Studio text they need, go straight from your browser to the service you choose, under its own privacy policy. Every other feature works without AI.

SIGN-IN
You need a free account (name, email and password) to use any feature. It powers view history and Trends, and keeps the server fair for everyone.

PRIVACY
• Requests to YouTube never use your Google sign-in or cookies. In Studio, the title, description and tags you are editing are scored on your computer.
• To show these numbers, the IDs of the public videos and channels you open or see in lists, the channels you add as competitors, and your Trends searches are sent to our server with your login. The server does not store these lookups with your account.
• "Share public stats" is optional and off until you turn it on. It also uploads public details of those videos and channels (such as titles, handles, dates, durations, view, like, comment and subscriber counts, avatars, country and keywords; the privacy policy lists every field), stored without your account ID. Unlisted and private videos are never uploaded, and nothing from Studio or your history, library and playlist pages is sent to our server.
• Our server stores your name, email, a hash of your password and your login sessions.
• Nothing is looked up or uploaded until you sign in, and the sign-in form explains all of this first. The sharing switch is on that form, in the popup and in Settings.
• Your provider key and coach chats stay in your browser.
• You can delete your account at any time in Settings → Account. Shared stats were never linked to it, so they stay.
Privacy policy: https://growtube.meabhisingh25.workers.dev/privacy
Source code: https://github.com/meabhisingh/growtube

GrowTube is an independent project. It is not affiliated with or endorsed by YouTube or Google.
```

Every claim in this text maps to the code:

| Claim                            | Source                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------- |
| Watch panel contents             | `components/injected/watch/*` (Views, Overview, AI Coach tabs)                |
| Feed badges                      | `components/injected/feed/render.ts` (vph, outlier, subs)                     |
| Shorts controls                  | `components/injected/shorts/ShortsControls.tsx`                               |
| Studio panel                     | `components/studio/*` (ScoreSection, Checklist, TagRanks, AiTools)            |
| The 9 tools and their one-liners | `components/pages/sidepanel/nav.ts`                                           |
| AI providers                     | `lib/ai/providers.ts`                                                         |
| Anonymous YouTube requests       | `credentials: "omit"` in `lib/youtube/innertube.ts`                           |
| Account required                 | `lib/background-handlers.ts` (`PUBLIC_TYPES`, `assertSignedIn`)               |
| Shared stats behavior            | `lib/api.ts`, `lib/youtube/visibility.ts`, `apps/server/src/routes/ingest.ts` |
| Opt-in, notice on sign-in form   | `components/pages/account/AuthForm.tsx` (`DataNotice`), `lib/settings.ts`     |
| Delete account                   | `lib/auth-session.ts` (`deleteAccount`)                                       |

### Category

**Social Media & Networking** (store definition: enhancements for social platforms). If you
want a broader shelf, **Tools** also fits.

### Language

English. The UI is English only (there is no `_locales`).

### Graphic assets

Another task produces the files in `apps/extension/store/images/`.

| Field               | Required                                            | Size                                                        | File                                                                         |
| ------------------- | --------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Store icon          | yes                                                 | 128x128 PNG                                                 | `store/images/store-icon-128.png` (96x96 artwork, 16 px transparent padding) |
| Screenshots         | at least 1, up to 5                                 | 1280x800 (preferred) or 640x400, square corners, full bleed | `store/images/screenshot-1-*.png` to `screenshot-4-*.png`, uploaded in order |
| Small promo tile    | optional, but listings without one are ranked lower | 440x280 PNG/JPEG                                            | `store/images/promo-small-440x280.png`                                       |
| Marquee promo tile  | optional, needed to be featured in the marquee      | 1400x560 PNG/JPEG                                           | `store/images/promo-marquee-1400x560.png`                                    |
| YouTube promo video | optional                                            | link                                                        | none yet                                                                     |

Before you upload, check each image:

- Promo tiles have little or no text, and still read at half size.
- No YouTube or Google logos are used as branding. Real screenshots of YouTube pages are fine.
- Every screenshot shows the real product. Screenshot 1 shows the watch panel's real
  "tracking started" state (no invented view history), and there is no Studio screenshot
  until one is captured on the real studio.youtube.com (Owner decision 5).

### URLs

- **Official URL**: `https://growtube.meabhisingh25.workers.dev`. The dropdown lists only
  sites verified in Google Search Console. Verify it as a URL-prefix property with an HTML
  tag or file served by the web app. If you can't, leave this field empty: the homepage URL
  below covers it.
- **Homepage URL**: `https://growtube.meabhisingh25.workers.dev`
- **Support URL**: `https://github.com/meabhisingh/growtube/issues`. The repository must be
  **public**, with Issues enabled, before you submit.

### Mature content

No.

---

## 2. Privacy practices tab

### Single purpose

```text
GrowTube helps YouTube creators research, optimize and grow their channel. It shows public video and channel analytics (views per hour, outlier scores, view history) on YouTube pages, Shorts review controls (playback speed, skips, a seek bar and auto-scroll) for studying Shorts, an SEO panel while editing a video in YouTube Studio, and creator research tools (keyword research, trends, competitors, channel audit, ideas, thumbnails, clip finder and an AI coach) in Chrome's side panel. Every feature serves this one purpose: analyzing and improving YouTube content.
```

### Permission justifications

Each block below goes in that permission's field. They match the current manifest:
`storage`, `unlimitedStorage`, `sidePanel`, `alarms`, `declarativeNetRequestWithHostAccess`,
and the hosts `*://*.youtube.com/*`, `https://suggestqueries-clients6.youtube.com/*` and the
production server. There is no `tabs` permission (the code reads tab URLs only for YouTube
tabs, which the youtube.com host permission covers) and no `i.ytimg.com` host (nothing
fetches it).

**storage**

```text
Saves the user's settings and work in chrome.storage.local: server URL, AI provider settings (including the user's own API key), feature toggles, theme, the signed-in user's name and email for display, saved ideas, the competitor list and AI Coach conversations. It also keeps a response cache of public YouTube and GrowTube data so pages load fast and fewer requests are made. chrome.storage.session holds the short-lived upload queue for shared public stats, and the ids of unlisted or private videos the extension has seen so they are never uploaded.
```

**unlimitedStorage**

```text
The response cache of public YouTube data (video and channel details, search results, transcripts, channel baselines) is kept in chrome.storage.local up to a fixed cap of 40 MB / 2,000 entries, plus the saved AI Coach conversations. That is more than the default 10 MB quota of chrome.storage.local. Without this permission the cache would fail to write and every page would refetch data from YouTube.
```

**sidePanel**

```text
GrowTube's 9 tools (AI Coach, Keyword Research, Trends, Competitors, Daily Ideas, Thumbnails, Optimize, Clip Finder, Channel Audit) run in Chrome's side panel next to the YouTube tab. The extension calls chrome.sidePanel.open() when the user clicks "Open toolkit" in the popup or a tool button in the YouTube panel, and setPanelBehavior() so the toolbar icon keeps opening the popup.
```

**alarms**

```text
Two periodic alarms in the background service worker: (1) every minute, flush the queue of shared public video/channel stats to the GrowTube server. This is a safety net for batches left behind when Chrome suspends the service worker, and it does nothing when the queue is empty. (2) Every 12 hours, re-validate the user's sign-in session with the GrowTube server so an ended session signs the extension out.
```

**declarativeNetRequestWithHostAccess**

```text
Installs one session rule that sets the Origin and Referer headers to https://www.youtube.com on the extension's OWN requests to www.youtube.com/youtubei/ (the rule is limited to initiatorDomains = this extension's id and resourceTypes = xmlhttprequest). YouTube rejects these requests when they carry a chrome-extension:// origin. The rule blocks nothing and changes no request made by web pages, other extensions or the user. The WithHostAccess variant is used on purpose: it only works on hosts the extension already has permission for, and it adds no install warning.
```

**Host permissions.** The dashboard usually shows one field for all hosts. Its length is
limited (keep it under about 1,000 characters), so paste this compact block:

```text
*.youtube.com and suggestqueries-clients6.youtube.com: content scripts add the watch-page panel, feed badges and Shorts controls on www.youtube.com and the SEO panel on studio.youtube.com. The background reads public video, channel, search, caption and search-autocomplete data from YouTube anonymously (no cookies).
growtube-api.meabhisingh25.workers.dev: the GrowTube server, for the required account (sign-up, sign-in, session check, deletion), view history, trends and stats lookups, and, only if the user opts in, uploads of shared public stats. Only the background calls it, with the user's login token.
Optional https://*/* and http://*/* (nothing granted at install): when the user saves their own OpenAI-compatible AI provider (e.g. api.openai.com, or Ollama/LM Studio on http://localhost) or a self-hosted server URL in Settings, the extension requests that one origin with chrome.permissions.request().
```

Per-host detail, for separate per-host fields or a reviewer question:

- `*://*.youtube.com/*`: content scripts on www.youtube.com (watch-page panel, feed
  badges, Shorts controls) and studio.youtube.com (SEO panel). A read-only MAIN-world script
  reads YouTube's own page config and player data, so the extension doesn't refetch them.
  The background fetches `www.youtube.com/youtubei/v1/*` and captions with
  `credentials: "omit"`.
- `https://suggestqueries-clients6.youtube.com/*`: Keyword Research reads YouTube search
  autocomplete from `/complete/search` (`lib/youtube/suggest.ts`). `*://*.youtube.com/*`
  already covers it; it is listed on its own for clarity and adds no warning.
- `https://growtube-api.meabhisingh25.workers.dev/*`: `/api/auth/*` (better-auth),
  `/health`, `/v1/*` reads and `/v1/ingest/*` uploads (`lib/api.ts`,
  `lib/auth-session.ts`). It is added to the manifest from `WXT_SERVER_URL` at build time.
- Optional `https://*/*`, `http://*/*`: requested from a click handler in the options page,
  sign-in form or AI settings (`lib/permissions.ts`), one origin at a time, never at install.
  `http://` is needed for local models and self-hosted servers on a local network.

### Remote code

Answer: **No, I am not using remote code.**

Why this is true:

- All JavaScript and CSS is bundled into the package by WXT/Vite. GrowTube's own code has
  no `eval`, no `new Function`, no `importScripts`, no `chrome.scripting`, and no
  `<script>` tags pointing at a URL.
- The bundled zod library contains an optional JIT that probes for `new Function`. The
  extension turns it off with `z.config({ jitless: true })` (`lib/zod-config.ts`, imported
  first by the background, popup, options and side panel), so that code never runs and
  nothing is ever compiled from a string.
- The MAIN-world script on youtube.com (`entrypoints/youtube-bridge.content.ts`) is a
  bundled content script.
- Responses from YouTube, the GrowTube server and the AI provider are JSON or text, checked
  with zod schemas. AI output is rendered by `components/common/Markdown.tsx` into React
  elements, with no raw HTML and no `dangerouslySetInnerHTML`.
- The declarativeNetRequest rule is defined in code (`lib/youtube/innertube.ts`), not
  downloaded.

### Data usage: what GrowTube collects

"Collect" here means the data is transmitted off the device or handled by the extension.
The CWS policy counts transmitting and local handling as "handling" user data.

| Dashboard category                  | Tick?                                          | What and why                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personally identifiable information | **Yes**                                        | Account name and email, sent to the GrowTube server at sign-up and sign-in and stored in its `user` table. A copy of the name and email is kept in `chrome.storage.local` for display.                                                                                                                                                                                                                          |
| Health information                  | No                                             | None.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Financial and payment information   | No                                             | GrowTube is free. It has no payments.                                                                                                                                                                                                                                                                                                                                                                           |
| Authentication information          | **Yes**                                        | The password, sent over HTTPS at sign-up, sign-in and account deletion. The server stores only a hash, never the password itself. The session token is stored in the extension's own IndexedDB and in the server's `session` table, with no IP address or user agent. The user's AI API key is stored in `chrome.storage.local` and sent only to the AI provider the user configured.                           |
| Personal communications             | No                                             | AI Coach chats are conversations with the user's own AI provider, not messages between people. They are stored locally (`local:aiConversations`), go only to the provider the user configured, and never reach GrowTube.                                                                                                                                                                                        |
| Location                            | No (recommended; see Owner decision 4)         | GrowTube does not collect location. YouTube's region code (`gl`) is read from the YouTube page and sent back only to YouTube. The server does not store IP addresses. It keeps only a keyed hash of the IP, for 2 to 30 minutes, to rate-limit sign-in attempts. Cloudflare, the host, sees IPs as any web host does.                                                                                           |
| Web history                         | **Yes** (recommended; see the reasoning below) | Ids of the public YouTube videos and channels the user opens or sees are sent to the GrowTube server for stats and view-history lookups. If the user opts in to shared stats, their titles and public counts are uploaded too.                                                                                                                                                                                  |
| User activity                       | No                                             | Nothing records clicks, mouse position, scrolling, keystrokes or network traffic. The Shorts keyboard shortcuts are handled on the page and never recorded. The declarativeNetRequest rule only touches the extension's own requests.                                                                                                                                                                           |
| Website content                     | **Yes**                                        | The extension reads YouTube page data (titles, descriptions, public counts, captions) and, in Studio, the title, description and tags the user is editing. If the user opts in, it uploads public stats of public videos and channels. Studio content and transcripts never reach the GrowTube server. They go only to YouTube (tag-rank searches) or to the user's AI provider when the user asks for AI help. |

**Why "Web history" is ticked.** Google defines web history as the list of pages a user has
visited, with data such as page title and time of visit. Signed in, the watch panel and the
feed badges look up the ids of the public YouTube videos a user opens and of the videos on
public listing pages. With "Share public stats" on (an opt-in: an unticked checkbox on the
sign-in form, or the switch in the popup and Settings), GrowTube also sends their titles
and public counts. All of these requests carry the user's login token. The sign-in form
discloses both before anything is sent, which is the in-product disclosure the User Data
FAQ asks for. The
server stores the stats with no account id (`apps/server/src/routes/ingest.ts`), and its
logs record route patterns only. But the data still leaves the device during an
authenticated request, and the policy's "handling" includes transmitting. Ticking the box
is the honest reading. Leaving it unticked risks a rejection for undisclosed data. The
privacy policy should explain that the stored stats are not linked to accounts.

**Certifications.** Tick all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single
  purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

All three are true. There are no ads, no analytics, and no third-party SDKs that receive
data. Shared stats are shown back to GrowTube users as view history and Trends, which is
the single purpose.

### Privacy policy URL

`https://growtube.meabhisingh25.workers.dev/privacy`

The page is `apps/web/src/routes/privacy.tsx`. It is live (the website is deployed with
single-page-app fallback, so it loads directly), and it must match the table above. Check
that it covers each of these:

- Who runs GrowTube, and a contact email: set `OPERATOR` (the developer name the dashboard
  shows) and `CONTACT_EMAIL` at the top of `privacy.tsx`. They ship as `null`: until they
  are set, the page leaves the name out and points contact requests to GitHub issues
  (Owner decision 1).
- The data collected: account (name, email, hashed password), sessions (token and expiry,
  no IP or user agent), stats lookups by id (including competitors' channels and Trends
  searches), shared public stats (what fields, stored with no account id, opt-in switch,
  the unlisted/private and personal-page exclusions), and the keyed IP hash for sign-in
  rate limits (2 to 30 minutes).
- What stays local: AI key, AI chats, settings, cache. AI requests go directly to the
  user's chosen provider, under that provider's own privacy policy.
- Deletion: Settings → Account → Delete account removes the account, its sessions and its
  API keys. Shared stats were never linked to the account, so they remain.
- No sale and no ads. Include an explicit statement that the use of data obtained through
  the extension complies with the Chrome Web Store User Data Policy, including the Limited
  Use requirements.
- If the production server has `YOUTUBE_API_KEY` set: say that GrowTube uses YouTube API
  Services, and link the Google Privacy Policy (YouTube API Services Developer Policies).

---

## 3. Test instructions tab

Before submitting, create a dedicated reviewer account. Do it on the live site
(`https://growtube.meabhisingh25.workers.dev/login?mode=sign-up`) or from the extension's
sign-up form. No email confirmation is needed. Don't reuse a personal
account. Paste the account's email and password into the dashboard's username and password
fields (or into the text below), and paste the steps into the instructions field:

```text
GrowTube requires a free account. Test account for review:
Email: <reviewer test email>
Password: <reviewer test password>
(You can also create your own account in the extension: any name, an email address and a password of 8+ characters. No email confirmation is needed.)

1. After installing, the GrowTube settings page opens on "Account". Sign in with the test account above. The sign-in form explains what GrowTube sends and has an optional, unticked "Share public stats" checkbox; you don't need to tick it.
2. Open any popular public YouTube video. A GrowTube panel appears at the top of the right-hand column (below the video in narrow windows) with views per hour and the outlier score. Switch between its Views, Overview and AI Coach tabs. The Views chart fills in as GrowTube users see a video, so a little-watched video may show only its current count.
3. Open the YouTube home page or search for anything: video cards show GrowTube badges (views per hour, outlier score).
4. Click the GrowTube toolbar icon, then "Open toolkit". In the side panel open "Keyword Research", type a seed keyword (for example "budget travel") and click "Research": keywords are listed with Volume, Competition and Overall scores.
5. In the side panel, try "Trends" (what is taking off now). On a YouTube channel page, try "Channel Audit" (stats, posting times, outliers).
6. AI features (AI Coach, Daily Ideas, AI insights, thumbnail generation, Clip Finder, Studio suggestions) need your own OpenAI-compatible API key, or a free local model (Ollama or LM Studio), set in Settings → AI. GrowTube does not supply a key, so you can skip these. Every other feature works without AI.

Privacy controls: Settings → Server & privacy lists exactly what the server stores and has the "Share public stats" switch (also in the popup, off by default). Settings → Account → Delete account removes the account.
```

---

## 4. Distribution tab

- **Payments / pricing**: free. GrowTube has no in-app purchases.
- **Visibility**: **Unlisted** for the first upload. Install it from the store link and run
  the test steps against production, then switch to **Public**. Switching doesn't need a
  new package, but it may be reviewed again. You can also use **Private** with trusted
  testers. To control when it goes live, choose to publish manually after review instead of
  automatically.
- **Regions**: All regions.

---

## 5. Pre-submission checklist

- [ ] The server is live: `https://growtube-api.meabhisingh25.workers.dev/health` returns OK.
- [ ] The website is live at `https://growtube.meabhisingh25.workers.dev`, and `/privacy` is
      live and matches section 2: `curl -sI https://growtube.meabhisingh25.workers.dev/privacy`
      returns 200, and the page renders when loaded directly while signed out.
- [ ] `OPERATOR` and `CONTACT_EMAIL` in `apps/web/src/routes/privacy.tsx` are filled in
      (not `null`) and deployed: the page names the operator and shows the contact email.
- [ ] The reviewer test account exists on production, and you can sign in with it from a
      production build.
- [ ] The version in `apps/extension/package.json` (WXT takes the manifest version from it)
      is `1.0.0` for the first upload. Increase it on every later upload.
- [ ] The ZIP is built with `pnpm --filter extension zip:store`, which builds with the
      production `WXT_SERVER_URL` / `WXT_WEB_URL` from `.env.store`. Upload
      `apps/extension/.output/growtube-<version>-chrome.zip`, never a `*-localhost.zip`
      (that name marks a build against a plain-http server). `zip:store` refuses to write
      the ZIP if the build points anywhere but `.env.store`'s server.
- [ ] Open `manifest.json` in the ZIP. `permissions` should be `storage`, `unlimitedStorage`,
      `sidePanel`, `alarms`, `declarativeNetRequestWithHostAccess` (no `tabs`), and
      `host_permissions` should be `*://*.youtube.com/*`,
      `https://suggestqueries-clients6.youtube.com/*` and
      `https://growtube-api.meabhisingh25.workers.dev/*` (no `i.ytimg.com`, no
      `http://localhost/*`). The name, description and version should be the ones you
      expect.
- [ ] The GitHub repo the listing links (description, support URL, privacy contact) is
      pushed and public with Issues on (Owner decision 2).
- [ ] The developer account has a verified contact email (`<your support email>`) and has
      completed its trader / non-trader declaration.
- [ ] After approval, set `EXTENSION_ORIGINS=chrome-extension://<store item id>` on the
      server (Owner decision 13). The item id is shown in the dashboard from the first
      upload.

---

## 6. Owner decisions

Already done in the code (re-check only if the code changes): `tabs` and `i.ytimg.com`
removed from the manifest; "Share public stats" is opt-in (off by default, an unticked
checkbox on the sign-in form) and the sign-in form discloses the stats lookups and uploads
with a privacy-policy link; zod's JIT is off; the YouTube page bridge passes only the
public client identity (no sign-in state, session ids or visitor id); a padded 128 px
store icon exists; screenshot 1 no longer shows invented view history and the stand-in
Studio screenshot was dropped; a ZIP built against a plain-http server is named
`*-localhost.zip`; the listing and website say "source code on GitHub" instead of "open
source"; the website is deployed with single-page-app fallback, so
`https://growtube.meabhisingh25.workers.dev/privacy` returns 200 and renders when loaded
directly (prerendering it to static HTML, for checkers that don't run JavaScript, stays an
optional improvement).

Still open, by priority:

1. **Fill in the privacy contact (required).** `OPERATOR` and `CONTACT_EMAIL` in
   `apps/web/src/routes/privacy.tsx` are `null` for now: while they are, the page leaves
   the name out and points contact requests to GitHub issues. Set `OPERATOR` (the developer
   name the dashboard shows) and `CONTACT_EMAIL` (the developer account's public contact
   email), then redeploy with `pnpm run deploy`. Privacy, deletion and
   children's-data requests shouldn't go only to public GitHub issues.
2. **Push the repo and make it public (required while the listing links it).** The listing's
   GitHub link, the support URL and the policy's second contact point at
   `github.com/meabhisingh/growtube`, which is empty today. Turn Issues on. Add a LICENSE
   (for example MIT or AGPL-3.0) if you want to call GrowTube "open source" again; without
   one it is source-available, and every text now says "source code on GitHub". The
   server's MCP instructions (`apps/server/src/mcp/server.ts`) still say "open-source":
   change that with the next server deploy.
3. **Take user data out of query strings (recommended before submitting).** Video ids
   (`GET /v1/videos/stats?ids=`, `/v1/videos/{id}/history`), channel ids
   (`/v1/channels/{id}/history`) and Trends search text (`GET /v1/trending?q=`) are in
   request URLs, and the store's troubleshooting page says not to put user data in query
   parameters even over HTTPS. After the current server deploy, add POST routes that take a
   JSON body (`/v1/videos/stats`, `/v1/videos/history`, `/v1/channels/history`,
   `/v1/trending`), switch `lib/api.ts` to them, keep the GET routes for the web app and
   MCP, bump the version and rebuild. Not done here: it needs a server change.
4. **Web history: ticked; Location: unticked (recommended).** See section 2. The only
   IP-derived data is a keyed hash kept 2 to 30 minutes for abuse rate limits, a security
   use Limited Use allows. Tick "Location" too only if you want maximum caution.
5. **Screenshots.** The four screenshots show real public YouTube pages and creators
   (Natashas Kitchen and others): normal for YouTube tools, but re-capture with other
   videos if you prefer. Screenshot 4's AI Coach answer is a canned reply from a local mock
   provider; re-capture it with your real provider before submitting if you want every
   word to be real output. A Studio screenshot can come back once it is captured on the
   real studio.youtube.com (throwaway profile, test channel, private demo upload, no
   channel name or email in view).
6. **`*://*.youtube.com/*` is broader than what is used (optional).** Features use www,
   studio and suggestqueries-clients6 over https, and the MAIN-world bridge matches every
   subdomain. Narrowing to `https://www.youtube.com/*` and `https://studio.youtube.com/*`
   (and the bridge's `matches` to those two) changes the warning from "all youtube.com
   sites" to a host list, but needs a full re-test of InnerTube, captions and
   autocomplete. Recommendation: keep it for 1.0.0; the justification covers it.
7. **Optional `https://*/*` and `http://*/*`.** Needed so users can pick any AI provider,
   a local model or a self-hosted server; nothing is granted at install. They may trigger
   an in-depth review; the host justification explains them. Keep.
8. **`suggestqueries-clients6.youtube.com` is redundant** with `*://*.youtube.com/*`. It
   adds no warning; keep it for clarity or remove it.
9. **Official URL** needs Search Console verification of the workers.dev site (see
   section 1). It is optional.
10. **Summary change means a manifest change.** If you adopt the proposed summary, edit
    `description` in `wxt.config.ts`. The dashboard can't override it.
11. **Header rewrite scrutiny.** The declarativeNetRequest rule makes the extension's own
    InnerTube requests look like they come from youtube.com. The justification above
    states this plainly. Keep the rule limited to the extension's own initiator so the
    answer stays true.
12. **YouTube API Services wording.** If the production server sets `YOUTUBE_API_KEY`, the
    policy's "GrowTube uses YouTube API Services" section is accurate. If it never does,
    the server only uses the keyless oEmbed endpoint; consider rewording that section.
13. **`EXTENSION_ORIGINS`.** Unset, the server accepts sign-in and sign-up from any
    `chrome-extension://` origin (only on those two endpoints, `packages/auth`). Setting it
    to the store id after approval locks this down. A locally loaded unpacked build has a
    different id and then can't sign in to production unless you add its id too
    (comma-separated).
14. **Website and API are the same site (no action).** The Public Suffix List has
    `workers.dev` itself (not `*.workers.dev`), so the registrable domain is
    `meabhisingh25.workers.dev` and `growtube.*` and `growtube-api.*` are same-site: the
    session cookie is first-party and isn't hit by third-party cookie blocking. A custom
    domain is optional. Re-check this only if the two hosts ever move to different
    accounts or domains.
15. **`.env.store` is committed.** It holds only the public workers.dev URLs (they are in
    this listing anyway) and the `GROWTUBE_STORE_ZIP` marker. Forks edit it for their own
    deployment. Keep it committed.
16. **Promo tiles carry the name and tagline.** The image guidelines say to avoid text;
    the two short lines are the only text and read at half size. Keep, or drop the
    tagline.
17. **Certification wording.** The three lines in section 2 are quoted from memory of the
    dashboard. Confirm the exact text there.

---

## Sources

- Chrome Web Store program policies: https://developer.chrome.com/docs/webstore/program-policies/policies
- Fill out the privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Complete your listing information: https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- Provide test instructions: https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions
- Distribution: https://developer.chrome.com/docs/webstore/cws-dashboard-distribution
- User Data FAQ: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- Limited Use: https://developer.chrome.com/docs/webstore/program-policies/limited-use
- Disclosure requirements: https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements
- Single purpose (quality guidelines): https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines
- Remotely hosted code: https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
- Permission warnings: https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings
- Permissions list (warning per permission): https://developer.chrome.com/docs/extensions/reference/permissions-list
- `chrome.tabs` (which fields need `tabs` or host permissions): https://developer.chrome.com/docs/extensions/reference/api/tabs
- Manifest `description` (132 characters): https://developer.chrome.com/docs/extensions/reference/manifest/description
- Supplying images: https://developer.chrome.com/docs/webstore/images
- Listing best practices and categories: https://developer.chrome.com/docs/webstore/best-practices
- WXT publishing (`wxt zip`): https://wxt.dev/guide/essentials/publishing
