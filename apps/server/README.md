# GrowTube server

The backend for GrowTube: a [Hono](https://hono.dev) app on Cloudflare Workers
with Postgres (drizzle) and Redis. It provides:

- **accounts** with [better-auth](https://better-auth.com) at `/api/auth/*`
  (email + password). The web app signs in with a session cookie, the extension
  with a bearer token;
- a **REST API** (`/v1/*`) that needs a signed-in user: the extension reports the
  stats it sees on youtube.com, and the clients read history, trending and batch
  stats back. Reports are stored **without** any link to the account that sent them;
- an **hourly cron** that refreshes recently seen videos and channels from the
  YouTube Data API (optional), prunes old snapshots and, once a day, cleans up
  expired auth rows;
- an **MCP server** (`/mcp`) exposing the same data to Claude, ChatGPT and any other
  MCP client with a personal API key, a free equivalent of "vidIQ MCP".

Everything is free and unlimited: no plans, credits or quotas. Accounts and API keys
are free; they exist so the service is only usable signed in. The only limits are
anti-abuse rate limits (see below).

The HTTP contract (zod schemas + TS types) lives in `@growtube/shared`
(`packages/shared/src/api.ts` and `api-extra.ts`). Every input is validated with
those schemas, and every response matches them.

## Accounts and authentication

better-auth (`packages/auth`) is mounted at `/api/auth` (`AUTH_BASE_PATH` in
`@growtube/shared/auth`) with email + password sign-in, the
[bearer](https://better-auth.com/docs/plugins/bearer) plugin and the
[api-key](https://better-auth.com/docs/plugins/api-key) plugin. There are no social
logins and no emails (so no email verification and no password-reset mails).

| Method | Path                        | Body                        | Notes                                                                    |
| ------ | --------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `POST` | `/api/auth/sign-up/email`   | `{ name, email, password }` | Name 1-100, password 8-128 characters, no `image`. Signs the new user in |
| `POST` | `/api/auth/sign-in/email`   | `{ email, password }`       | Rate-limited per IP and per email (see below)                            |
| `POST` | `/api/auth/sign-out`        | `{}`                        | Ends the current session                                                 |
| `GET`  | `/api/auth/get-session`     |                             | `{ session, user }`, or `null` when signed out (HTTP 200 either way)     |
| `POST` | `/api/auth/revoke-sessions` | `{}`                        | Ends every session of the user, this one included                        |
| `POST` | `/api/auth/delete-user`     | `{ password }`              | Deletes the account. The password is **required**. Rate-limited per user |
| `POST` | `/api/auth/api-key/create`  | `{ name?, expiresIn? }`     | New MCP key, shown once in `key`. At most 50 keys per account            |
| `GET`  | `/api/auth/api-key/list`    |                             | `{ apiKeys, total }`, never the key itself; `start` is its first 8 chars |
| `POST` | `/api/auth/api-key/delete`  | `{ keyId }`                 | Revokes a key immediately                                                |

Only these endpoints are served over HTTP (`AUTH_HTTP_PATHS` in `packages/auth`); every
other path under `/api/auth` answers `404`, including better-auth's `/verify-password`,
`/change-password`, `/update-user`, `/change-email`, the session list/revoke variants and
`/api-key/get|update`. No client uses them, and the password-checking ones would let a
stolen session guess the password without the sign-in limits. Server code can still
call any endpoint through `auth.api`. Auth request bodies are limited to 16 KB (`413`).
The `400` error codes the clients may see besides better-auth's: `INVALID_NAME`,
`IMAGE_NOT_SUPPORTED`, `PASSWORD_REQUIRED` (delete-user), `PREFIX_NOT_ALLOWED`
(api-key/create with a `prefix`: every new key starts with `gt_`) and `TOO_MANY_API_KEYS`
(the 50-key cap is abuse protection, not a plan limit; it also holds for concurrent
creates, see `capApiKeys`).

**Web app (cookie).** The web app never sees the bearer token: responses to requests
from a web origin carry no `set-auth-token` header, and CORS doesn't expose it. On
`/v1/*` a cookie only counts when `Origin` is `CORS_ORIGIN` (any other or no Origin is
treated as signed out), so other sites can't spend a signed-in user's rate limits with
`no-cors` requests; a request with `Authorization: Bearer` is authenticated by the
bearer alone. `delete-user` and `api-key/create` follow the same rule: without a
session by those terms they answer `401 AUTH_REQUIRED` before better-auth runs, and
better-auth only gets the credential the per-user limits counted (it would otherwise
fall back to the cookie behind an invalid bearer, or take a `Referer` for a missing
`Origin`). The session cookie is `HttpOnly; Secure; SameSite=None`. The
web app calls `/api/auth/*` and `/v1/*` with `credentials: "include"`. CORS for both
allows exactly `CORS_ORIGIN`, with credentials, request headers `Content-Type` and
`Authorization`, and exposes only the rate-limit headers and `X-Cache` (never
`set-auth-token`).

**Extension (bearer).** Sign-in and sign-up responses carry the signed session token in
the `set-auth-token` response header (`AUTH_TOKEN_RESPONSE_HEADER`). The extension
stores it and sends `Authorization: Bearer <token>` with `credentials: "omit"`. The
bearer plugin runs with `requireSignature: true`, so only that signed value works,
not the raw token stored in the `session` table. A response that refreshes the
session cookie (for example `get-session`, at most once a day) repeats
`set-auth-token` with the same value. Extension pages and the background worker have
host permissions for the server, so CORS doesn't apply to them.

**Origin / CSRF checks for the extension.** better-auth checks the `Origin` of a
non-GET request only when it carries a cookie, so bearer calls without cookies
(sign-out, revoke-sessions, delete-user, api-key) are never origin-checked. The
exception is `/sign-in/email` and `/sign-up/email`: they still check the `Origin`
whenever one is sent, and Chrome sends `Origin: chrome-extension://<id>`. For those
two paths only, and only on requests without a `Cookie` header, the server also
trusts extension origins: the ids listed in `EXTENSION_ORIGINS`, or any
`chrome-extension://` origin when it is unset. Requests with cookies keep the strict
list (`CORS_ORIGIN` and the server's own origin), so websites still can't forge
cookie-authenticated calls.

**Without a session**, every `/v1/*` route answers:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"error":"Sign in required","code":"AUTH_REQUIRED"}
```

(`AuthRequiredError` / `isAuthRequiredError` in `@growtube/shared/auth`). `/mcp`
answers with the same shape (and an API-key message) plus `WWW-Authenticate: Bearer`.
`/health` and `/` are public. CORS preflights (`OPTIONS`) never need auth.

**Account deletion** (`POST /api/auth/delete-user` with `{ password }`) deletes the
user, its password account, every session and every API key. Crowdsourced reports were
never linked to the account, so nothing else refers to it.

What is stored per account: the `user` row (name, email), the `account` row (the
password hash, scrypt), `session` rows (token, expiry, created/updated times, user id;
**no IP address and no user agent**: `advanced.ipAddress.disableIpTracking` plus a
`databaseHooks.session` hook that nulls both), and `apikey` rows (the SHA-256 hash of
the key, its first 8 characters, name, owner, created/updated/last-used/expiry times).
better-auth's own rate limiter and telemetry are off.

## Endpoints

All `/v1/*` routes need a session (see above).

| Method | Path                                                          | Purpose                                   | Cache               |
| ------ | ------------------------------------------------------------- | ----------------------------------------- | ------------------- |
| `POST` | `/v1/ingest/videos`                                           | Report video stats (≤ 50 per call)        | none (rate-limited) |
| `POST` | `/v1/ingest/channels`                                         | Report channel stats (≤ 50 per call)      | none (rate-limited) |
| `GET`  | `/v1/videos/stats?ids=a,b,c`                                  | Latest stats + server VPH for ≤ 50 videos | `max-age=60`        |
| `GET`  | `/v1/videos/:id/history?range=24h\|7d\|28d\|all`              | View history (≤ 200 points)               | Redis 120 s         |
| `GET`  | `/v1/channels/:id/history`                                    | Daily subscriber/view history             | Redis 10 min        |
| `GET`  | `/v1/channels/resolve?handle=@name`                           | `@handle` → channel id (channels seen)    | `max-age=300`       |
| `GET`  | `/v1/trending?window=24h\|7d&type=all\|long\|short&q=&limit=` | Fastest-growing videos                    | Redis 5 min         |
| `POST` | `/mcp`                                                        | MCP (streamable HTTP, stateless), API key | n/a                 |
| `GET`  | `/health`                                                     | DB + Redis liveness (public)              | n/a                 |

`max-age` responses are sent as `Cache-Control: private, max-age=N`: the caller's
browser may cache them, a shared cache may not, because the API needs a session.

### `POST /v1/ingest/videos`

```jsonc
// body: IngestVideosBody
{ "videos": [{
  "videoId": "dQw4w9WgXcQ",              // required
  "views": 1234567,                       // required
  "channelId": "UCuAXFkgsw1L7xaCfnd5JJOw", "title": "…", "channelTitle": "…",
  "publishedAt": "2009-10-24T23:57:33-07:00", "durationSec": 213, "isShort": false,
  "likes": 18000000, "comments": 2400000
}] }
// 200: IngestResponse
{ "accepted": 1, "skipped": 0 }
```

- `accepted` is the number of videos that got a **new snapshot**. `skipped` counts entries
  that were throttled (this video already has a snapshot from the last 10 minutes),
  duplicated within the batch, or implausible (see below). Throttled entries still merge
  their metadata.
- Reports are stored anonymously (the sender's account is never recorded), so a view
  count is only accepted when it is plausible: at most
  twice the stored count, or the stored count plus 5M views/hour since the last snapshot
  (for a new video, 5M views/hour since its publish date; never above 20B). A report
  above that is ignored entirely. The stored count changes only together with a new
  snapshot, so repeated reports can't ratchet it up between snapshots.
- Merge rules: a missing field never overwrites a known value. `latestViews` only goes
  up, because a lower report is usually a stale page. The snapshot stores that
  best-known value. For `publishedAt`, an earlier report wins,
  since a date derived from "3 days ago" is floored and therefore always at or after the
  real time. An earlier report may move the date back by at most the video's current
  age (min. 1 day), so one bogus report can't stick. The cron overwrites the date with
  the Data API's exact value.
- An unknown `channelId` gets a stub `channels` row (title from `channelTitle`) so
  the foreign key holds. That channel then joins the daily refresh.
- After each snapshot, `recentVph` is recomputed. It is views gained per hour over
  the last 48 h of snapshots (`computeRecentVph`, `vphSource: "recent"`). Without
  enough history it falls back to the lifetime average (`computeVph`,
  `vphSource: "lifetime"`).

### `POST /v1/ingest/channels`

Body: `{ "channels": [{ "channelId", "handle"?, "title"?, "avatarUrl"?, "subscribers"?,
"totalViews"?, "videoCount"?, "joinedAt"? (YYYY-MM-DD), "country"?, "keywords"? }] }`.
`avatarUrl` is kept only when it is an https URL on YouTube's image hosts
(`yt3.ggpht.com`, `yt3.googleusercontent.com`, `yt4.ggpht.com`, `i.ytimg.com`; see
`isYouTubeImageUrl` in `@growtube/shared/images`), and it is stored in its
normalized form (`https://<host>/...`, see `canonicalYouTubeImageUrl` in
`src/lib/images.ts`). Any other value is dropped as if absent, without failing the
batch.
Upserts the channel and today's (UTC) `channel_snapshots` row. The last write wins per
field, and a missing field never erases a value already recorded that day. `accepted` is
the number of channels stored, and `skipped` counts duplicates in the batch.

### `GET /v1/videos/stats?ids=a,b,c`

Batch lookup for feed and search cards (schemas: `videoStatsQuery` and
`videoStatsResponse` in `@growtube/shared`; use `videoStatsPath(ids)`). It returns
`{ generatedAt, videos: VideoStats[], missing: string[] }`. Results keep the request
order, and duplicate ids are ignored. `recentVph` and `vphSource` work as described
above. `firstSeenAt` and `lastSnapshotAt` are rounded down to the hour: they are when
somebody's browser reported the video, so the API only says which hour (history and the
MCP tools do the same, see below).

### `GET /v1/videos/:id/history`

- `range=24h|7d|28d` covers the window **[publishedAt, publishedAt + range]**, like
  vidIQ's "first 7 days". If the publish date is unknown, it covers the last `range`
  up to now. `range=all` returns everything.
- Times are hour-level, like `/v1/videos/stats`: a client snapshot is stored when a
  browser's report arrives, so `firstSeenAt` is rounded down to the hour and there is one
  point per UTC hour, the latest snapshot of that hour, timed at the start of the hour.
  Cached responses are coarsened again when read.
- The result is downsampled to ≤ 200 points: the span is split into equal time buckets
  and the latest point of each bucket is kept.
- `recentVph` is momentum over the ~48 h before the latest snapshot, or `null` when
  there are fewer than 2 points.
- An unknown video returns **200** with empty `points` and `null` dates, so clients can
  show "tracking started".
- Known videos also carry optional display fields `title`, `channelId` and
  `channelTitle` (null when unknown). `GET /v1/channels/:id/history` likewise adds
  `title`, `handle` and `avatarUrl` (a YouTube image URL or null; every read path
  re-checks it with `youTubeImageOrNull`). They are optional in the schemas, so cached
  responses from before they existed still validate.

### `GET /v1/channels/resolve?handle=@name`

Turns an `@handle` (the `@` is optional, matching is case-insensitive) into
`{ channelId, handle, title }` from channels that clients have reported, preferring the
most recently seen owner. It returns `404 { error, details }` for a handle the server has
never seen; GrowTube doesn't call YouTube for this. Schemas: `channelResolveQuery` and
`channelResolveResponse`; build the URL with `channelResolvePath(handle)`.

### `GET /v1/trending`

Lists videos published within the window that were snapshotted within the last
`min(window, 48h)`, are not unavailable, have a VPH, and are **verified**: YouTube
itself confirmed them (`verified_at`, set by the cron through the Data API or oEmbed),
with a believable VPH and view count for their age. So a made-up id or title sent to
the ingest API never reaches the board or MCP. They are ordered by
`recentVph` desc. `type=short` means `isShort = true`. `type=long` means
`isShort = false`, or unknown with a duration over 3 minutes. `q` is a
case-insensitive, literal title match. The cache key holds a keyed hash (HMAC) of the
normalized query, never the search text itself.

### Errors, CORS, rate limits

- `401 { error, code: "AUTH_REQUIRED" }` without a session (`/v1/*`) or API key
  (`/mcp`), see above. `429` when a rate limit is hit (below).
- `400 { error, details: [{ path, code, message }] }` for validation errors and
  malformed JSON. The ingest schemas match the columns (int4 durations and video
  counts, no NUL characters, join dates from 2005), and any remaining Postgres data
  error (SQLSTATE class 22) is also a `400`, so clients drop the batch instead of
  retrying it. `404 { error: "Not found" }` for unknown routes. `413` for ingest
  bodies over 1 MB and auth bodies over 16 KB. `500 { error }` for anything
  unexpected (logged).
- `GET /health` returns only `{ ok, db: "up" | "down", redis: "up" | "down" }` (each
  check times out after 3 s). Each isolate reuses its last result for 5 s, and while
  one request re-checks the others get the previous result, so a flood can't open a
  database and a Redis connection per request. On a fresh isolate (no result yet)
  only the first request checks and the others wait for its result (`503` with
  `"unknown"` if none arrives within 6 s). Failure details are logged, never
  returned.
- CORS: `/api/auth/*` and `/v1/*` allow only `CORS_ORIGIN`, with credentials
  (request headers `Content-Type`, `Authorization`; exposed: `Retry-After`,
  `RateLimit-*`, `X-Cache`, never `set-auth-token`). `/mcp` allows **any origin without
  credentials** (request headers `Content-Type`, `Accept`, `Authorization`,
  `x-api-key`, `Mcp-Session-Id`, `Mcp-Protocol-Version`, `Last-Event-ID`; exposed:
  `Mcp-Session-Id`, `WWW-Authenticate`, `Retry-After`, `RateLimit-*`). `/health`
  allows any origin. The extension needs no CORS (host permissions).
- Rate limits are fixed windows in Redis (`INCR` + `EXPIRE` of two windows):

  | Bucket    | Applies to                                                                 | Limit       | Counted per               |
  | --------- | -------------------------------------------------------------------------- | ----------- | ------------------------- |
  | `read`    | `/v1/videos/*`, `/v1/channels/*`, `/v1/trending`                           | 600 / min   | user                      |
  | `ingest`  | `/v1/ingest/*`                                                             | 300 / min   | user                      |
  | `mcp`     | `/mcp`                                                                     | 120 / min   | the API key's owner       |
  | `auth`    | `POST /api/auth/sign-in/*`, `/api/auth/sign-up/*`, `/api/auth/delete-user` | 10 / min    | client IP (IPv6: its /64) |
  | `account` | `POST /api/auth/sign-in/email`                                             | 10 / 15 min | the email signed in to    |
  | `deluser` | `POST /api/auth/delete-user`                                               | 10 / 15 min | user (password checks)    |
  | `apikey`  | `POST /api/auth/api-key/create`                                            | 20 / min    | user                      |

  The subject is never written in clear: the key is
  `ovq:rl:<bucket>:<hmac>:<window>`, where `<hmac>` is HMAC-SHA256(`BETTER_AUTH_SECRET`,
  `"user:" + userId`, `"ip:" + bucket` or `"email:" + lowercased email`) truncated to 16
  hex characters (Web Crypto). The IP comes from `cf-connecting-ip` only (set by
  Cloudflare; `X-Forwarded-For` is ignored because any client can set it), else
  `local`; IPv6 addresses count per /64, since one host usually owns the whole /64. It
  is used for nothing else. Over the limit you get `429 { error, code: "RATE_LIMITED",
  message, details: { limit, windowSeconds, retryAfter } }` with `Retry-After`;
  `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` are on every limited
  response. These are anti-abuse limits, not quotas, and better-auth's and the api-key
  plugin's own limits are off.
- Redis is never a hard dependency. If it is down, the data API's rate limits fail
  open, while the auth limits (`auth`, `account`, `deluser`, `apikey`) count in the
  isolate's memory instead, so password guessing never becomes unlimited. Caches are
  bypassed, and the snapshot throttle falls back to `videos.last_snapshot_at`.

All Redis keys use the `ovq:` prefix, so the instance can be shared:
`ovq:rl:{read,ingest,mcp,auth,account,deluser,apikey}:<hmac>:<window>`, `ovq:snap:v:<id>`,
`ovq:cache:{vh,ch,tr}:*`, `ovq:cron:daily:{channels,prune,cleanup}:<day>`,
`ovq:verify:v:<id>`. Sessions are not kept in Redis (better-auth has no secondary
storage configured).

### Logging

- Access log, one line per request: method, the **matched route pattern** (for example
  `GET /v1/videos/:id/history 200 12ms`), status and duration. No raw paths or path
  params, no query strings, no headers, no IPs.
- Errors (`app.onError`, health checks, the cron report, better-auth's logger) are
  logged as one line from `describeError` (`packages/db/src/log.ts`): the error name,
  the Postgres SQLSTATE if any, and the message with drizzle's `params:` part removed
  (quoted values are blanked for SQLSTATE class 22, which quotes the bad input). Never
  the error object, its stack, SQL parameters, request bodies or Postgres `detail`.
- better-auth's logger is routed through the same filter (objects are dropped), and
  unexpected errors inside better-auth are rethrown to `app.onError` instead of being
  dumped by better-call.
- The cron report lists counts and error summaries only, no titles.
- Cloudflare's platform still sees client IPs (request metadata and, if enabled,
  Workers Logs / Logpush); that is outside this code.

## Scheduled refresh (cron)

The cron trigger is `0 * * * *` (hourly). It is set in `wrangler.jsonc` for local dev
and in `packages/infra/alchemy.run.ts` (`crons`) for production. The handler is the
`scheduled` export of `src/index.ts`, and the logic lives in `src/cron/refresh.ts`.

Every run:

1. **Videos** (needs `YOUTUBE_API_KEY`): selects up to 500 videos that were published
   in the last 28 days (or have an unknown publish date), were seen by a client in the
   last 7 days, and were not snapshotted in the last 30 minutes. Stalest go first
   (`last_snapshot_at asc nulls first`). It calls `videos.list`
   (`part=snippet,statistics,contentDetails,status`, 50 ids per call), writes
   `source = "cron"` snapshots, overwrites the stats with the API's authoritative values,
   and recomputes VPH. Client snapshots more than 10% above the API's current count are
   deleted first (views only grow, so they were inflated reports). Ids the API doesn't
   return are marked `unavailable_at`, which takes them out of the cron and trending
   until a client reports them again. Refreshed videos are marked `verified_at`.
   `videos.list` returns unlisted videos too, so only items whose `privacyStatus` is
   `public` are updated. A video the API reports as unlisted or private is deleted
   with its snapshots and cached history (a cached trending list expires within
   5 minutes); if it turns public again, the next client report starts it afresh.
2. **Verify** (always runs): the unverified videos that would rank highest in trending
   (published in the last 7 days, with a VPH) are checked. With an API key: up to 50
   via `videos.list`, as in step 1 (unlisted and private ones are deleted). Without
   one: up to 25 via YouTube's keyless oEmbed endpoint, which confirms the video exists
   and replaces the crowdsourced title and channel name with YouTube's. Unknown ids
   (400/404) are marked unavailable; inconclusive answers are retried after 6 hours.
   oEmbed also answers for unlisted videos, so without an API key the server can't
   tell them from public ones: it relies on the extension never uploading them, and a
   video made unlisted later only leaves trending once clients stop reporting it
   (24-48 h). Set `YOUTUBE_API_KEY` to have the server check visibility itself.
3. **Channels**, once per UTC day (on the first run of the day that completes this
   step, or the 00:xx run when Redis is unavailable): refreshes up to 2,500 channels
   seen in the last 30 days with `channels.list`
   (`part=snippet,statistics,brandingSettings`) and upserts today's channel snapshot.
   Ids the API doesn't return get `unavailable_at` and are refreshed last, so made-up
   ids can't use up the daily budget.
4. **Prune**: keeps one snapshot per video per hour (the latest) once a snapshot is
   older than 7 days, and deletes snapshots older than 180 days. Hourly runs thin a
   2-day band past the 7-day mark. The first run of each UTC day that completes the
   prune thins the full range.
5. **Cleanup**, once per UTC day: sets `channels.avatar_url` to null where it isn't a
   YouTube image URL and rewrites valid ones stored before normalization (up to 10,000
   rows a day; ingest drops or normalizes them already). The SQL pre-filter matches
   exactly the rows that aren't normalized, and each selected row is changed, so the
   same rows can't use up the daily limit again the next day. It also deletes
   expired `session`, `verification` and `apikey` rows (the api-key plugin also
   deletes expired keys, but only while its endpoints are called), and nulls any IP
   address or user agent left on a `session` row from before they were dropped.

Each daily step has its own Redis marker, so an error in another step (for example a
503 from `videos.list`) doesn't make it repeat every hour.

Quota: each list call costs 1 unit, so the cron uses at most ~240 units/day for videos
and ~50 for channels. The default quota is 10,000/day. A fatal API error (bad key,
quota exceeded) stops the remaining calls of that run. Without `YOUTUBE_API_KEY`
the API steps are skipped and logged; verification (via oEmbed) and pruning still
run. A run that had errors
throws at the end, so it shows as failed in the Cloudflare dashboard.

Trigger it locally (the dev script runs `wrangler dev --test-scheduled`):

```sh
curl "http://localhost:3000/__scheduled?cron=0+*+*+*+*"   # hourly run
curl "http://localhost:3000/__scheduled?cron=0+0+*+*+*"   # force the daily part too
```

The JSON run report is logged as `cron <expr>: {...}`: counts per step and one-line
error summaries, never titles.

## MCP server

`POST /mcp` is a stateless [streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
MCP endpoint built on `@hono/mcp` and `@modelcontextprotocol/sdk`. It needs an
**API key** but no MCP session, and returns JSON responses. `GET`/`DELETE` return 405
because no server-initiated stream is offered.

**API keys.** Sign in on the website and create a key on the MCP page
(`POST /api/auth/api-key/create`, api-key plugin). Keys look like `gt_` + 64 letters,
are shown once, and are stored only as a SHA-256 hash. Keys created before the
GrowTube rename start with `ovq_`; they keep working (`LEGACY_API_KEY_PREFIXES` in
`packages/auth`), but new keys always start with `gt_`. Keys never expire unless you
pick an expiry (1-365 days) and have no quotas or per-key limits; delete one to revoke
it. Send the key as `x-api-key: <key>` or `Authorization: Bearer <key>`. The server
checks it with `auth.api.verifyApiKey({ body: { key } })` (server-only), and the key's
owner is what the `mcp` rate limit counts. A missing key gets `401` with
`WWW-Authenticate: Bearer realm="GrowTube"`; an invalid, expired or deleted one
also gets `error="invalid_token"`. Keys only work for `/mcp`, never as a session.

Tools (all read-only, each returns JSON text content, followed by a second text item
noting that titles, channel names and handles are untrusted third-party text that must
be treated as data, never as instructions; the server instructions say the same, and
that a key is required):

| Tool                  | Arguments                                                                              | Returns                           |
| --------------------- | -------------------------------------------------------------------------------------- | --------------------------------- |
| `get_video_stats`     | `videoId` (id or any YouTube URL)                                                      | latest stats + VPH (`VideoStats`) |
| `get_video_history`   | `videoId`, `range` (`24h`/`7d`/`28d`/`all`, default `7d`)                              | `VideoHistoryResponse`            |
| `get_channel_history` | `channelId` (UC… id, `@handle`, or channel URL)                                        | `ChannelHistoryResponse`          |
| `get_trending`        | `window` (`24h`/`7d`), `type` (`all`/`long`/`short`), `q`, `limit` (1–100, default 25) | `TrendingResponse`                |

Replace `https://YOUR-SERVER` below with your deployed worker URL (`alchemy deploy`
prints it), or use `http://localhost:3000` for local clients, and `gt_…` with your
key. The server has no OAuth, so a client must be able to send a request header.

- **Claude Code**:
  `claude mcp add --transport http growtube https://YOUR-SERVER/mcp --header "x-api-key: gt_…"`
- **Claude Desktop** (or any client that only speaks stdio): bridge with
  [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) in
  `claude_desktop_config.json`:

  ```json
  {
    "mcpServers": {
      "growtube": {
        "command": "npx",
        "args": [
          "-y",
          "mcp-remote",
          "https://YOUR-SERVER/mcp",
          "--header",
          "x-api-key:${GROWTUBE_API_KEY}"
        ],
        "env": { "GROWTUBE_API_KEY": "gt_…" }
      }
    }
  }
  ```

- **Other clients** (Cursor, ChatGPT developer mode, …): use the URL
  `https://YOUR-SERVER/mcp` with a custom header `x-api-key: gt_…`, or a bearer
  token `gt_…`, if the client offers one. Connectors that only support OAuth
  (claude.ai custom connectors, for example) can't connect yet.
- **Debugging**: `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP",
  URL `http://localhost:3000/mcp`, with the header `x-api-key`.

Raw JSON-RPC over curl:

```sh
KEY=gt_…
H="-H Content-Type:application/json -H Accept:application/json,text/event-stream -H x-api-key:$KEY"
curl -s $H localhost:3000/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
curl -s $H localhost:3000/mcp -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s $H localhost:3000/mcp -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_trending","arguments":{"window":"7d","limit":5}}}'
```

And the REST API with a session from the command line (the extension's bearer flow):

```sh
TOKEN=$(curl -s -D - -o /dev/null -H Content-Type:application/json \
  localhost:3000/api/auth/sign-in/email -d '{"email":"you@example.com","password":"…"}' \
  | tr -d '\r' | sed -n 's/^set-auth-token: //Ip')
curl -s -H "Authorization: Bearer $TOKEN" "localhost:3000/v1/trending?window=7d&limit=5"
```

## Environment

Declared in `.env.schema` (varlock). Local values go in `apps/server/.env`, which
`wrangler dev` reads. Production values are passed through
`packages/infra/alchemy.run.ts`.

| Var                                     | Required | Notes                                                                                                                                                                                    |
| --------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                          | yes      | Postgres connection string                                                                                                                                                               |
| `REDIS_URL`                             | yes      | ioredis URL (`rediss://` for TLS). All keys are prefixed `ovq:`                                                                                                                          |
| `CORS_ORIGIN`                           | yes      | Web app origin: CORS for `/api/auth/*` and `/v1/*`, trusted origin                                                                                                                       |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | yes      | better-auth; the secret also keys the rate-limit HMAC                                                                                                                                    |
| `YOUTUBE_API_KEY`                       | no       | YouTube Data API v3 key for the cron refresh                                                                                                                                             |
| `EXTENSION_ORIGINS`                     | no       | Comma-separated `chrome-extension://<id>` origins allowed to sign in / up without cookies. Unset: any `chrome-extension://` origin. Set it to the published extension's id in production |

## Data model

Auth (`packages/db/src/schema/auth.ts`, better-auth's tables): `user`, `account`
(password hash), `session` (`ip_address` / `user_agent` columns exist but stay null),
`verification` (unused without emails), and `apikey` (the api-key plugin's table,
field for field; `reference_id` is the owner's user id, `key` the hash). Unlike the
plugin's own schema, `apikey.reference_id` is a foreign key to `user.id` with
`on delete cascade`, so a deleted account can't leave a key behind (not even one
created while the deletion runs). Before pushing that constraint to a database that
predates it, delete keys whose owner is gone, or the push fails:
`delete from apikey a where not exists (select 1 from "user" u where u.id = a.reference_id);`.
No YouTube table references a user.

YouTube (`packages/db/src/schema/youtube.ts`):

- `channels`: one row per UC… id (stub rows come from video reports). `last_seen_at`
  is the last client report, and `last_refreshed_at` is the last API refresh.
- `videos`: latest known stats plus denormalized `recent_vph` / `vph_source` for
  trending. `last_seen_at` is the last client report, `last_snapshot_at` is the last
  snapshot, and `unavailable_at` is set when the API stopped returning the video.
- `video_snapshots`: PK `(video_id, captured_at)`, with `source` = `client` | `cron`.
- `channel_snapshots`: PK `(channel_id, day)`, one row per UTC day.

## Local development

```sh
pnpm --filter @growtube/db db:push   # create/update tables (drizzle-kit)
pnpm --filter server dev               # wrangler dev --test-scheduled on :3000
pnpm --filter server check-types
```

After pulling these auth changes, run `pnpm db:push` once more: it creates the `apikey`
table.

Code layout: `src/index.ts` (app, CORS, auth wiring, error handling, `scheduled`),
`src/routes/*` (HTTP), `src/data/*` (queries shared by routes and MCP),
`src/cron/refresh.ts`, `src/mcp/server.ts`, and `src/lib/*` (`auth.ts`: `requireUser` /
`requireApiKey`; `rate-limit.ts` + `hash.ts`; `logger.ts`; Redis, cache, validation,
YouTube API client).
