(function initializeTalacherMiroPageBridge() {
  if (window.__talacherMiroPageBridgeLoaded) {
    return;
  }

  window.__talacherMiroPageBridgeLoaded = true;

  // Runs in Miro's page world so it can use the Miro Web SDK. content.js talks to it with
  // window.postMessage({ type, requestId, payload }) and gets back `${type}_RESULT`.
  const handlers = {
    TALACHER_MIRO_GET_SELECTION: getSelectionSnapshot,
    TALACHER_MIRO_GET_IMAGE_DATA: getImageData,
    TALACHER_MIRO_UPDATE_NOTE: updateNote,
    TALACHER_MIRO_GROUP_ITEMS: groupItems
  };
  const TEXT_ITEM_TYPES = new Set(["sticky_note", "text", "shape"]);

  window.addEventListener("message", async (event) => {
    const handler = event.source === window ? handlers[event.data?.type] : null;

    if (!handler) {
      return;
    }

    const { type, requestId, payload } = event.data;

    try {
      const result = await handler(payload || {});
      window.postMessage({ type: `${type}_RESULT`, requestId, ok: true, result }, window.location.origin);
    } catch (error) {
      window.postMessage({
        type: `${type}_RESULT`,
        requestId,
        ok: false,
        error: error?.message || String(error) || "Miro request failed."
      }, window.location.origin);
    }
  });

  function getBoard() {
    if (!window.miro?.board?.getSelection) {
      throw new Error("Miro Web SDK is not available on this page.");
    }

    return window.miro.board;
  }

  async function getSelectionSnapshot() {
    const selection = await getBoard().getSelection();
    const items = [];
    const seen = new Set();

    // Selecting a group selects its children for our purposes.
    for (const item of selection) {
      const children = item.type === "group" && typeof item.getItems === "function"
        ? await item.getItems()
        : [item];

      for (const child of children) {
        if (!seen.has(child.id)) {
          seen.add(child.id);
          items.push(child);
        }
      }
    }

    const images = items
      .filter((item) => item.type === "image")
      .map((item) => ({
        id: item.id,
        title: item.title || "",
        width: item.width,
        height: item.height
      }));
    const notes = items
      .filter((item) => TEXT_ITEM_TYPES.has(item.type) && typeof item.content === "string")
      .map((item) => ({
        id: item.id,
        type: item.type,
        text: htmlToText(item.content),
        color: item.style?.fillColor || null
      }))
      .filter((note) => note.type !== "shape" || note.text);
    const groupIds = [...new Set(items.map((item) => item.groupId).filter(Boolean))];

    return {
      images,
      notes,
      itemIds: items.map((item) => item.id),
      alreadyGrouped: items.length > 1 && groupIds.length === 1 && items.every((item) => item.groupId === groupIds[0]),
      partlyGrouped: groupIds.length > 0
    };
  }

  async function getImageData({ itemId, format = "original" }) {
    const item = await getBoard().getById(itemId);

    if (item?.type !== "image" || typeof item.getDataUrl !== "function") {
      throw new Error("The selected Miro item is not an image.");
    }

    const dataUrl = await item.getDataUrl(format);
    const mimeType = dataUrl.match(/^data:(.+?);base64,/)?.[1] || "image/png";

    return {
      itemId: item.id,
      dataUrl,
      mimeType,
      fileName: `${safeFileName(item.title || "miro-image")}.${extensionForMimeType(mimeType)}`
    };
  }

  async function updateNote({ itemId, contentHtml }) {
    const board = getBoard();
    const note = itemId
      ? await board.getById(itemId)
      : (await board.getSelection()).find((item) => item.type === "sticky_note" || item.type === "text");

    if (!note || typeof note.content !== "string") {
      throw new Error("No selected Miro sticky note or text item was found.");
    }

    note.content = contentHtml;
    await note.sync();
    return { itemId: note.id, itemType: note.type };
  }

  async function groupItems({ itemIds = [] }) {
    const board = getBoard();
    const items = await Promise.all(itemIds.map((id) => board.getById(id).catch(() => null)));
    const groupable = items.filter(Boolean);

    if (groupable.length < 2) {
      return { grouped: false, reason: "Grouping needs at least two items." };
    }

    const groupIds = new Set(groupable.map((item) => item.groupId).filter(Boolean));

    if (groupIds.size === 1 && groupable.every((item) => item.groupId)) {
      return { grouped: false, reason: "Already grouped." };
    }

    if (groupIds.size) {
      throw new Error("Some of these items are already in another group.");
    }

    const group = await board.group({ items: groupable });
    return { grouped: true, groupId: group.id };
  }

  function htmlToText(html) {
    // Avoids DOM parsing so it works under Miro's Trusted Types policy.
    return String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&amp;/g, "&")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function extensionForMimeType(mimeType) {
    return { "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" }[mimeType] || "png";
  }

  function safeFileName(value) {
    return value
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "miro-image";
  }
})();
