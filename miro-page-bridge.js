(function initializeTalacherMiroPageBridge() {
  if (window.__talacherMiroPageBridgeLoaded) {
    return;
  }

  window.__talacherMiroPageBridgeLoaded = true;

  window.addEventListener("message", async (event) => {
    if (event.source !== window || !event.data?.type?.startsWith("TALACHER_")) {
      return;
    }

    if (event.data.type === "TALACHER_GET_SELECTED_MIRO_IMAGE") {
      await handleGetSelectedImage(event.data);
      return;
    }

    if (event.data.type === "TALACHER_UPDATE_SELECTED_MIRO_NOTE") {
      await handleUpdateSelectedNote(event.data);
    }
  });

  async function handleGetSelectedImage(message) {
    const { requestId } = message;

    try {
      if (!window.miro?.board?.getSelection) {
        throw new Error("Miro Web SDK is not available on this page.");
      }

      const selection = await window.miro.board.getSelection();
      const image = selection.find((item) => item.type === "image" && typeof item.getDataUrl === "function");

      if (!image) {
        throw new Error("No selected Miro image item was found.");
      }

      const dataUrl = await image.getDataUrl("original");

      window.postMessage({
        type: "TALACHER_GET_SELECTED_MIRO_IMAGE_RESULT",
        requestId,
        ok: true,
        image: {
          previewUrl: dataUrl,
          dataUrl,
          fileName: `${safeFileName(image.title || "miro-selection")}.png`,
          mimeType: mimeTypeFromDataUrl(dataUrl),
          uploadable: true,
          source: "miro-web-sdk",
          itemId: image.id
        }
      }, window.location.origin);
    } catch (error) {
      window.postMessage({
        type: "TALACHER_GET_SELECTED_MIRO_IMAGE_RESULT",
        requestId,
        ok: false,
        error: error.message || "Could not get selected Miro image."
      }, window.location.origin);
    }
  }

  async function handleUpdateSelectedNote(message) {
    const { requestId, contentHtml } = message;

    try {
      if (!window.miro?.board?.getSelection) {
        throw new Error("Miro Web SDK is not available on this page.");
      }

      const selection = await window.miro.board.getSelection();
      const note = selection.find((item) => item.type === "sticky_note" || item.type === "text");

      if (!note) {
        throw new Error("No selected Miro sticky note or text item was found.");
      }

      note.content = contentHtml;

      if (typeof note.sync !== "function") {
        throw new Error("Selected Miro item does not expose a sync method.");
      }

      await note.sync();

      window.postMessage({
        type: "TALACHER_UPDATE_SELECTED_MIRO_NOTE_RESULT",
        requestId,
        ok: true,
        itemType: note.type,
        itemId: note.id
      }, window.location.origin);
    } catch (error) {
      window.postMessage({
        type: "TALACHER_UPDATE_SELECTED_MIRO_NOTE_RESULT",
        requestId,
        ok: false,
        error: error.message || "Could not update selected Miro note."
      }, window.location.origin);
    }
  }

  function mimeTypeFromDataUrl(dataUrl) {
    return dataUrl.match(/^data:(.+?);base64,/)?.[1] || "image/png";
  }

  function safeFileName(value) {
    return value
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "miro-selection";
  }
})();
