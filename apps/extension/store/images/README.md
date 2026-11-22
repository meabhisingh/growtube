# Chrome Web Store images

Graphics for the GrowTube listing in the Chrome Web Store dashboard
(Store listing → Graphic assets). All files are 8-bit RGB PNGs with no alpha
channel, at the exact sizes the store asks for.

| File                                | Size     | Dashboard slot     | Shows                                                               |
| ----------------------------------- | -------- | ------------------ | ------------------------------------------------------------------- |
| `screenshot-1-watch-page.png`       | 1280x800 | Screenshot 1       | Watch page panel: VPH, outlier score, engagement, views over time   |
| `screenshot-2-keyword-research.png` | 1280x800 | Screenshot 2       | Side panel Keyword Research next to YouTube search, sorted by score |
| `screenshot-3-search-badges.png`    | 1280x800 | Screenshot 3       | VPH, outlier and subscriber badges on search result cards           |
| `screenshot-4-ai-coach.png`         | 1280x800 | Screenshot 4       | Side panel AI Coach answering a question                            |
| `promo-small-440x280.png`           | 440x280  | Small promo tile   | Logo, name and tagline on brand green                               |
| `promo-marquee-1400x560.png`        | 1400x560 | Marquee promo tile | Logo, name, tagline and a growth chart graphic                      |
| `store-icon-128.png`                | 128x128  | Store icon         | The logo at 96x96 with 16 px of transparent padding                 |

Upload the screenshots in the numbered order.

## Store rules these follow

From [Supplying images](https://developer.chrome.com/docs/webstore/images) and
[Complete your listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing):

- Screenshots: at least 1 and up to 5, 1280x800 (preferred) or 640x400,
  square corners, full bleed, showing the real user experience. The store shows
  them at 640x400, so each one has a short caption (6 words or fewer) in large type.
- Small promo tile 440x280 and marquee 1400x560: PNG or JPEG, brand-first
  rather than a screenshot, saturated colors, little text, filling the whole
  area with well-defined edges, and still readable at half size. These are the
  only text on them: "GrowTube" and "Free YouTube growth toolkit".
- The 128x128 store icon is `store-icon-128.png`: 96x96 artwork with 16 px of
  transparent padding per side, as the guideline asks. `scripts/generate-icons.mjs`
  builds it from the same master as the extension's own `public/icon/*.png`, whose
  artwork fills more of the canvas (fine in the toolbar, oversized in the store).

## How they were made

Every UI pixel comes from the real extension build (the `.output/chrome-mv3`
build at the time). It was loaded unpacked in a throwaway headless Microsoft
Edge profile and captured over the Chrome DevTools Protocol at
deviceScaleFactor 2. Each capture was then downscaled once (Lanczos) to its
on-canvas size, so nothing is upscaled or blurry, and placed on a 1280x800
brand canvas: a caption, the logo, and a minimal browser frame. A green
outline marks the GrowTube UI on screenshots 1 and 3. The promo tiles are
HTML pages rendered by the same browser, using `assets/brand/logo-source.png`.

Data shown:

- **Account.** The extension was signed in as a demo account named
  "Demo Creator" on a local, visual-only mock of the GrowTube API. No real
  account or email appears anywhere.
- **youtube.com pages.** These are the live, public site, signed out of
  YouTube, with region and language set to US / English through YouTube's own
  `gl`/`hl` parameters. Third-party ad slots were hidden. Thumbnails, titles
  and channel names are public YouTube content, as any viewer sees it.
- **VPH, outlier and subscriber numbers.** On screenshots 1 to 3 the extension
  computed these itself from those public pages. The mock server returned no
  stats, so the extension fell back to the page's own numbers.
- **Views over time (screenshot 1).** No invented history: the mock server
  answered with no snapshots, exactly like a server that has just started
  tracking the video. The panel then draws its real "tracking started" state:
  a line from the publish date to the current public view count, with the note
  that history fills in over time.
- **Keyword research (screenshot 2).** Real YouTube autocomplete suggestions,
  scored by the extension.
- **No Studio screenshot.** The earlier Studio shot used a simplified stand-in
  for the Studio editor, which the store's image guidelines ("the actual user
  experience") don't allow. To add one back, capture the real
  studio.youtube.com video-details page in a throwaway profile signed in to a
  test channel with a private demo upload, with no channel name or email in view.
- **AI Coach (screenshot 4).** The reply is a canned demo answer, streamed by
  a local mock of an OpenAI-compatible provider. With a real provider, the
  answer comes from the user's own model and key.

The generator scripts (capture, compose and the two mocks) were kept outside the
repo, in the session's scratch folder (`store-check/images/`, and
`fixer/images/` for the current screenshot 1, whose API mock returns no history). To regenerate:

1. Build the extension.
2. Start the API mock and the AI mock.
3. Run `node capture.mjs`, then `node compose.mjs`.
