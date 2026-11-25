# GrowTube extension core (`apps/extension/lib`)

The API every UI in the extension builds on. Path aliases: `@/` = `apps/extension/`.

Golden rules

1. **All network work happens in the background service worker.** Content scripts and
   extension pages never call YouTube, the server or the AI provider directly: they use the
   typed facades in `@/lib/client` (`yt`, `server`, `ai`, `ext`), which message the
   background. One cache, one rate limiter, no CORS problems.
2. **Reuse what YouTube already loaded.** On youtube.com, get the current video with
   `getCurrentVideoDetails()` from `@/lib/youtube/page` (seeds the background from the page's
   own player response) and react to SPA navigation with `onNavigate()`.
3. **Never break YouTube.** Injected UI goes in a shadow root with plain CSS and must be
   readable in both YouTube themes (`<html dark>` = dark). Extension pages use Tailwind +
   `@growtube/ui`.
4. **No limits, no paywalls, no upgrade prompts.** Everything is free and unlimited.
5. Data is JSON-safe everywhere: timestamps are ISO strings, unknown values are `null`.
6. **No use without an account.** Every surface gates itself on `authUser` (`@/lib/auth`)
   and the background refuses everything but sign-in while signed out. See
   [§0 Account](#0-account-sign-in-required).
7. **Only public videos are uploaded.** Unlisted and private videos are never uploaded
   (`isPublicVideo()` in `@/lib/youtube/visibility`), and never looked up once the extension
   knows they are not public. Feed badges on public listings (home, search, subscriptions,
   channels) look cards up by id before their listing is known; on personal pages (history,
   library, playlists: `isPersonalPage()`) nothing is looked up or uploaded.

```
lib/
  client.ts             yt / server / ai / ext / account facades (use these from UI code)
  auth.ts               authUser storage item (token-free) + helpers (any context)
  auth-session.ts       bearer token, sign-in/up/out, refresh, delete (background only)
  messaging.ts          protocol types, sendToBackground, background router
  background-handlers.ts  background implementation of every message (background only)
  settings.ts           WXT storage items (user settings)
  planner.ts            Content planner: addPlannerIdea, export/import (any context)
  context.ts            "current context" for the side panel (storage.session)
  hooks.ts              useStorageItem, useBackground, useYouTubeDarkTheme
  cache.ts              TTL cache + in-flight dedupe (memory + chrome.storage.local)
  limiter.ts            createLimiter, withRetry, HttpError
  permissions.ts        optional host permissions (AI provider / server URL)
  api.ts                GrowTube server client + ingest queue (background only)
  dom.ts                waitForElement, isYouTubeDark, onYouTubeThemeChange
  theme.ts              applyColorScheme() for extension pages
  env.ts                DEFAULT_SERVER_URL (WXT_SERVER_URL)
  youtube/              InnerTube data layer (+ bridge, page helpers, parsers, fixtures;
                        visibility.ts: which videos may reach the server)
  ai/                   AI provider layer, prompts, streaming chat
components/common/      Markdown, AreaChart, Sparkline, CopyButton, Logo (no Tailwind)
assets/tailwind.css     Tailwind entry for extension pages
assets/brand/          logo-source.png: logo master (scripts/generate-icons.mjs)
```

---

## 0. Account (sign-in required)

GrowTube is unusable without an account on the configured GrowTube server (better-auth
email + password with its bearer plugin, mounted at `AUTH_BASE_PATH` = `/api/auth`; constants
in `@growtube/shared/auth`). It stays free: no plans, credits or quotas, ever.

### Storage

| Item                    | Area                                         | Contents                                                    | Read by                                            |
| ----------------------- | -------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| `local:authUser`        | `chrome.storage.local`                       | `SignedInUser` = `{ id, name, email, serverUrl }` or `null` | everything (UI gating, `useStorageItem`, `.watch`) |
| token                   | IndexedDB `ovq-auth` of the extension origin | `{ token, serverUrl }`                                      | **background only** (`lib/token-store.ts`)         |
| `session:authCheckedAt` | `chrome.storage.session`                     | ms epoch of the last successful session check               | background only                                    |

The token is not in `chrome.storage.local` because Chrome lets every content script read
that area, and content scripts run inside youtube.com's renderer process. A content script's
`indexedDB` is the web page's, so the extension origin's database is out of its reach (the
MAIN-world bridge has no extension APIs at all). It survives browser restarts, unlike
`storage.session`. Older versions kept it as `local:authToken`; that item is deleted unread
(content scripts can write storage.local, so a value found there is never trusted), and those
users sign in once more. Saving writes the token, then `authUser`; clearing deletes the
token, then `authUser`; a user item left without a token is cleared at the next check, and a
token without a user item is re-validated. The token is never sent over runtime messaging,
never part of a message response, never exported (`SETTINGS_ITEMS` doesn't include it) and
never read outside the background (the options page only deletes it, as the "Reset all data"
fallback when the background can't be reached).

### Messages (`account` in `@/lib/client`, extension pages only)

| Message              | Request                     | Response                             |
| -------------------- | --------------------------- | ------------------------------------ |
| `auth.signIn`        | `{ email, password }`       | `SignedInUser`                       |
| `auth.signUp`        | `{ name, email, password }` | `SignedInUser` (signs in right away) |
| `auth.signOut`       | `{}`                        | `{ ok: true }`                       |
| `auth.refresh`       | `{}`                        | `SignedInUser \| null`               |
| `auth.deleteAccount` | `{ password }`              | `{ deleted, emailConfirmation }`     |

The background answers `auth.*` only for senders whose URL is one of our extension pages;
content scripts get `FORBIDDEN`. `signIn` / `signUp` / `deleteAccount` are never resent
automatically. Error codes (`BackgroundError.code`; messages are user-presentable):
`BAD_CREDENTIALS`, `EMAIL_TAKEN`, `WEAK_PASSWORD`, `INVALID_EMAIL`, `INVALID_NAME`,
`WRONG_PASSWORD` (delete), `PERMISSION` (no host permission for a custom server URL: pages call
`ensureOriginPermission(serverUrl)` in the submit handler first; the popup sends the user to
Settings instead because it closes when Chrome's prompt opens), `NETWORK`, `RATE_LIMITED`,
`ORIGIN` (the server's better-auth `trustedOrigins` lacks the extension's origin),
`UNSUPPORTED`, `FORBIDDEN`, `AUTH_REQUIRED`, `HTTP`, `INVALID_RESPONSE`.

### Flow (background, `lib/auth-session.ts`)

- Sign-in / sign-up: POST `${serverUrl}/api/auth/sign-in/email` or `/sign-up/email` with
  `credentials: "omit"`; the token comes from the `set-auth-token` response header (the body's
  `token` as a fallback). A sign-up answered without a token is followed by a sign-in.
- Every later request sends `Authorization: Bearer <token>`, still with credentials "omit".
- `GET /get-session` validates the session when the browser starts (once per browser session,
  via `session:authCheckedAt`) and every 12 h (alarm `ovq:auth-refresh`). A `null` session (or
  a 401) signs out; network errors, 429 and 5xx keep the local state. A rotated token or a
  renamed user is saved.
- Sign-out clears the token and `authUser` first, then POSTs `/sign-out` (best effort, 5 s
  timeout).
- A new `serverUrl` signs out (the old session is revoked on the old server, best effort).
- "Reset all data" (options) signs out before deleting everything else.
- Delete account: POST `/delete-user { password }`; on success the token and `authUser` are
  cleared.
- A `/v1/*` 401 with `{ code: "AUTH_REQUIRED" }` signs out locally (only if the failing token
  is still the stored one) and the ingest queue is dropped.

### Gating ("no use without login")

- **Background**: every message except `auth.*`, `api.health`, `yt.setConfig`,
  `sidepanel.open`, `context.*`, `options.open`, `cache.clear` and `tab.self` throws
  `AUTH_REQUIRED` while signed out, before doing any work; the `ai-chat` Port answers with an
  `AUTH_REQUIRED` error. `lib/api.ts` sends nothing but `/health` without a token, queues no
  snapshots and drops what's queued. Signing in resets the ingest backoff, so lookups and
  ingestion resume at once; signing out also clears the cached `srv:` answers.
- **Popup / side panel**: only `SignInScreen` (`components/pages/account/AuthForm.tsx`); no
  tool is mounted, so nothing loads.
- **Options**: Account and Server & privacy stay usable (the server URL decides where you
  sign in); every other section is hidden behind a "Sign in to see the rest" notice. First
  install opens `options.html#account`.
- **youtube.com**: feed badges and Shorts controls (and their keyboard shortcuts) are stopped;
  the watch panel renders only a compact "Sign in to use GrowTube" card whose button opens
  `options.html#account`. **Studio**: the panel renders nothing. Everything follows
  `authUser.watch` live: no reload after signing in or out.
- The extension has no context menus or manifest commands; if you add any, check `authUser`
  in their handlers.
- `ErrorNotice` offers a "Sign in" button for `AUTH_REQUIRED` errors.

---

## 1. Calling the background: `@/lib/client`

```ts
import { ai, ext, server, yt, BackgroundError } from "@/lib/client";
```

Every function returns a Promise and throws `BackgroundError` (`.message` is user-presentable,
`.code` is machine-readable, see [Errors](#errors)).

### `yt` — YouTube data (cached in the background)

| Function                                                                                                                                            | Returns                             | Cache       |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------- |
| `yt.getVideoDetails(videoId, { level?, seed?, force?, crowdsource? })`                                                                              | `VideoDetails`                      | 10 min      |
| `yt.getVideoDetailsBatch(videoIds, level = "basic", { crowdsource? })`                                                                              | `Record<id, VideoDetails \| null>`  | 10 min each |
| `yt.getChannel(ref, { force?, crowdsource? })` — `ref` = `{ channelId }` or `{ handle: "@x" }`                                                      | `ChannelInfo`                       | 6 h         |
| `yt.resolveHandle("@carandbike")`                                                                                                                   | channel id `"UC…"`                  | 6 h         |
| `yt.getChannelVideos(channelId, { tab?: "videos"\|"shorts"\|"streams", limit? = 30 })`                                                              | `ChannelVideo[]` (newest first)     | 1 h / page  |
| `yt.getChannelVideosPage(channelId, { tab?, continuation? })`                                                                                       | `ChannelVideosPage` (manual paging) | 1 h         |
| `yt.getChannelBaseline(channelId, "long" \| "short", { force? })`                                                                                   | `ChannelBaseline`                   | 6 h         |
| `yt.search(query, { limit? = 20, type?, sort?, force?, crowdsource? })` — `type`: `"all"\|"video"\|"short"`, `sort`: `"relevance"\|"date"\|"views"` | `SearchResponse`                    | 30 min      |
| `yt.findVideoRank(query, videoId, depth = 40)`                                                                                                      | `number \| null` (1-based)          | via search  |
| `yt.findVideoRanks(videoId, queries[], depth = 40)`                                                                                                 | `Record<query, number \| null>`     | via search  |
| `yt.getSearchSuggestions(query, { hl?, gl? })`                                                                                                      | `string[]`                          | 1 day       |
| `yt.getTranscript(videoId, { lang?, extraTracks? })`                                                                                                | `Transcript \| null`                | 1 day       |

```ts
const video = await yt.getVideoDetails("dQw4w9WgXcQ");
// { views: 1839597275, likes: 19514481, comments: 2462426, commentsExact: true,
//   publishedAt: "2009-10-25T06:57:33.000Z", keywords: [...27 tags], category: "Music", ... }

const channel = await yt.getChannel({ handle: "@carandbike" });
// { channelId: "UCGRIgtqal_cC7V_cD-Zylkg", subscribers: 685000, totalViews: 318506068,
//   videoCount: 7342, joinedAt: "2015-10-28", country: "India", keywords: [...], ... }

const { baseline } = await yt.getChannelBaseline(
	channel.channelId,
	video.isShort ? "short" : "long",
);
const outlier = computeOutlierScore(video.views, baseline); // from @growtube/shared

const ranks = await yt.findVideoRanks(video.videoId, video.keywords); // tag rank badges
```

**`level`**: `"full"` (default) = `player` + `next` + comments header: exact comments,
owner handle/subscribers. `"basic"` = `player` only (1 request): exact views, likes,
publish date, tags, duration. A cached `"full"` result also satisfies `"basic"`.

**Feed badges**: prefer `server.getVideosStats(ids)` (one request for 50 ids, includes
server-side recent VPH) and only call `yt.getVideoDetailsBatch(ids)` for visible cards the
server doesn't know (`missing`). Batch is capped at 200 ids per call. On personal pages
(`isPersonalPage(location.href)`: watch history, library, playlists) skip the server and
pass `{ crowdsource: false }` to `yt.getVideoDetailsBatch` and `yt.getChannel`, so nothing
from them is looked up or uploaded. The same opt-out keeps YouTube Studio out of the server
(`yt.getVideoDetails` of the edited video, `yt.search` for tag ranks), and a non-public
video's channel: the watch panel, the coach context and "channel of this video" lookups
pass `crowdsource: isPublicVideo(video)` (the watch panel uploads the channel itself, only
for a public video).

**Ranks**: positions count every video-like result in page order, Shorts included
(a Shorts shelf contributes its items). Personalization-free (anonymous requests).

### `server` — GrowTube server (crowdsourced history, trending)

Every call needs a signed-in user (else `AUTH_REQUIRED`), except `health()`.

| Function                                                                               | Returns                                                        |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `server.health()`                                                                      | `{ ok, serverUrl, error? }`                                    |
| `server.getVideoHistory(videoId, range = "24h" \| "7d" \| "28d" \| "all", { force? })` | `VideoHistoryResponse`                                         |
| `server.getChannelHistory(channelId, { force? })`                                      | `ChannelHistoryResponse`                                       |
| `server.getTrending({ window?, type?, q?, limit?, force? })`                           | `TrendingResponse`                                             |
| `server.getVideosStats(videoIds)`                                                      | `VideoStatsResponse` (`videos[]` + `missing[]`, chunked by 50) |
| `server.ingestVideos(snapshots)` / `server.ingestChannels(snapshots)`                  | `{ queued }`                                                   |

Types/schemas come from `@growtube/shared` (`api.ts`, `api-extra.ts`). You rarely need
`ingest*`: **the background automatically queues a snapshot for every video/channel it
fetches** (getVideoDetails, getVideoDetailsBatch, getChannel, and search results with exact
view counts), when `crowdsourceStats` is on and the user is signed in. Unlisted and private
videos are skipped (`snapshotFromVideo` returns null unless `isPublicVideo(d)`), and the
background remembers their ids (also in `storage.session`, so a worker restart keeps them)
so `ingestVideos`, `getVideosStats` (reported as `missing`) and `getVideoHistory`
(`PRIVATE_VIDEO` error) never send them either. Ids whose listing nobody has checked yet
can still be looked up (feed badges on public listings); personal pages never are, see
`isPersonalPage()`. Uploads carry the bearer
token like every /v1 call, but the server doesn't link them to the account. Signed out,
nothing is queued and the queue is dropped. The queue is debounced (5 s or 50 items),
capped (3,000 videos / 1,000 channels, oldest dropped), persisted in `storage.session`
with a 1 s debounce, retried by an alarm every minute, and de-duplicated (same id at
most once per 10 min). After a failed flush (server unreachable, no host permission,
5xx/429) it backs off exponentially (30 s up to 30 min); after two failures in a row
nothing new is queued until a retry succeeds. Changing the server URL or granting a
host permission resets the backoff (`resetIngestBackoff()` in `lib/api.ts`).

### `ai` — the user's own OpenAI-compatible provider

| Function                                                                               | Returns                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ai.status()`                                                                          | `AiStatus` `{ configured, hasPermission, ready, problem, providerLabel, model, reasoningEffort, ... }` |
| `ai.complete(messages, { json?, model?, temperature?, maxTokens?, reasoningEffort? })` | `{ text, json? }`                                                                                      |
| `ai.generate(kind, input, { model?, temperature? })`                                   | typed, zod-validated output (see §5)                                                                   |
| `ai.listModels({ baseURL?, apiKey?, presetId? })`                                      | `AiModelInfo[]` `{ id, shutdownDate: "YYYY-MM-DD" \| null }` (pass unsaved settings to preview)        |
| `ai.test()`                                                                            | `{ ok, model, reply, attempts, adjustments[] }`                                                        |
| `ai.generateImage(prompt, { size?, quality?, model?, n? })`                            | `{ images: string[] (data URLs), size: string \| null, adjustments[] }`                                |

`maxTokens` is optional and nothing is sent without it. On reasoning models it includes the
reasoning tokens, so keep it generous (thousands, not 16). Parameters are adapted per model
automatically, see [§5 Adaptive request parameters](#adaptive-request-parameters).
Streaming chat uses a Port, see [§5 AI](#5-ai).

### `ext` — extension plumbing

| Function                                               | Notes                                                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ext.openSidePanel(context?)`                          | Opens the side panel for the sender tab. **Call from a click handler** (needs a user gesture). Stores `context` first.                         |
| `ext.setContext(context \| null)` / `ext.getContext()` | Current context for the side panel (see §3).                                                                                                   |
| `ext.openOptions(hash?)`                               | Opens the options page (optionally `options.html#ai`).                                                                                         |
| `ext.clearCache(prefix?)`                              | Clears the YouTube/server cache. Prefixes: `video:`, `channel:`, `chvids-page:`, `baseline:`, `search:`, `suggest:`, `transcript:`, `handle:`. |
| `ext.tabSelf()`                                        | `{ tabId, windowId }` of the calling content script.                                                                                           |

From an **extension page** (popup/options) open the side panel with
`openSidePanelFromPage(context?, { closePopup? })` from `@/lib/sidepanel` (in the click
handler) instead of `ext.openSidePanel`, which targets the sender's tab.

### Lower level: `sendToBackground`

```ts
import { sendToBackground, type Protocol } from "@/lib/messaging";
const details = await sendToBackground("yt.getVideoDetails", {
	videoId,
	level: "basic",
});
```

`Protocol` (in `lib/messaging.ts`) is the single source of truth: an interface mapping each
message `type` to `{ req, res }`. The wire format is a discriminated union
`{ __ovq: 1, type, payload }` → `{ __ovq: 1, ok: true, data } | { __ovq: 1, ok: false, error, code?, status? }`.
To add a message: add it to `Protocol`, then implement it in `lib/background-handlers.ts`
(the `Handlers` type forces you to). The router ignores messages without `__ovq: 1`, so other
`runtime.onMessage` listeners keep working.

While a handler runs, the router keeps the service worker alive (a trivial extension API
call every 20 s, `keepAliveWhile` in `lib/keepalive.ts`), so slow AI calls aren't cut off
by Chrome's 30 s idle / slow-fetch shutdown; the `ai-chat` Port does the same. A send that
never reached the worker ("Receiving end does not exist") is retried. One whose worker
died mid-request is retried only for idempotent types, never for `ai.*`, `options.open` or
`sidepanel.open`, so a paid request is never sent twice.

### Errors

`BackgroundError { message, code, status, type }`. Codes you may want to branch on:

| code                                                                             | meaning / suggested UI                                                                                                                                |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_REQUIRED`                                                                  | signed out of GrowTube → `ext.openOptions("account")` (ErrorNotice offers it)                                                                         |
| `NOT_CONFIGURED`                                                                 | AI not set up → button `ext.openOptions("ai")`                                                                                                        |
| `PERMISSION`                                                                     | host permission missing for the AI provider or server URL → open options; the options page must call `ensureOriginPermission(url)` in a click handler |
| `AUTH`, `MODEL`, `RATE_LIMIT`, `OLLAMA_ORIGIN`, `NO_IMAGE_SUPPORT`, `BAD_OUTPUT` | AI provider problems; `message` is actionable as-is. `MODEL` = the model id is unknown/retired                                                        |
| `PARAMS`                                                                         | the provider still rejected a request parameter after the automatic adjustments (never labelled as a model problem) → AI settings                     |
| `TIMEOUT`                                                                        | no answer within the 10-minute client timeout; the request was not resent → AI settings (lower Reasoning effort / image quality)                      |
| `NETWORK`                                                                        | offline / server or local AI not running                                                                                                              |
| `NOT_FOUND`                                                                      | video/channel doesn't exist or is private                                                                                                             |
| `RATE_LIMITED`                                                                   | YouTube 429 after retries; try again later                                                                                                            |
| `HTTP`, `INVALID_RESPONSE`                                                       | server returned an error / unexpected body                                                                                                            |
| `CONTEXT_INVALIDATED`                                                            | extension was reloaded; ask the user to refresh the tab                                                                                               |

---

## 2. React hooks: `@/lib/hooks`

```ts
import {
	useBackground,
	useStorageItem,
	useYouTubeDarkTheme,
} from "@/lib/hooks";
```

- `useStorageItem(item) → [value, setValue, loading]` — live-bound to any WXT storage item
  (updates when changed in another tab/context). `setValue(next | (prev) => next)`.

  ```tsx
  const [flags, setFlags] = useStorageItem(features);
  <Checkbox checked={flags.feedBadges} onCheckedChange={(v) => setFlags((f) => ({ ...f, feedBadges: !!v }))} />
  ```
- `useBackground(type, payload | null, deps) → { data, error, loading, refetch }` — calls a
  background handler; pass `null` payload to skip.

  ```tsx
  const { data: channel, loading, error } = useBackground("yt.getChannel", channelId ? { ref: { channelId } } : null, [channelId]);
  ```
- `useYouTubeDarkTheme() → boolean` — youtube.com content scripts only.
- `useAiChat()` lives in `@/lib/ai/use-ai-chat` (see §5).

All hooks work inside shadow roots and extension pages.

---

## 3. Settings & context

### `@/lib/settings` (WXT storage items, `chrome.storage.local`)

| Item                 | Type                                                                                                     | Default                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `aiProvider`         | `AiProviderSettings { presetId, baseURL, apiKey, model, imageModel, temperature, reasoningEffort }` (v2) | OpenAI preset (`gpt-6-luna`, `gpt-image-2.6-sunburst`), empty key, effort `""` |
| `serverUrl`          | `string`                                                                                                 | `WXT_SERVER_URL` or `http://localhost:3000`                                    |
| `crowdsourceStats`   | `boolean` (opt-in: the sign-in form, popup or Settings turns it on)                                      | `false`                                                                        |
| `myChannel`          | `{ channelId, handle, title } \| null`                                                                   | `null`                                                                         |
| `competitors`        | `{ channelId, handle, title, avatarUrl }[]`                                                              | `[]`                                                                           |
| `features`           | `{ feedBadges, watchPanel, shortsControls, studioOptimizer }`                                            | all `true`                                                                     |
| `shortsDefaultSpeed` | `number`                                                                                                 | `1`                                                                            |
| `aiConversations`    | `AiConversation[] { id, title, createdAt, updatedAt, messages: UiChatMessage[], context? }`              | `[]`                                                                           |
| `savedIdeas`         | `SavedIdea[] { id, title, description?, source, createdAt, videoId?, channelId?, tags?, done? }`         | `[]`                                                                           |
| `plannerIdeas`       | `PlannerIdea[]` (type in settings.ts; write via `@/lib/planner`, max 500)                                | `[]`                                                                           |
| `earningsNiches`     | `Record<channelId, NicheId>` earnings niche picks                                                        | `{}`                                                                           |
| `onboardingDone`     | `boolean`                                                                                                | `false` (background opens `options.html#account` on install while false)       |

Account state is not a setting: `authUser` lives in `@/lib/auth` (see §0) and is not part of
`SETTINGS_ITEMS` or the export.

Also: `SETTINGS_ITEMS` (all items, for export/reset), `DEFAULT_AI_PROVIDER`,
`DEFAULT_FEATURES`, `newId()`, `withProviderDefaults(value)` (fills fields missing from
older/imported values; `getProviderSettings()` in the background always uses it), and
`aiModelCaps` (learned per-model request capabilities, a cache: not exported, cleared by
"Reset everything").

`aiProvider` is version 2. The v1 -> v2 migration (`migrateAiProviderV2`) adds
`reasoningEffort: ""` and replaces `model` / `imageModel` only when they are exactly a v1
default GrowTube shipped for that preset (with the preset's own base URL) or an id OpenAI has
already shut down (`gpt-image-1` and its dated snapshots, `gpt-4o-2024-05-13`, `dall-e-*`,
`o1*`, `o3-mini*`, `o4-mini*`, `gpt-4.1-nano*`, `gpt-4-turbo*`, `gpt-3.5-turbo*`). User-chosen
ids that still work (including `gpt-image-1.5` / `gpt-image-1-mini` until Dec 1 2026, which the
options page flags as deprecated) and Ollama's `llama3.2` (still works, pulled locally) are left
alone.

```ts
import { aiProvider, features } from "@/lib/settings";
const p = await aiProvider.getValue();
await aiProvider.setValue({ ...p, model: "gpt-6-luna", reasoningEffort: "low" });
const unwatch = features.watch((f) => …);
```

Storage items work in content scripts too. Saving a provider in the options page:

```ts
import { ensureOriginPermission } from "@/lib/permissions";
async function onSave() {
	// click handler!
	const ok = await ensureOriginPermission(draft.baseURL); // http://localhost works too
	if (!ok) return showError("Permission is needed to call this provider.");
	await aiProvider.setValue(draft);
}
```

Same for a custom `serverUrl` that isn't the build-time default.

### Current context: `@/lib/context`

```ts
type CurrentContext = {
	videoId?;
	channelId?;
	tool?: SidePanelTool;
	prefill?;
	autoSubmit?;
	coach?: CoachContext;
	tabId?;
	at?;
};
```

Stored in `storage.session` item `currentContext`. Content scripts can't read session
storage: they call `ext.openSidePanel({ videoId, tool: "coach", prefill: "Analyze the hook", autoSubmit: true })`
or `ext.setContext(…)`. The side panel reads it with `useStorageItem(currentContext)` (live,
so it also reacts when the panel is already open) and should ignore stale ones (`at`).
`SidePanelTool` suggestions: `coach | keywords | ideas | channel | competitors | trending | transcript | clips | thumbnails` (open string).

---

## 4. YouTube data layer: `@/lib/youtube`

InnerTube (`https://www.youtube.com/youtubei/v1/{player,next,browse,search,navigation/resolve_url}`)
with an anonymous WEB client (`hl=en` always, so text parsers are English-only), plus
`suggestqueries-clients6.youtube.com` and caption `timedtext`. Max 4 concurrent requests per
context, retries on 429/5xx/network with exponential backoff (honors `Retry-After`).
Parsers deep-walk the JSON for known renderer keys (`videoRenderer`, `lockupViewModel`,
`shortsLockupViewModel`, `reelItemRenderer`, `gridVideoRenderer`, …) instead of fixed paths.

Use from **background only** (`@/lib/youtube` index). UI code uses `yt` from `@/lib/client`.
Real trimmed responses live in `lib/youtube/__fixtures__/` (captured Nov 2026) and are replayed
by `scripts/live-check.ts`.

### Types (`@/lib/youtube/types`)

```ts
VideoDetails {
  videoId, title, description, channelId, channelTitle, channelHandle: string|null,
  views: number            // exact (videoDetails.viewCount)
  likes: number|null       // exact (microformat likeCount); null if hidden
  comments: number|null; commentsExact: boolean   // exact with level "full"
  publishedAt: string|null // exact ISO UTC (microformat publishDate)
  durationSec, isShort, isLive, isLiveContent, isUpcoming, isUnlisted, isFamilySafe,
  isPrivate                // videoDetails.isPrivate
  isPublic                 // player data confirms public + listed (false if unknown): use isPublicVideo()
  keywords: string[]       // tags
  category: string|null, thumbnails: Thumbnail[], thumbnailUrl: string,
  captionTracks: CaptionTrack[]   // may be empty even when captions exist
  channelSubscribers: number|null // rounded public count (level "full")
  level: "basic"|"full", fetchedAt: string
}
ChannelInfo { channelId, handle, title, avatarUrl, bannerUrl, subscribers (rounded), totalViews (exact),
  videoCount (exact), joinedAt "YYYY-MM-DD", country, keywords, description, isVerified, links[], fetchedAt }
ChannelVideo { videoId, title, views (usually rounded: "6.3K"), viewsExact, publishedAt (approx, null for Shorts),
  publishedApprox: true, publishedText, durationSec, isShort, isLive, isUpcoming, thumbnail }
ChannelBaseline { channelId, format, baseline: number|null, sampleSize, computedAt }
SearchResponse { query, estimatedResults, correctedQuery, results: SearchResult[] }
SearchResult { position, videoId, title, channelId, channelTitle, channelHandle, views, viewsExact,
  publishedAt (approx), publishedApprox, publishedText, durationSec, isShort, isLive, thumbnail,
  source: "video"|"lockup"|"short" }      // Shorts shelf items have no channel title/date
Transcript { videoId, languageCode, kind: "manual"|"asr", segments: { start, dur, text }[] }  // seconds
YtConfig { apiKey, clientName, clientVersion, hl, gl, visitorData, source }
YtPageData { url, pageType, videoId, playerResponse, initialData, capturedAt }
```

Notes:

- **Baselines** use the ~30 newest uploads of that format, excluding videos < 24 h old and
  live/upcoming streams; median (not mean). Shorts tabs carry no dates, so the newest few
  Shorts are checked with a `basic` player call.
- **Transcripts**: caption tracks come from the ANDROID player client because WEB-client
  `timedtext` URLs now need a PoToken (they return an empty body). Preference: manual in the
  requested language (default: the spoken language = the ASR track's language), then
  auto-generated, then any manual, then any ASR; a translation (`tlang`) when you ask for a
  language that only exists as a translation. Fallback: `get_transcript` (currently rejected
  for anonymous clients, kept for when it works). Helpers: `transcriptToText(segments, { timestamps?, maxChars?, fromSec?, toSec? })`.
  `null` ("no captions") is only returned, and cached, when YouTube answered and there
  really were no usable captions. Network errors, rate limits and 5xx make
  `getTranscript` throw instead, and nothing is cached, so a retry asks again.
- **isShort**: `isShortsEligible && duration ≤ 180 s` (video details); tab/renderer based elsewhere.
- **Visibility** (`@/lib/youtube/visibility`): `isUnlisted` comes from the microformat, or from
  `videoDetails.isCrawlable === false` when a SPA player response has no microformat;
  `isPrivate` from `videoDetails.isPrivate`. `isPublic` is true only when the listing is known
  and neither flag is set (no player data = not public). `getCurrentVideoDetails()` and the
  background apply the page's own player flags on top of a cached anonymous lookup
  (`withPageRestrictions`), e.g. when the uploader views their own private video.

### Background-side functions (same names as `yt.*`)

`getVideoDetails`, `getVideoDetailsBatch`, `getChannel`, `resolveHandle`, `resolveChannelId`,
`getChannelVideos`, `getChannelVideosPage`, `getChannelBaseline`, `search`, `findVideoRank`,
`getSearchSuggestions`, `getTranscript`, `getCaptionTracks`; pure parsers `parsePlayer`,
`parseNext`, `parseCommentsHeader`, `parseChannelHeader`, `parseAbout`,
`parseChannelVideosPage`, `parseSearchResults`, `parseSuggestionsJsonp`, `parseJson3`;
text helpers `parseCount` (`"6.3K"`, `"6,387 views"`, `"6.3 thousand views"` → `{ value, exact }`),
`parseAgo` (`"11h ago"`, `"Streamed 4 years ago"`), `parseEnglishDate`, `parseKeywordString`,
`handleFromUrl`, `normalizeHandle`; deep-walk `findAll`, `findAllEntries`, `findFirst`, `textOf`.

### Content scripts on youtube.com: bridge + page helpers

`entrypoints/youtube-bridge.content.ts` runs in the page's MAIN world at `document_start`
and exposes `ytcfg` and the page's own data over a private `MessagePort`.

```ts
import {
	getCurrentVideoDetails,
	getCurrentPageData,
	getYtConfig,
	onNavigate,
} from "@/lib/youtube/page";

// Current watch/Shorts video, seeded from the page's player response (no refetch of `player`),
// completed and cached by the background. null when not on a video page.
const details = await getCurrentVideoDetails(); // { level?: "basic"|"full", force? }

const cfg = await getYtConfig(); // YtConfig (source: "page"), falls back to defaults
const page = await getCurrentPageData(); // YtPageData | null (raw playerResponse/initialData)

const off = onNavigate((page) => {
	// after every SPA navigation, incl. Shorts scrolling
	if (page.pageType === "watch") rerender(page.videoId);
});
```

- `onNavigate` fires for `yt-navigate-finish`, `yt-page-data-updated` and initial load, so
  expect **2 calls per navigation**: dedupe on `page.url`/`page.videoId`.
- `page.playerResponse` is always for `page.videoId` (read from `movie_player` /
  `shorts-player`, the navigation payload or `ytInitialPlayerResponse`, whichever matches).
- `pageType`: `watch | shorts | channel | search | home | browse | studio | other`
  (`detectPageType`, `videoIdFromUrl` in `@/lib/youtube/page-type`).
- Page text fields are in the user's UI language; numbers from the player response are not.
  `getCurrentVideoDetails` only reuses `ytInitialData` when the UI is English.
- Every navigation (and `getCurrentVideoDetails`) forwards the page's public client
  version, API key and region (`gl`) to the background (`yt.setConfig`, at most once a
  minute). The background keeps it in `storage.session`, so it survives the worker going
  to sleep. Search, rank and suggestion cache keys include `gl`. Session data
  (visitorData, login) never leaves the page.

DOM helpers (`@/lib/dom`): `waitForElement(selector, { root?, timeoutMs?, signal? })`,
`isYouTubeDark()`, `onYouTubeThemeChange(cb)`.

---

## 5. AI

The background owns the provider (openai SDK v7, `dangerouslyAllowBrowser: true`, the
user's `baseURL`/`apiKey`). Before every call it checks the host permission for the
provider origin and returns an actionable `PERMISSION` error if missing.

### Providers: `@/lib/ai/providers`

`AI_PROVIDER_PRESETS`: `openai`, `openrouter`, `groq`, `together`, `deepseek`, `mistral`,
`gemini` (OpenAI-compatible endpoint), `ollama` (`http://localhost:11434/v1`), `lmstudio`
(`http://localhost:1234/v1`), `custom`. Each: `{ id, label, baseURL, legacyBaseURLs?,
defaultModel, defaultImageModel, defaultReasoningEffort?, tokenParam, requiresKey, keyUrl?,
note?, local? }`. `getProviderPreset(id)`, `detectPreset(baseURL)` (also matches legacy
hosts such as `api.together.xyz`), `effectivePreset(settings)` (the base URL wins over the
stored preset id), `isOpenAiHost(url)` (`api.openai.com`, `*.openai.azure.com`).

Defaults, checked against each provider's docs in Nov 2026 (`defaultReasoningEffort` is
preselected when the user picks the preset; `""` = not sent):

| preset       | chat model              | image model                     | token cap               | effort | sources                                                                                |
| ------------ | ----------------------- | ------------------------------- | ----------------------- | ------ | -------------------------------------------------------------------------------------- |
| `openai`     | `gpt-6-luna`            | `gpt-image-2.6-sunburst`        | `max_completion_tokens` | `""`   | developers.openai.com/api/docs/models, /deprecations, /guides/image-generation         |
| `openrouter` | `openai/gpt-6-luna`     | `openai/gpt-image-2.6-sunburst` | `max_tokens`            | `""`   | openrouter.ai/api/v1/models, /api/v1/images/models, docs/guides/features/compatibility |
| `groq`       | `openai/gpt-oss-120b`   | none                            | `max_completion_tokens` | `low`  | console.groq.com/docs/deprecations, /models, /reasoning                                |
| `together`   | `zai-org/GLM-5.3-Flash` | `black-forest-labs/FLUX.2-dev`  | `max_tokens`            | `low`  | docs.together.ai/docs/serverless-models, /deprecations, /openai-compatibility          |
| `deepseek`   | `deepseek-flash`        | none                            | `max_tokens`            | `none` | api-docs.deepseek.com/api/create-chat-completion, /updates                             |
| `mistral`    | `mistral-small-latest`  | none                            | `max_tokens`            | `none` | docs.mistral.ai/getting-started/models, /api                                           |
| `gemini`     | `gemini-3.8-flash`      | `gemini-nano-banana-2.1`        | `max_tokens`            | `""`   | ai.google.dev/gemini-api/docs/openai, aistudio.google.com/docs/deprecations            |
| `ollama`     | `gemma4`                | none                            | `max_tokens`            | `none` | docs.ollama.com/api/openai-compatibility, ollama.com/library/gemma4                    |
| `lmstudio`   | (the user's model)      | none                            | `max_tokens`            | `""`   | lmstudio.ai/docs/developer/openai-compat                                               |
| `custom`     | -                       | -                               | `max_tokens`            | `""`   |                                                                                        |

Base URLs moved: Together -> `https://api.together.ai/v1`, DeepSeek -> `https://api.deepseek.com`
(old URLs still work and are still detected).

### Adaptive request parameters: `@/lib/ai/params` (background only)

Every Chat Completions call (one-shot and streaming) goes through `adaptiveChat(settings,
{ messages, model?, temperature?, maxTokens?, jsonMode?, reasoningEffort?, signal?, stream? })`,
which returns `{ response, attempts, adjustments, sent }`:

- **Token cap**: only sent when the caller passes `maxTokens`. `max_completion_tokens` for
  OpenAI hosts, otherwise the preset's `tokenParam` (`max_tokens` for custom).
- **Temperature**: left out for OpenAI reasoning ids (o-series, `gpt-5*`, `gpt-6*`, also as
  `openai/…`) unless reasoning effort is `none` and the model supports it; never sent to
  `gpt-6*-astra` / o-series.
- **`reasoning_effort`**: only when the user picked one. Known unsupported values are switched
  up front to the nearest supported one, ties going toward `medium` (e.g. `minimal` -> `low` on
  `gpt-6-luna`; `none` -> `low` on `gpt-oss`, `gpt-6.1-sol`; `xhigh` -> `high`).
- **`response_format: json_object`**: for `aiComplete({ json })`; dropped when rejected.
- On a **400/422 that names a parameter we sent** (from `error.param`, pydantic `loc` fields,
  the message or the body: "Unsupported parameter: 'max_tokens' … Use 'max_completion_tokens'
  instead", "Unrecognized request argument supplied", "Extra inputs are not permitted",
  "Unsupported value: 'temperature' …", "Supported values are: …"), only that parameter changes
  and the request is retried: `max_tokens` <-> `max_completion_tokens`, then no cap;
  temperature dropped; effort moved to the nearest supported value when the error is about one
  value (it quotes it, lists the supported ones, or says "Unsupported value"), otherwise the
  effort parameter is dropped; JSON mode off. Attribution only reads the error's message,
  `param` and `code` (echoed `input` values are ignored), and an error whose `param` names
  something else (e.g. `messages`) or that is about the input itself (`context_length_exceeded`,
  `content_filter`, `invalid_prompt`, `moderation_blocked`) is never attributed to a setting.
  Out-of-range values ("'max_tokens' … is too large", "less than or equal to 1.5") only change
  that request (no cap / no temperature) and are not learned. At most 4 attempts, only when the
  body actually changed, never after 401/403/404, a timeout or a network error, and not once the
  signal is aborted. A 429 / 503 (nothing was generated) is resent once after its
  `retry-after` (max 10 s). A Gemini `INVALID_ARGUMENT` 400 that names nothing, with an effort
  set, is retried once without the effort, for that request only (never learned).
- **Timeouts**: the client waits up to 10 minutes (high reasoning effort / image quality can be
  slow) and generation requests run with SDK retries off, so a slow or timed-out request is never
  sent (and billed) twice; a timeout is `TIMEOUT`.
- What is learned is stored per `(normalized baseURL, model)` in `aiModelCaps`
  (`AiModelCaps { tokenParam?, noTemperatureWith?, rejectedEfforts?, noReasoningEffort?,
  noJsonMode?, rejectedSizes?, noQuality?, at }`, newest 200 entries, ignored after 30 days),
  so the next request is right the first time. Storage failures never fail a request.
- A reply with no text and `finish_reason: "length"` throws `BAD_OUTPUT` ("the output budget
  went to reasoning"), in `aiComplete`, `testProvider` and streaming chat.
- `testProvider()` sends a 4,096-token cap (so the right token parameter is learned there) and
  the settings' temperature/effort through the same rules; `adjustments` lists what changed.
- Message `content` given as a chunk list (Mistral reasoning) is flattened with `contentText()`.

### Models & deprecations: `@/lib/ai/deprecations` (pure)

`findDeprecation(id, "chat" | "image", settings, listed?)` -> `{ status: "deprecated" |
"shutdown", date, replacement } | null`, from the provider's `shutdownDate` (Load models) or a
built-in table: OpenAI (`gpt-4o*` / `gpt-4.1*` -> `gpt-6-luna`, Jan 14 2027; `gpt-5-nano` ->
`gpt-6-luna`, `gpt-5-mini` -> `gpt-6.1-terra`, `gpt-5` / `o3` / `gpt-5-pro` / `o3-pro` ->
`gpt-6.1-sol`, Dec 11 2026; `gpt-5.1` / `gpt-5.3-codex` -> `gpt-6-sol`, `gpt-5.4-nano` ->
`gpt-6-luna`, Apr 1 2027; `o1`, `o3-mini`, `o4-mini`, `gpt-4.1-nano`, `gpt-4o-2024-05-13`,
`gpt-image-1` shut down Oct 23 2026, `gpt-5*-chat-latest` / `gpt-5.1-codex` earlier;
`gpt-image-1-mini`, `gpt-image-1.5`, `chatgpt-image-latest` -> `gpt-image-2.6-sunburst`, Dec 1
2026; `gpt-image-2` Feb 10 2027; `dall-e-*` retired), with the `openai/` prefix on OpenRouter,
plus retired Groq (`qwen/qwen3-32b`, Llama 4 Scout, `qwen/qwen3.6-27b`, `groq/compound*`),
Together (Llama 4, `openai/gpt-oss-20b`, `google/gemma-4-31B-it`, FLUX.1), Mistral
(`mistral-small-2503/2506`, `mistral-large-2411`; `mistral-large-2512` until Apr 30 2027),
DeepSeek and Gemini (2.0, 2.5 / 3 previews, Imagen, 3.x image previews) ids. A rule without a
replacement suggests the preset's default model. The options page hides models whose
shutdown date has passed, labels the others "Deprecated · shuts down …", lists chat and image
candidates separately (no embeddings / audio / moderation / image ids in the chat list), and
offers "Use <replacement>" for a deprecated selection.

### Permissions: `@/lib/permissions`

`ensureOriginPermission(url)` / alias `ensureProviderPermission(url)` — extension pages,
inside a click handler. `hasOriginPermission(url)`, `originPattern(url)`, `originOf(url)`.

### Streaming chat: `useAiChat` (`@/lib/ai/use-ai-chat`)

```tsx
import { useAiChat } from "@/lib/ai/use-ai-chat";
import { Markdown } from "@/components/common/Markdown";

const chat = useAiChat({ context, onFinish: (msgs) => saveConversation(msgs) });
// chat.messages: UiChatMessage[] { id, role, content, createdAt, error? } (assistant grows while streaming)
// chat.status: "idle" | "streaming" | "error";  chat.error / chat.errorCode
chat.send("Why did this video do well?", { context? });   // context override per message
chat.stop(); chat.reset(); chat.setMessages(saved);
chat.retry(); // re-sends the last user message with the context it was sent with
{chat.messages.map((m) => <Markdown key={m.id} content={m.content} />)}
```

Options: `{ context?: CoachContext | null, model?, temperature?, initialMessages?, onFinish? }`.
Non-React: `streamAiChat({ messages, context?, model?, temperature? }, (delta, full) => …) → { done: Promise<string>, abort }`.

Wire protocol (Port name `"ai-chat"`, `AI_CHAT_PORT`): client posts
`{ type: "start", messages, model?, temperature?, context? }`; background streams
`{ type: "delta", text }`… then `{ type: "done", finishReason }` or
`{ type: "error", message, code }`. Disconnecting aborts the request. The background builds
the system prompt with `coachSystemPrompt(context)`.

### `CoachContext` (`@/lib/ai/types`)

All optional: `page`, `video { videoId, title, description, channelTitle, views, likes,
comments, publishedAt, durationSec, isShort, keywords, category }`, `stats { vph, recentVph,
engagementRate, outlierScore, baseline, ageHours, tagRanks, seoScore }`, `channel { channelId,
title, handle, subscribers, totalViews, videoCount, joinedAt, country, keywords, description,
baselineLong, baselineShort, uploadsPerWeek }`, `recentVideos[]`, `myChannel`,
`transcriptExcerpt` ("m:ss text" lines), `extra`. `VideoDetails` and `ChannelInfo` are
assignable field-by-field (spread what you have).

### Prompts & generators: `@/lib/ai/prompts` (pure, import anywhere)

The coach half (`coachSystemPrompt`, `renderContext`, presets, `fitTagsTo500`,
`tagsLength`, `clipText`) lives in `@/lib/ai/coach`, which has no zod. Content scripts
should import from `@/lib/ai/coach`; `prompts.ts` re-exports all of it, so pages can use
either path.

- `coachSystemPrompt(ctx)`, `renderContext(ctx)`
- Coach presets: `COACH_PRESETS` (`subscribers`, `similar-ideas`, `summarize`, `hook`,
  `why-performance`), `presetLabel(id, ctx)` ("…do well?" vs "…do poorly?" from the outlier
  score), `buildPresetPrompt(id, ctx)` → the user message to `chat.send()`. For `hook`, put the
  first ~60 s in `ctx.transcriptExcerpt` (`transcriptToText(t.segments, { toSec: 60 })`).
- Generators via `ai.generate(kind, input)` (validated with zod, one repair retry):

| kind                | input                                                                                               | output                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `titleIdeas`        | `{ topic?, video?, keywords?, count? = 10, style? }`                                                | `{ titles: { title, angle, why }[] }`                                                                       |
| `descriptionDraft`  | `{ title, keywords?, transcriptExcerpt?, channel?, links?, includeChapters?, currentDescription? }` | `{ description, hashtags[], chapters: { time, title }[] }`                                                  |
| `tagSet`            | `{ title, description?, keywords?, existingTags? }`                                                 | `{ tags[] }` (always fits 500 chars)                                                                        |
| `thumbnailConcepts` | `{ title, topic?, video?, count? = 3 }`                                                             | `{ concepts: { headline, visual, composition, colors[], emotion, imagePrompt }[] }`                         |
| `dailyIdeas`        | `{ channel?, recentVideos?, niche?, count? = 5, trending?, date? }`                                 | `{ ideas: { title, hook, why, format: "long"\|"short", keywords[] }[] }`                                    |
| `clipFinder`        | `{ transcript ("m:ss text" lines), videoTitle?, maxClips? = 5, minSec?, maxSec? }`                  | `{ clips: { start, end (seconds), title, hook, reason, score 0–100 }[] }`                                   |
| `keywordInsights`   | `{ keyword, suggestions?, topResults? }`                                                            | `{ summary, searchIntent, competition, opportunityScore, relatedKeywords[], titleAngles[], contentGaps[] }` |
| `channelAudit`      | `{ channel, recentVideos?, bestSlots? }`                                                            | `{ summary, score, strengths[], weaknesses[], actions: { title, detail, impact }[], contentPillars[] }`     |

Helpers: `fitTagsTo500(tags)`, `tagsLength(tags)`, `toSeconds("1:23")`.
Thumbnail images: `ai.generateImage(concept.imagePrompt, { size: "1280x720" })` (needs an
image model; clear `NO_IMAGE_SUPPORT` error otherwise). `response_format` is never sent to
OpenAI-style hosts (GPT image models reject it and always return base64); only Gemini's
compatibility endpoint gets its documented `response_format: "b64_json"`. `b64_json` is
preferred, `url` is fetched into a data URL when possible. The data URL's type comes from the
response's `output_format` or the image's magic bytes (png/jpeg/webp/gif);
`imageExtension(dataUrl)` from `@/lib/ai/types` gives the matching download extension. Sizes:
`"1280x720"` (YouTube 16:9, what the UI uses; falls back to `"1536x1024"`, then the provider
default when rejected), `"1536x1024"`, `"1024x1024"`, `"1024x1536"`, `"auto"` or omitted (not
sent: provider default). `quality` `"low" | "medium" | "high"` is dropped when rejected
(`"auto"` = not sent). OpenRouter gets `aspect_ratio`, Together `width`/`height`. Rejected
sizes/quality are remembered per image model; a 400 that names nothing (Gemini's "invalid
argument") steps to the next size once without remembering it. Safety-filter / input errors
are never attributed to size or quality.

Background-only modules: `ai/complete.ts` (`aiComplete(messages, { json?: zodSchema })`,
`listModels`, `generateImage`, `testProvider`, `extractJson`), `ai/params.ts`
(`adaptiveChat`, learned caps), `ai/generate.ts` (`runGenerator`), `ai/chat.ts`,
`ai/client.ts`, `ai/errors.ts` (`AiError`, `toAiError`).
Don't import these from UI code (they pull in the openai SDK).

---

## 6. Cache & limiter

`@/lib/cache`: `cached(key, ttlMs, loader, { persist?, force?, staleOnError? })` (in-flight
dedupe; on loader failure returns an expired value up to 3 days old), `cacheGet`, `cacheSet`,
`cacheDelete`, `cacheClear(prefix)`, `dedupe(key, loader)`, `TTL` constants. Memory LRU (500)

- `chrome.storage.local` (keys `ovq:cache:*`, index `ovq:cache-index`, pruned to 2,000 entries /
  40 MB, LRU). The persistent layer is owned by the background.

`@/lib/limiter`: `createLimiter(n)`, `withRetry(fn, { retries, baseDelayMs, maxDelayMs, signal, shouldRetry })`,
`HttpError`, `sleep`, `parseRetryAfter`.

---

## 7. UI building blocks

### Shared components: `@/components/common` (no Tailwind; shadow-root safe)

```tsx
import { AreaChart, CopyButton, Logo, Markdown, Sparkline } from "@/components/common";

<Markdown content={md} fontSize={13} />              // safe subset, links rel="noopener noreferrer"
<AreaChart data={history.points.map((p) => ({ x: p.t, y: p.views }))} height={140} valueLabel="views" />
<Sparkline values={[3, 5, 4, 9]} width={60} height={18} />
<CopyButton text={tags.join(", ")} label="Copy tags" />
<Logo size={20} />
```

Theming via CSS variables (set them on a parent): `--ovq-chart-color`, `--ovq-chart-grid`,
`--ovq-chart-axis`, `--ovq-chart-tooltip-bg`, `--ovq-chart-tooltip-fg`, `--ovq-md-link`,
`--ovq-md-code-bg`, `--ovq-md-border`, `--ovq-md-muted`, `--ovq-border`. Text inherits
`color`/`font` from the parent. `copyText(text)` is exported for non-button use.

### Extension pages (popup, side panel, options): Tailwind + `@growtube/ui`

```tsx
// entrypoints/sidepanel/main.tsx
import "@/assets/tailwind.css";
import { applyColorScheme } from "@/lib/theme";
import { Button } from "@growtube/ui/components/button";
applyColorScheme(); // toggles .dark from the OS theme
```

WXT builds `entrypoints/sidepanel/index.html` into `side_panel.default_path` and
`entrypoints/popup/index.html` into `action.default_popup` automatically; `options/` becomes
the options page (`ext.openOptions("ai")` opens `options.html#ai`).

### YouTube-injected UI: shadow root + plain CSS

```tsx
// entrypoints/watch-panel.content/index.tsx
import "./style.css"; // plain CSS, scoped by the shadow root
import ReactDOM from "react-dom/client";
import { createShadowRootUi, defineContentScript } from "#imports";

export default defineContentScript({
	matches: ["*://www.youtube.com/*"],
	cssInjectionMode: "ui",
	async main(ctx) {
		const ui = await createShadowRootUi(ctx, {
			name: "ovq-watch-panel", // custom element name, must contain a dash
			position: "inline",
			anchor: "#secondary-inner", // or a function returning the element
			append: "first",
			onMount: (container) => {
				const el = document.createElement("div");
				container.append(el);
				const root = ReactDOM.createRoot(el);
				root.render(<WatchPanel />);
				return root;
			},
			onRemove: (root) => root?.unmount(),
		});
		ui.mount(); // or ui.autoMount() to follow the anchor
	},
});
```

- Style for both themes: read `useYouTubeDarkTheme()` (or `isYouTubeDark()`) and switch a
  class/CSS variables on your root. YouTube light theme = no `dark` attribute on `<html>`.
- Use YouTube's font (`font-family: Roboto, Arial, sans-serif`) and its CSS variables where
  convenient (`var(--yt-spec-text-primary)`, `--yt-spec-text-secondary`,
  `--yt-spec-badge-chip-background`), with fallbacks.
- Re-render on `onNavigate`; YouTube reuses DOM between SPA pages, so re-check your anchor and
  avoid duplicate mounts (`ctx.isInvalid`, `ctx.onInvalidated`).
- Don't block or restyle YouTube's own elements; insert next to them.

---

## 8. Verification tools

- `node scripts/run-live-check.mjs` — bundles `scripts/live-check.ts` with the installed esbuild
  and runs it in Node: replays every fixture through the parsers, then hits live YouTube
  (video details, @carandbike channel, uploads, baselines, search + rank, suggestions,
  transcripts). `--offline` runs only the fixture checks.
- `node scripts/generate-icons.mjs` — regenerates `public/icon/*.png`,
  `components/common/logo-data.ts` and the web app's icons (`apps/web/public`) from
  `assets/brand/logo-source.png`.
