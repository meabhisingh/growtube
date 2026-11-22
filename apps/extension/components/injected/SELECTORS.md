# YouTube DOM selectors used by the injected UIs

Every selector lives in `selectors.ts`. This file records what each one targets and
the fallbacks. They were checked against live youtube.com in Nov 2026: home, search,
a channel's Videos tab, watch pages (two-column and single-column) and `/shorts/`.

YouTube's newer view-model components use camelCase class names such as
`ytLockupViewModelHost` and `shortsLockupViewModelHostOutsideMetadataSubhead`. These
used to be `yt-lockup-view-model-wiz__…` and they change. So we match on tag names,
ids, hrefs and `aria-label`s, and match classes only by substring.

## Feed cards (badges)

### Card renderers (`CARD_TAGS`)

Only the outermost match gets a badge row (`isTopLevelCard`).

| Tag                                                                                                      | Where it appears                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `yt-lockup-view-model`                                                                                   | Home and subscriptions grids, channel Videos/Live tabs, watch-page related list (`#related`), playlists and mixes in search |
| `ytm-shorts-lockup-view-model`                                                                           | Shorts shelves on home, search and related. The `-v2` wrapper is ignored.                                                   |
| `ytd-video-renderer`                                                                                     | Search results (legacy renderer, still used for search videos)                                                              |
| `ytd-rich-grid-media`, `ytd-compact-video-renderer`, `ytd-grid-video-renderer`, `ytd-reel-item-renderer` | Legacy renderers. Kept for A/B buckets and older layouts.                                                                   |

`ytd-rich-item-renderer` is only the grid cell. Its child, a lockup or `ytd-rich-grid-media`, is the card.

### What we read from each card

**Identity (`cardKey`).** The first `a[href*="/watch?v="]`, `a[href^="/shorts/"]` or `a[href*="/playlist?list="]`. For `ytd-video-renderer` and `ytd-compact-video-renderer`, `a#thumbnail` comes first.

- YouTube recycles card elements on SPA navigations and chip filters. So the badge row is keyed by this id and rebuilt when the id changes.
- Mixes linked as a plain watch URL get the key `mix-<videoId>`.

**Playlists and mixes.** The card contains `yt-collection-thumbnail-view-model` / `yt-collections-stack`, or has a host class containing `Collection`. The size comes from the thumbnail `badge-shape` ("86 videos" or "Mix").

**Views and age, lockups.** Spans inside `yt-content-metadata-view-model` that have an `aria-label`:

- `aria-label="7.9 thousand views"` → text "7.9K"
- `aria-label="3 hours ago"` → text "3h ago"
- "Streamed 1 day ago" is also handled.

Channel-name spans have no `aria-label`. Live cards say "1.5K watching". Premieres say "Premieres…" or "N waiting".

**Views and age, Shorts lockups.** The `[class*="Subhead"]` line, for example "60K views". Search Shorts show "48K views · 2y ago", which is split on `·`/`•`.

**Views and age, legacy renderers.** `#metadata-line > span.inline-metadata-item`, for example "197K" and "1y ago". Bare numbers are accepted only here.

**Parse conditions.** Card text is parsed only when `<html lang>` starts with "en". Otherwise exact data comes from the server stats or `yt.getVideoDetailsBatch`.

**Live and upcoming.** A thumbnail `badge-shape` with the text "LIVE" / "UPCOMING", or the metadata text described above.

**Channel.** `a[href^="/@"]` or `a[href^="/channel/"]` inside the card.

- Related-video lockups and Shorts lockups have no channel link. There the channel id comes from server stats or video details.
- On a channel page, cards without a link belong to that channel (taken from `location`).

**Ads.** Cards inside `ytd-ad-slot-renderer`, `ytd-in-feed-ad-layout-renderer` or `ytd-promoted-*`, or with a "Sponsored" badge, are skipped.

### Where the badge row goes (`badgeAnchor`)

- **Lockups:** right after `yt-content-metadata-view-model`, inside the text column under the title.
- **Shorts lockups:** right after the `[class*="Subhead"]` line. The fallback is after the `h3` title.
- **Legacy renderers:** right after `#metadata-line`. In search, its parent `#metadata` is a `flex-wrap` row, so the host sets `flex-basis: 100%` to start its own line.

Each row is an `<ovq-feed-badges>` element with its own shadow root. While YouTube is dark, the host carries a `dark` attribute (`html[dark]` is observed).

## Watch page panel

- `ytd-watch-flexy` (not `[hidden]`) is the watch page container. It stays the same element across watch → watch navigations.
  - The layout attributes `is-single-column`, `theater`, `fullscreen` and `hidden` are observed so the panel can move.
- **Two-column layout:** the panel is the first child of `#secondary-inner` (ahead of `#panels`, `#chat-container` and `#related`), shown when `#secondary` has `offsetWidth > 0`.
- **Single-column or narrow layout:** `#secondary` is 0px wide and `#related` moves under the player. The panel goes right after `ytd-watch-metadata` (the title/description block) inside `#below`. The fallback is the first child of `#below`.
- Placement is re-checked on navigation, on layout-attribute changes, on window resize, and every 1.5 s.
- The shadow host is `<ovq-watch-panel>`, mounted with `isolateEvents: true`. Typing in the coach input never reaches YouTube's keyboard shortcuts; this was verified live.

## Shorts

**Active Short (`findActiveShort`):**

1. Old layout: `ytd-reel-video-renderer[is-active]`, then its `#shorts-player` or `#player-container`.
2. New layout (2026): a single `ytd-reel-video-renderer#reel-video-renderer` and a single `#shorts-player`. YouTube moves them into the active `.reel-video-in-sequence-new` slot and reuses the same `<video>`.
3. Fallback: the first visible `ytd-reel-video-renderer`.

**Other selectors:**

- **Video:** `video.html5-main-video` inside the player. It has `loop=true`, so the end of a Short is detected as a jump from the end back to 0, or as `currentTime >= duration - 0.35`.
- **Next Short:** `#navigation-button-down button`. The fallback is a synthetic ArrowDown `keydown` on `document`.
- **Positioning:** `ytd-shorts` gives the left bound for deciding whether the side panel fits.
  - When at least 236 px plus gaps fit left of the player: side-panel mode.
  - Otherwise: a compact overlay 56 px below the player's top, which clears YouTube's play/volume controls.

**Shadow host:** `<ovq-shorts-controls>`, `position: fixed` and appended to `<body>`. Its position follows the player box every frame.

**Keyboard shortcuts:** YouTube does not use these keys. They are ignored while typing in inputs, textareas or contenteditable (including inside shadow roots) and when Ctrl/Alt/Meta is held.

| Key       | Action                                |
| --------- | ------------------------------------- |
| `[` / `]` | Slower / faster                       |
| `\`       | Normal speed                          |
| `A` / `D` | Back / forward 5 s (with Shift: 10 s) |
| `R`       | Toggle auto-scroll                    |

## If something breaks

1. Run the snippet below in the YouTube page console. It is the logic of `feed/extract.ts`.
2. Update `selectors.ts` (and the matching parser), then this file.

```js
[...document.querySelectorAll("yt-lockup-view-model")].slice(0, 5).map((c) => ({
	href: c.querySelector("a[href]")?.getAttribute("href"),
	spans: [
		...c.querySelectorAll("yt-content-metadata-view-model span[aria-label]"),
	].map((s) => `${s.getAttribute("aria-label")} | ${s.textContent.trim()}`),
}));
```
