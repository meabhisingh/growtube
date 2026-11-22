# YouTube Studio selectors (Studio optimizer)

Studio (`studio.youtube.com`) is a Polymer SPA that changes its markup without
notice. Studio needs a signed-in creator, so these selectors could not be checked
against the live site in CI. They come from Studio's long-stable element ids and
custom element names, with fallbacks. **Source of truth:** `selectors.ts`
(`SELECTORS`, `LABEL_TEXT`). Keep this file in sync with it.

## How lookups work

Each field is looked up in this order (`StudioFields` in `studio-dom.ts`):

1. **Element ids and custom element names.** These don't depend on the UI
   language. They are tried in the order listed below, and visible matches are
   preferred.
2. **`aria-label` and `placeholder` heuristics.** These only work when Studio's
   UI is in English.
3. **Label text.** The code finds the visible label ("Title", "Description",
   "Tags") and looks inside its nearest ancestors. English UI only.
4. **Shadow-root walk.** The same selectors are retried inside open shadow
   roots, in case Studio moves away from shady DOM.

Steps 3 and 4 are slow, so for a missing field they run at most once every
5 seconds. Found elements are cached and looked up again when they disconnect.

## Scope

- **Upload dialog:** every lookup is scoped to the dialog.
- **Edit page:** lookups skip anything inside an open upload dialog. The
  dialog takes priority because it is modal.
- **Our own UI:** `<ovq-studio-optimizer>`, the panel's host element, is always
  ignored.

## Contexts

| What                        | How it's detected                                                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video details editor        | URL `^/video/<11-char id>/edit` (also `/edit/...`)                                                                                                                               |
| Upload dialog, Details step | a visible `ytcp-uploads-dialog` (or `ytcp-uploads-dialog-v2`, `#upload-dialog`) that contains a **visible** title textbox. Other steps hide the textbox, so the panel hides too. |
| Video id in the dialog      | first `a[href]` in the dialog that matches `youtu.be/<id>`, `?v=<id>`, `/shorts/<id>` or `/video/<id>`. Fallback: the text of `ytcp-video-info` / `.video-url-fadeable`          |
| Studio dark theme           | a `dark` attribute on `<html>` or `<body>`, otherwise the luminance of the computed background of `ytcp-app` / `body` / `html`                                                   |

## Fields

| Field                        | Selectors, in priority order                                                                                                                                                                                                                                                                                                                      | Fallbacks                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Title (contenteditable)      | `#title-textarea #textbox`, `ytcp-social-suggestions-textbox#title-textarea #textbox`, `#title-textarea [contenteditable]`, `ytcp-video-title #textbox`, `#title #textbox`, `#textbox[aria-label*="title" i]`, `[contenteditable][aria-label*="title" i]`                                                                                         | label `Title` / `Title (required)`, then `[contenteditable]`                                                                                   |
| Description                  | `#description-textarea #textbox`, `ytcp-social-suggestions-textbox#description-textarea #textbox`, `#description-textarea [contenteditable]`, `#description-container #textbox`, `ytcp-video-description #textbox`, `#textbox[aria-label*="description" i]`, `#textbox[aria-label*="tell viewers" i]`, `[contenteditable]` with either aria-label | label `Description`, then `[contenteditable]` (never the title element)                                                                        |
| Tags container               | `#tags-container`, `ytcp-form-input-container#tags-container`, `ytcp-video-metadata-editor-advanced ytcp-free-text-chip-bar`, `ytcp-free-text-chip-bar#tags`, `#tags ytcp-chip-bar`                                                                                                                                                               | `closest()` of the tag input: `#tags-container`, `ytcp-free-text-chip-bar`, `ytcp-chip-bar`, `ytcp-form-input-container`, else its grandparent |
| Tag input                    | inside the container: `input#text-input`, `input`. Page-wide: `#tags-container input#text-input`, `#tags-container input`, `ytcp-free-text-chip-bar input#text-input`, `input[aria-label="Tags" i]`, `input[aria-label*="tags" i]`, `input[placeholder*="add tag" i]`                                                                             | label `Tags`, then `input`                                                                                                                     |
| Tag chips (in the container) | `ytcp-chip`, `ytcp-chip-v2`, `.ytcp-chip`, `[role="option"]`                                                                                                                                                                                                                                                                                      |                                                                                                                                                |
| Chip text                    | `#chip-text`, `.chip-text`, `#text`, `.text`                                                                                                                                                                                                                                                                                                      | the chip's whole `textContent`                                                                                                                 |
| Chip delete button           | `#delete-icon`, `#delete-button`, `[aria-label^="delete" i]`, `[aria-label^="remove" i]`, `ytcp-icon-button`, `tp-yt-iron-icon`                                                                                                                                                                                                                   |                                                                                                                                                |
| "Remove all" tags            | `#clear-button`, `[aria-label*="remove all" i]`, `[aria-label*="clear all" i]`, `[aria-label*="delete all" i]`                                                                                                                                                                                                                                    | clicks each chip's delete button                                                                                                               |
| "Show more" (reveals tags)   | `ytcp-video-metadata-editor #toggle-button`, `#toggle-button`, `ytcp-button[aria-label*="show more" i]`, `button[aria-label*="show more" i]`                                                                                                                                                                                                      | button-like element whose text is "Show more". Returns nothing when it reads "Show less"                                                       |

## Where the panel goes

| Placement                     | Anchor                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docked` (right column)       | after the visible `ytcp-video-info` (the video preview card). Fallback: appended to `ytcp-video-metadata-editor-sidepanel`, `#right-column`, `#side-panel` or `#sidepanel`. |
| `inline` (upload dialog only) | before the visible `ytcp-video-metadata-editor` / `ytcp-video-metadata-editor-basics` / `#basics`. Fallback: before the 5th ancestor of the title textbox.                  |
| `floating` (edit page only)   | `document.body`, as a `position: fixed` card (z-index 2150) that collapses to a pill.                                                                                       |

**Auto mode** docks the panel when the dock column is at least 260 px wide (and,
on the edit page, the window is at least 1000 px wide). Otherwise it floats on
the edit page, or goes inline in the upload dialog. The header button switches
between placements, and the choice is saved (`local:studioPanelPrefs`).

The upload dialog traps focus, like an iron-overlay with a backdrop. So the
panel must live **inside** the dialog and never floats there. An Escape key
pressed inside the panel is stopped at the window's capture phase, so it can't
close the dialog.

## Writing to Studio

Nothing ever clicks Save.

- **Title and description.** The code focuses the field, selects its contents,
  then runs `document.execCommand("insertText")`. This is the browser's native
  editing path: Studio receives real `beforeinput`/`input` events and enables
  Save. Every attempt is checked by reading the field back with `innerText`:
  1. The whole text in one call. Accepted only if it matches exactly, line
     breaks included.
  2. Line by line, using `insertLineBreak`, which gives `<br>` and round-trips
     exactly. Rich editors turn `"\n"` into `<div>`s, which add blank lines.
  3. `innerText = …`, plus synthetic `input` and `change` events.
  4. If every step fails, the text is copied to the clipboard and the panel
     asks the user to paste it.

  `execCommand` only runs after checking that the target really has focus and
  holds the selection. Without this check, a hidden field could make it edit
  whatever else is focused. Undo writes the previous text back the same way.
- **Tags.** For each tag, the code types into the chip input (`insertText` when
  the input is focused, otherwise the native value setter plus an `input`
  event), then sends Enter (`keydown`/`keypress`/`keyup`). If no chip appears, it
  types a trailing comma, then sends `change`. The new chip is verified each
  time. Tags that still don't appear are copied to the clipboard, and the panel
  says so.
- **Replace all.** The code clicks "Remove all", or each chip's delete button,
  then adds the new tags.

## When Studio changes

The quickest check is to open a video's Details page with DevTools and run:

```js
document.querySelector("#title-textarea #textbox");
document.querySelector("#description-textarea #textbox");
document.querySelector("#tags-container input, input[aria-label='Tags']");
document.querySelectorAll("#tags-container ytcp-chip");
document.querySelector("ytcp-video-info");
```

Then update `selectors.ts` and this file. When nothing matches, the panel says
"Couldn't find the editor fields" and offers Retry. It never touches Studio's
own UI.
