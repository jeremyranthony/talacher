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
    TALACHER_MIRO_STYLE_NOTE: styleNote,
    TALACHER_MIRO_GROUP_ITEMS: groupItems,
    TALACHER_MIRO_FIND_TITLES: findTitleRecords,
    TALACHER_MIRO_ZOOM_TO: zoomTo
  };
  // Sticky notes take Miro's named colors; text and shapes take hex fills.
  const NOTE_COLORS = {
    purple: { sticky: "violet", fill: "#d6c2f5" },
    green: { sticky: "light_green", fill: "#c7efd8" },
    blue: { sticky: "light_blue", fill: "#c9def8" },
    orange: { sticky: "orange", fill: "#ffd9b3" },
    gray: { sticky: "gray", fill: "#e6e6e6" }
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
      .map((item) => {
        const text = htmlToText(item.content);
        return {
          id: item.id,
          type: item.type,
          text,
          color: item.style?.fillColor || null,
          spec: parseItemSpec(text)
        };
      })
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

  async function updateNote({ itemId, firstTitle = "", secondTitle = "" }) {
    const board = getBoard();
    const note = itemId
      ? await board.getById(itemId)
      : (await board.getSelection()).find((item) => item.type === "sticky_note" || item.type === "text");

    if (!note || typeof note.content !== "string") {
      throw new Error("No selected Miro sticky note or text item was found.");
    }

    // Item spec text ("FirstTitle: ...") keeps every other field; only the title lines change.
    note.content = parseItemSpec(htmlToText(note.content))
      ? patchSpecTitles(note.content, { FirstTitle: firstTitle, SecondTitle: secondTitle })
      : [firstTitle, secondTitle].filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    await note.sync();
    return { itemId: note.id, itemType: note.type };
  }

  async function styleNote({ itemId, color = "purple" }) {
    const palette = NOTE_COLORS[color];
    const note = palette && itemId ? await getBoard().getById(itemId) : null;

    if (!note?.style) {
      return { styled: false };
    }

    note.style.fillColor = note.type === "sticky_note" ? palette.sticky : palette.fill;
    await note.sync();
    return { styled: true, itemId: note.id };
  }

  // Every note/text/shape on the board with title-like content, for duplicate and similarity checks.
  async function findTitleRecords() {
    const items = await getBoard().get({ type: ["sticky_note", "text", "shape"] });
    const records = [];

    for (const item of items) {
      const text = htmlToText(item.content);

      if (!text || text.length > 600) {
        continue;
      }

      const spec = parseItemSpec(text);
      const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

      if (spec) {
        records.push({ id: item.id, type: item.type, isSpec: true, ...spec });
      } else if (lines.length >= 1 && lines.length <= 3 && lines.every((line) => line.length <= 60)) {
        records.push({ id: item.id, type: item.type, isSpec: false, firstTitle: lines[0], secondTitle: lines.slice(1).join(" ") });
      }
    }

    return { records, scanned: items.length };
  }

  async function zoomTo({ itemId }) {
    const board = getBoard();
    const item = await board.getById(itemId);
    await board.viewport.zoomTo(item);
    return { ok: true };
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

  // Parses Miro item spec text: "FirstTitle: Short", "SecondTitle = Buzz Cut", "ItemType: Hair"...
  function parseItemSpec(text) {
    const fields = {};

    for (const line of String(text || "").split("\n")) {
      const match = /^\s*(FirstTitle|SecondTitle|ItemType|Rarity|ItemName)\s*[:=]\s*(.*)$/i.exec(line.replace(/\u00a0/g, " "));

      if (match) {
        const key = match[1].toLowerCase();
        const value = match[2].trim();
        fields[{ firsttitle: "firstTitle", secondtitle: "secondTitle", itemtype: "itemType", rarity: "rarity", itemname: "itemName" }[key]] = value;
      }
    }

    return "firstTitle" in fields || "secondTitle" in fields ? fields : null;
  }

  function patchSpecTitles(html, values) {
    let next = String(html);

    for (const [key, value] of Object.entries(values)) {
      const pattern = new RegExp(`(${key}\\s*[:=]\\s*)([^<\\n]*)`, "i");

      if (pattern.test(next)) {
        next = next.replace(pattern, (_match, prefix) => `${prefix}${escapeHtml(value)}`);
      } else {
        next = `<p>${key}: ${escapeHtml(value)}</p>${next}`;
      }
    }

    return next;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[character]);
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
