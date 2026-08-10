# Talacher Test Extension

Chrome extension template for testing Miro and monday.com injection.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `C:\Users\Lotus\Desktop\extension\Talacher`.
5. Click the extension icon and open **Talacher Test Extension**.

## Dev Reload Test

Run:

```powershell
npm run dev
```

Then edit extension files.

The extension polls `http://127.0.0.1:17321/version` and calls `chrome.runtime.reload()` when the watcher detects a file change. After reload, reopen the popup to see the latest UI. Content scripts, when added later, usually also require refreshing the page they run on.

## Platform Injection Test

After loading or reloading the extension:

1. Open a Miro board.
2. Select or right-click an item.
3. Confirm the injected **Send to monday board** action appears and repositions near the pointer.
4. Open the monday.com board.
5. Hover a board row for at least 0.5 seconds.
6. Confirm the injected image preview appears near the row.
