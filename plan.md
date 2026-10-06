# Talacher Chrome Extension Plan

## Goal

Build a Chrome extension that connects selected Miro image assets to a monday.com art request board.

Known monday target:

- Board URL: `https://voldex-company.monday.com/boards/9457306673`
- Board ID: `9457306673`
- Default target group: `CH3 S1 OG Season`
- Default group ID: `group_mm60k55f`
- Future behavior: fetch groups from monday, sort by creation date, and default to the latest selected group.
- API token was provided by the user in chat for development use only. Do not commit it to source files.

Known monday columns:

- First title / item name: `name`
- Second Title: `text_mm57ycz1`
- Priority: `color_mktbawq0`
- Status: `status`
- Asset Type: `color_mktbqa5b`
- Rarity: `color_mm1y1nam`
- ImageRef Link: `text_mm63k2nn`

Primary workflow:

1. User selects an image/card on a Miro board.
2. Extension adds a **Send to monday board** action near the Miro selection toolbar or context menu.
3. Clicking that action opens an extension form.
4. User enters or selects monday row fields:
   - First title
   - Second Title
   - Priority
   - Asset Type
   - Rarity
   - Status is automatically set to `Ready To Start`.
5. Extension creates a new row/item on the target monday board, currently expected to be the `CH3 S1 OG Season` group/section.
6. Extension uploads the selected Miro image as an update on the new monday row.
7. Extension automatically writes the uploaded image reference URL into the monday `ImageRef Link` field.
8. On monday.com, when the user hovers a board row for 0.5 seconds, the extension shows a small image preview popup using that row's `ImageRef Link`.

## Current Status

Implemented smoke-test version:

- Minimal Chrome extension template exists.
- Popup confirms the extension is installed and working.
- Dev reload watcher exists at `http://127.0.0.1:17321/version`.
- Miro content script tries to inject a test **Send to monday board** button into Miro's active toolbar/context menu, with a fallback near the pointer.
- Clicking the Miro action opens a draft send form for monday row fields.
- Submitting the draft form closes the form and shows a success toast.
- Miro form attempts to detect the selected image and shows a right-side preview before submission.
- Miro form uses a progress bar during monday row creation/upload and offers a cancel action that aborts active monday network work where possible.
- Extension popup includes `Save selected as ready tag`, which stores the currently selected/captured Miro element as the ready-tag image in Chrome local storage.
- After a real or Shift-click dev success, the extension attempts to copy the saved ready tag to the clipboard so it can be pasted onto the Miro board.
- Shift-clicking `Create monday row` runs the success path without calling monday, for fast UI testing.
- Experimental Miro page bridge attempts to update a selected sticky note/text item after success using the Miro Web SDK. It writes First title and Second Title into the selected note if `window.miro.board.getSelection()` is available.
- Background service worker can create monday rows through the monday API after the token is saved in the extension popup.
- Background service worker can create a monday update/comment, upload the detected Miro image to that update, and write the returned monday asset URL into `ImageRef Link`. The update text says the image was uploaded Via Talacher.
- Extension popup can save the monday token and fetch board schema/groups.
- monday.com content script injects a delayed row-hover preview test popup.

Current files:

- `manifest.json`
- `popup.html`
- `popup.css`
- `popup.js`
- `content.js`
- `content.css`
- `dev-reloader.js`
- `dev-server.js`
- `package.json`
- `README.md`

## Immediate Test Checklist

1. Reload extension from `chrome://extensions`.
2. Refresh the Miro board tab.
3. Select or right-click an image/card in Miro.
4. Confirm **Send to monday board** appears.
5. Refresh the monday.com board tab.
6. Hover a board row for 0.5 seconds.
7. Confirm image preview popup appears.

## Implementation Phases

### Phase 1: Injection Reliability

- Make the Miro button appear in the correct place:
  - Near the selection toolbar when an image is selected.
  - Or inside/next to the context menu if that is more reliable.
- Make sure injection survives Miro UI rerenders.
- Make sure the monday hover preview targets real board rows only.
- Avoid preview appearing over headers, empty rows, menus, or unrelated UI.

### Send dialog (current)

- Opening the dialog asks the Miro Web SDK (via `miro-page-bridge.js`) for the selection first: images, text notes and item IDs, with groups expanded into their items. The full-size image loads with a 45 s budget; the 120 px `preview` format is shown blurred until it arrives. "Copy as image" is only a fallback when the selection has no image item, and the clipboard read is capped at 4 s.
- The pointer-based DOM capture never uses Miro's full-board canvas and never overrides the dialog's preview.
- Several selected images: a thumbnail strip picks which one uploads.
- Selected notes: the dialog lists them to choose which one gets the titles (or none); "Use as titles" fills the title fields from a note.
- "Group the selection on Miro after sending" groups the selected items once the row is created (remembered between sends; disabled when items are already in another group).
- Group, Priority, Rarity and Asset type use `content-picker.js`: searchable dropdowns showing monday's label and group colors. Groups refresh from monday every 5 minutes.

### Phase 2: Miro Selection Capture

- Detect the currently selected Miro image/card. Status: context-menu sends now try Miro Web SDK selected image `getDataUrl("original")` first, so image+note multi-selection uploads only the image. Native `Copy as image` and DOM/nearby-image detection remain as fallbacks.
- Extract useful metadata. Status: source URL, data URL, file name, and MIME type are attempted:
  - Image source URL or downloadable blob/data URL.
  - Visible title/text, if available.
  - Miro board URL.
  - Miro object ID, if available.
- Decide whether DOM extraction is enough or whether Miro SDK/API support is needed. Status: Web SDK image/note path is being tested against real Miro selections; clipboard path remains fallback.
- Build fallback handling when no image is selected.

### Phase 3: Send Form

- Replace the smoke-test click behavior with an extension form. Status: draft UI exists.
- Form fields:
  - First title
  - Second Title
  - Priority
  - Asset Type
  - Rarity
- Status is currently hidden and automatically set to `Ready To Start`.
- ImageRef Link is not manually entered. It will be populated automatically after the selected image is uploaded to monday as a row update/comment.
- Add sensible defaults from the Miro selection when possible.
- Validate required fields before creating the monday row.
- Show success and error states.

### Phase 4: monday.com API Integration

- Configure monday API access. Status: popup can save token in `chrome.storage.local`.
- Create item/row on the target board. Status: background mutation is wired.
- Set column values for. Status: initial mappings are wired:
  - First title
  - Second Title
  - Priority
  - Asset Type
  - Rarity
  - ImageRef Link
- Status-like monday columns are sent by label ID, resolved from the board's live column settings (deactivated labels skipped, cached 5 minutes, refreshed on "Fetch board"). The form's Priority/Asset Type/Rarity options sync to the live labels when opened. The hardcoded `MONDAY_STATUS_INDEXES` map is only a fallback when labels can't be fetched.
- Upload selected Miro image as an update on the created row. Status: initial `create_update` + `add_file_to_update` flow is wired.
- Populate `ImageRef Link` with the returned monday asset URL. Status: initial text-column write is wired.
- Store returned monday item ID for follow-up behavior.

### Phase 5: monday Image Preview

- Read each row's `ImageRef Link`. Status: preview only runs when the hovered row has a visible ImageRef Link URL in the DOM; rows without that field do not show or query.
- On row hover, silently preload immediately and show only after the image is ready and the configured delay has elapsed. Status: wired.
- Preview delay is configurable in the extension popup. Default: 500 ms.
- Show a larger image-only popup near the title columns with First title and Second Title in the bottom caption. Status: wired.
- Hide popup on mouse leave, scroll, resize, or row change.
- Cache previews to avoid repeated work. Status: in-memory cache by item ID.
- Handle broken or missing image links cleanly.

### Phase 6: Settings and Packaging

- Add extension options page for:
  - monday API token or backend endpoint.
  - monday board ID.
  - target group ID, such as `CH3 S1 OG Season`.
  - column ID mapping.
- Add safer dev/prod separation.
- Package extension for install or distribution.

## Open Questions

Need these before real API wiring:

1. Should the monday API token remain in Chrome extension storage for this internal tool, or should we move it to a local/backend helper before wider use?
2. In Miro, is the selected object always an uploaded image, or can it also be a screenshot/card/frame/group?
3. Should the row's First title and Second Title be manually entered every time, inferred from visible text, or both?
4. Should uploaded monday updates include only the image, or also a note with the Miro board/object link?

## Risks

- Miro's web DOM may not expose the original selected image URL reliably.
- The `Copy as image` clipboard route overwrites the current clipboard and depends on Chrome granting clipboard read access to the extension.
- Automatic placement of a saved ready tag onto the Miro board may require Miro SDK support; browser-synthesized paste events are commonly ignored by canvas/editor apps.
- A persistent Miro note update is possible through Miro SDK/API. The current implementation tests the Web SDK path first; if Miro does not expose the SDK on the normal board page, the next step is Miro OAuth/REST API with board/item IDs.
- monday.com's grid DOM can change often, so hover detection may need careful selectors and mutation handling.
- Storing monday API tokens inside a browser extension is convenient but less secure than using a small backend/local helper.
- Uploading a file to monday may require converting the Miro image URL into a blob first.
