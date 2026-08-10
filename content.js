(function initializeTalacherContentScript() {
  const host = window.location.hostname;
  const isMiro = host === "miro.com" || host.endsWith(".miro.com");
  const isMonday = host === "monday.com" || host.endsWith(".monday.com");

  if (window.__talacherContentScriptLoaded) {
    return;
  }

  window.__talacherContentScriptLoaded = true;

  if (isMiro) {
    initializeMiroTestAction();
  }

  if (isMonday) {
    initializeMondayHoverPreview();
  }
})();

function initializeMiroTestAction() {
  let lastPointer = { x: 24, y: 96, time: Date.now() };
  let selectedImage = null;
  let syncTimer = null;

  const dialog = createMiroSendDialog(() => selectedImage);
  const fallback = createMiroFallbackAction(dialog.open);
  const menuAction = createMiroMenuAction(() => dialog.open({ preferClipboard: true }));
  const toolbarAction = createMiroToolbarAction(dialog.open);
  document.documentElement.append(dialog.element);
  document.documentElement.append(dialog.toastElement);
  document.documentElement.append(fallback);

  const scheduleSync = () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncMiroAction, 80);
  };

  const rememberPointer = (event) => {
    if (event.target.closest?.(".talacher-root")) {
      return;
    }

    lastPointer = {
      x: event.clientX,
      y: event.clientY,
      time: Date.now()
    };
    selectedImage = captureMiroImageCandidate(event);
    dialog.setSelection(selectedImage);
    scheduleSync();
    setTimeout(syncMiroAction, 250);
    setTimeout(syncMiroAction, 600);
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener("pointerup", rememberPointer, true);
  document.addEventListener("contextmenu", rememberPointer, true);
  window.addEventListener("resize", scheduleSync);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "TALACHER_SAVE_READY_TAG_FROM_SELECTION") {
      return false;
    }

    dialog.saveReadyTag({ preferCurrentSelection: true })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Could not save ready tag." }));

    return true;
  });
  syncMiroAction();

  function syncMiroAction() {
    const menuTarget = findMiroMenuInsertionTarget();

    if (menuTarget) {
      mountMiroMenuActions(menuTarget, [menuAction]);
      fallback.hidden = true;
      return;
    }

    const toolbarHost = findMiroToolbarHost(lastPointer);

    if (toolbarHost) {
      mountMiroToolbarAction(toolbarHost, toolbarAction);
      fallback.hidden = true;
      return;
    }

    if (Date.now() - lastPointer.time < 4000) {
      positionMiroFallback(fallback, lastPointer);
      fallback.hidden = false;
      return;
    }

    fallback.hidden = true;
  }
}

function createMiroToolbarAction(openDialog) {
  const action = document.createElement("button");
  action.className = "talacher-root talacher-miro-native-action talacher-miro-toolbar-action";
  action.type = "button";
  action.textContent = "Send to monday board";
  action.addEventListener("pointerdown", stopMiroActionEvent, true);
  action.addEventListener("click", (event) => {
    stopMiroActionEvent(event);
    openDialog();
  });
  return action;
}

function createMiroMenuAction(openDialog) {
  const action = document.createElement("div");
  action.className = "talacher-root talacher-miro-native-action talacher-miro-menu-action";
  action.setAttribute("role", "menuitem");
  action.setAttribute("tabindex", "-1");
  action.setAttribute("data-orientation", "vertical");
  action.setAttribute("data-talacher-menu-item", "true");
  action.textContent = "Send to monday board";
  action.addEventListener("pointerdown", stopMiroActionEvent, true);
  action.addEventListener("click", (event) => {
    stopMiroActionEvent(event);
    openDialog();
  });
  return action;
}

function createMiroFallbackAction(openDialog) {
  const action = document.createElement("div");
  action.className = "talacher-root talacher-miro-action";
  action.hidden = true;
  action.innerHTML = `
    <div class="talacher-kicker">Talacher Miro test</div>
    <button class="talacher-primary-button" type="button">Send to monday board</button>
    <p class="talacher-note">Could not find Miro's toolbar/menu yet, so this fallback appeared near the selection.</p>
  `;

  action.querySelector("button").addEventListener("click", (event) => {
    stopMiroActionEvent(event);
    openDialog();
  });

  return action;
}

function createMiroSendDialog(getSelectedImage) {
  const dialog = document.createElement("div");
  const toast = document.createElement("div");
  let toastTimer = null;
  let activeSelection = null;

  dialog.className = "talacher-root talacher-dialog-shell";
  dialog.hidden = true;
  toast.className = "talacher-root talacher-toast";
  toast.hidden = true;
  dialog.innerHTML = `
    <div class="talacher-dialog-backdrop" data-talacher-close></div>
    <section class="talacher-send-dialog" role="dialog" aria-modal="true" aria-labelledby="talacher-send-title">
      <header class="talacher-dialog-header">
        <div>
          <p class="talacher-dialog-kicker">CH3 S1 OG Season</p>
          <h2 id="talacher-send-title">Send to monday board</h2>
        </div>
        <button class="talacher-icon-button" type="button" aria-label="Close" data-talacher-close>X</button>
      </header>
      <form class="talacher-send-form">
        <div class="talacher-send-layout">
          <div class="talacher-form-fields">
            <label>
              <span>Group</span>
              <select name="groupId" data-talacher-group-select>
                <option value="group_mm60k55f">CH3 S1 OG Season</option>
              </select>
            </label>
            <label>
              <span>First title</span>
              <input name="firstTitle" type="text" autocomplete="off" required>
            </label>
            <label>
              <span>Second Title</span>
              <input name="secondTitle" type="text" autocomplete="off">
            </label>
            <input name="status" type="hidden" value="Ready To Start">
            <div class="talacher-form-grid">
              <label>
                <span>Priority</span>
                <select name="priority">
                  <option value="">Select</option>
                  <option>Critical</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </label>
              <label>
                <span>Rarity</span>
                <select name="rarity">
                  <option>Pending</option>
                  <option>Bronze</option>
                  <option>Ruby</option>
                  <option>Silver</option>
                  <option>Unset</option>
                  <option>Gold</option>
                  <option>Amethyst</option>
                  <option>Diamond</option>
                </select>
              </label>
            </div>
            <label>
              <span>Asset Type</span>
              <select name="assetType">
                <option>Not Categorized</option>
                <option>Gloves</option>
                <option>Visor</option>
                <option>2D Shirt</option>
                <option>VFX</option>
                <option>Head Accessory</option>
                <option>3D Model</option>
                <option>Football</option>
                <option>Face Accessory</option>
                <option>2D Pants</option>
                <option>Emoji</option>
                <option>Face Mask</option>
                <option>LC Shirt</option>
                <option>Cleat</option>
                <option>Sleeve</option>
                <option>End Zone</option>
                <option>Costume</option>
                <option>Socks</option>
                <option>LC Pants</option>
                <option>Hat Accessory</option>
                <option>Arm Accessory</option>
                <option>Head</option>
                <option>Front Accessory</option>
                <option>Trail</option>
                <option>Backplate</option>
                <option>Hair</option>
                <option>Vest</option>
                <option>Waist Accessory</option>
                <option>Neck Accessory</option>
                <option>Helmet</option>
                <option>Back Accessory</option>
                <option>Wrist Accessory</option>
                <option>Animation</option>
                <option>Trade Booth</option>
              </select>
            </label>
          </div>
          <figure class="talacher-image-preview" data-talacher-preview>
            <figcaption class="talacher-preview-heading">Image preview</figcaption>
            <div class="talacher-image-preview-frame">
              <img alt="Selected Miro asset preview" data-talacher-preview-image>
            </div>
            <figcaption data-talacher-preview-caption>No uploadable Miro image detected yet.</figcaption>
          </figure>
        </div>
        <div class="talacher-progress" data-talacher-progress hidden role="status">
          <div class="talacher-progress-track" aria-hidden="true">
            <span data-talacher-progress-bar></span>
          </div>
          <p data-talacher-progress-label></p>
        </div>
        <footer class="talacher-dialog-actions">
          <button class="talacher-secondary-button" type="button" data-talacher-cancel>Cancel</button>
          <button class="talacher-primary-button" type="submit">Create monday row</button>
        </footer>
      </form>
    </section>
  `;

  const form = dialog.querySelector("form");
  const progress = dialog.querySelector("[data-talacher-progress]");
  const progressBar = dialog.querySelector("[data-talacher-progress-bar]");
  const progressLabel = dialog.querySelector("[data-talacher-progress-label]");
  const firstTitle = form.elements.firstTitle;
  const submitButton = form.querySelector("button[type='submit']");
  const cancelButton = form.querySelector("[data-talacher-cancel]");
  const groupSelect = form.querySelector("[data-talacher-group-select]");
  const groupKicker = dialog.querySelector(".talacher-dialog-kicker");
  const preview = dialog.querySelector("[data-talacher-preview]");
  const previewImage = dialog.querySelector("[data-talacher-preview-image]");
  const previewCaption = dialog.querySelector("[data-talacher-preview-caption]");
  let activeRequestId = null;
  let isSubmitting = false;
  let cancelRequested = false;
  let submitWithShift = false;

  const close = () => {
    dialog.hidden = true;
    resetProgress();
  };

  const showToast = (message) => {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 3200);
  };

  const saveReadyTag = async (options = {}) => {
    setProgress("Saving ready tag...", 28, true);
    dialog.hidden = false;

    let tagSelection = null;

    if (!options.preferCurrentSelection) {
      tagSelection = await captureMiroSelectionViaClipboard();
    }

    tagSelection = tagSelection || activeSelection || getSelectedImage();
    const storedTag = await readyTagFromSelection(tagSelection);

    if (!storedTag) {
      setProgress(tagSelection?.reason || "Could not copy this Miro selection as a ready tag.", 100);
      progress.classList.add("talacher-progress-error");
      return { saved: false };
    }

    await chrome.storage.local.set({
      talacherReadyTag: storedTag
    });

    close();
    showToast("Ready tag saved.");
    return { saved: true };
  };

  const open = async (options = {}) => {
    activeSelection = getSelectedImage();
    renderMiroImagePreview(activeSelection, preview, previewImage, previewCaption);
    resetProgress();
    dialog.hidden = false;
    loadMondayGroups(groupSelect, groupKicker);
    setTimeout(() => firstTitle.focus(), 0);

    if (options.preferClipboard) {
      setProgress("Reading selected Miro image...", 18);
      const sdkSelection = await captureMiroSelectedImageViaSdk();
      const clipboardSelection = sdkSelection || await captureMiroSelectionViaClipboard();

      if (clipboardSelection) {
        activeSelection = clipboardSelection;
        renderMiroImagePreview(activeSelection, preview, previewImage, previewCaption);
      }

      resetProgress();
    }
  };

  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-talacher-close]")) {
      event.preventDefault();
      cancelOrClose();
      return;
    }

    if (event.target.closest("[data-talacher-cancel]")) {
      event.preventDefault();
      cancelOrClose();
    }
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      cancelOrClose();
    }
  });

  submitButton.addEventListener("click", (event) => {
    submitWithShift = event.shiftKey;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = Object.fromEntries(new FormData(form).entries());
    const isDevSuccess = submitWithShift;
    submitWithShift = false;
    activeRequestId = crypto.randomUUID ? crypto.randomUUID() : `talacher-${Date.now()}`;
    isSubmitting = true;
    cancelRequested = false;
    submitButton.disabled = true;
    cancelButton.textContent = "Cancel";
    cancelButton.disabled = false;
    setProgress(activeSelection?.uploadable
      ? "Preparing image upload..."
      : "Creating monday row without an uploadable image...", 24);

    try {
      payload.image = await prepareMiroImageForUpload(activeSelection);

      if (isDevSuccess) {
        setProgress("Dev success route complete.", 100);
        const readyTagCopied = await copyReadyTagToClipboard().catch(() => false);
        const noteResult = await updateSelectedMiroNote(payload).catch((error) => ({ ok: false, error: error.message }));
        close();
        form.reset();
        showToast(buildSuccessToast("Dev success", {
          readyTagCopied,
          noteResult
        }));
        return;
      }

      setProgress(payload.image?.uploadable
        ? "Creating monday row and uploading image..."
        : "Creating monday row without an uploadable image...", 52, true);
      const response = await sendTalacherMessage({
        type: "TALACHER_CREATE_MONDAY_ITEM",
        requestId: activeRequestId,
        payload
      });
      setProgress("Done.", 100);
      close();
      form.reset();
      const readyTagCopied = await copyReadyTagToClipboard().catch(() => false);
      const noteResult = await updateSelectedMiroNote(payload).catch((error) => ({ ok: false, error: error.message }));
      showToast(buildSuccessToast(response.asset?.url
        ? `Created row and uploaded image: ${response.item.name}`
        : `Created monday row: ${response.item.name}`, {
        readyTagCopied,
        noteResult
      }));
    } catch (error) {
      if (cancelRequested || error.message === "Cancelled.") {
        close();
        showToast("Cancelled monday send. A row may exist if monday already created it.");
      } else {
        setProgress(error.message, 100);
        progress.classList.add("talacher-progress-error");
      }
    } finally {
      isSubmitting = false;
      activeRequestId = null;
      cancelRequested = false;
      submitButton.disabled = false;
      cancelButton.disabled = false;
      cancelButton.textContent = "Cancel";
    }
  });

  function setProgress(label, percent, indeterminate = false) {
    progress.hidden = false;
    progress.classList.toggle("talacher-progress-indeterminate", indeterminate);
    progress.classList.remove("talacher-progress-error");
    progressBar.style.width = `${percent}%`;
    progressLabel.textContent = label;
  }

  function resetProgress() {
    progress.hidden = true;
    progress.classList.remove("talacher-progress-indeterminate", "talacher-progress-error");
    progressBar.style.width = "0%";
    progressLabel.textContent = "";
  }

  function cancelOrClose() {
    if (!isSubmitting) {
      close();
      return;
    }

    cancelRequested = true;
    cancelButton.disabled = true;
    cancelButton.textContent = "Cancelling...";
    setProgress("Cancelling monday send...", 82, true);

    if (activeRequestId) {
      sendTalacherMessage({
        type: "TALACHER_CANCEL_REQUEST",
        requestId: activeRequestId
      }).catch(() => {});
    }
  }

  return {
    element: dialog,
    toastElement: toast,
    saveReadyTag,
    setSelection(selection) {
      activeSelection = selection;

      if (!dialog.hidden) {
        renderMiroImagePreview(activeSelection, preview, previewImage, previewCaption);
      }
    },
    open,
    close
  };
}

function buildSuccessToast(baseMessage, details) {
  const parts = [baseMessage];

  if (details.readyTagCopied) {
    parts.push("Ready tag copied.");
  }

  if (details.noteResult?.ok) {
    parts.push("Miro note updated.");
  } else if (details.noteResult?.error) {
    parts.push(`Miro note not updated: ${details.noteResult.error}`);
  }

  return `${parts.join(" ")}.`;
}

function updateSelectedMiroNote(payload) {
  const noteText = [payload.firstTitle, payload.secondTitle]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("\n");

  if (!noteText) {
    return Promise.resolve({ ok: false, error: "No title text to write." });
  }

  const contentHtml = noteText
    .split("\n")
    .map(escapeHtml)
    .map((line) => `<p>${line}</p>`)
    .join("");
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `talacher-miro-note-${Date.now()}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", handleResult);
      resolve({ ok: false, error: "Miro note update timed out." });
    }, 2200);

    function handleResult(event) {
      if (
        event.source !== window ||
        event.data?.type !== "TALACHER_UPDATE_SELECTED_MIRO_NOTE_RESULT" ||
        event.data.requestId !== requestId
      ) {
        return;
      }

      clearTimeout(timeout);
      window.removeEventListener("message", handleResult);
      resolve(event.data);
    }

    window.addEventListener("message", handleResult);
    window.postMessage({
      type: "TALACHER_UPDATE_SELECTED_MIRO_NOTE",
      requestId,
      contentHtml
    }, window.location.origin);
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

async function copyReadyTagToClipboard() {
  const { talacherReadyTag } = await chrome.storage.local.get("talacherReadyTag");

  if (!talacherReadyTag?.dataUrl) {
    return false;
  }

  const blob = dataUrlToBlob(talacherReadyTag.dataUrl);
  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type || talacherReadyTag.mimeType || "image/png"]: blob
    })
  ]);
  return true;
}

async function prepareMiroImageForUpload(selection) {
  if (!selection?.uploadable) {
    return null;
  }

  if (selection.dataUrl || !selection.sourceUrl?.startsWith("blob:")) {
    return selection;
  }

  try {
    const response = await fetch(selection.sourceUrl);
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);

    return {
      ...selection,
      dataUrl,
      mimeType: blob.type || selection.mimeType || "image/png",
      fileName: selection.fileName || "miro-selection.png"
    };
  } catch {
    return {
      ...selection,
      uploadable: false,
      reason: "Chrome could not read Miro's temporary image URL for upload."
    };
  }
}

async function readyTagFromSelection(selection) {
  if (!selection?.uploadable) {
    return null;
  }

  if (selection.dataUrl) {
    return {
      dataUrl: selection.dataUrl,
      fileName: selection.fileName || "ready-tag.png",
      mimeType: selection.mimeType || "image/png",
      savedAt: Date.now()
    };
  }

  if (!selection.sourceUrl) {
    return null;
  }

  try {
    const response = await fetch(selection.sourceUrl, { cache: "no-store" });

    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);

    return {
      dataUrl,
      fileName: selection.fileName || "ready-tag.png",
      mimeType: blob.type || selection.mimeType || "image/png",
      savedAt: Date.now()
    };
  } catch {
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function renderMiroImagePreview(selection, preview, image, caption) {
  const previewUrl = selection?.previewUrl || selection?.dataUrl || selection?.sourceUrl;

  preview.classList.toggle("talacher-image-preview-empty", !previewUrl);
  image.hidden = !previewUrl;

  if (previewUrl) {
    image.src = previewUrl;
  } else {
    image.removeAttribute("src");
  }

  if (!selection) {
    caption.textContent = "No uploadable Miro image detected yet.";
    return;
  }

  if (selection.uploadable) {
    caption.textContent = `Ready to upload ${selection.fileName}.`;
    return;
  }

  caption.textContent = selection.reason || "Preview found, but Chrome could not read an uploadable file.";
}

async function captureMiroSelectionViaClipboard() {
  const copyAsImageItem = findMiroCopyAsImageItem();

  if (!copyAsImageItem) {
    return null;
  }

  try {
    activateMiroMenuItem(copyAsImageItem);
    await wait(350);

    const items = await navigator.clipboard.read();

    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));

      if (!imageType) {
        continue;
      }

      const blob = await item.getType(imageType);
      const dataUrl = await blobToDataUrl(blob);

      return {
        previewUrl: dataUrl,
        dataUrl,
        fileName: "miro-selection.png",
        mimeType: blob.type || imageType || "image/png",
        uploadable: true,
        source: "miro-copy-as-image"
      };
    }
  } catch {
    return {
      previewUrl: null,
      fileName: "miro-selection.png",
      mimeType: "image/png",
      uploadable: false,
      reason: "Miro Copy as image ran, but Chrome did not allow reading the copied image from the clipboard."
    };
  }

  return null;
}

function captureMiroSelectedImageViaSdk() {
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `talacher-miro-image-${Date.now()}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", handleResult);
      resolve(null);
    }, 2200);

    function handleResult(event) {
      if (
        event.source !== window ||
        event.data?.type !== "TALACHER_GET_SELECTED_MIRO_IMAGE_RESULT" ||
        event.data.requestId !== requestId
      ) {
        return;
      }

      clearTimeout(timeout);
      window.removeEventListener("message", handleResult);
      resolve(event.data.ok ? event.data.image : null);
    }

    window.addEventListener("message", handleResult);
    window.postMessage({
      type: "TALACHER_GET_SELECTED_MIRO_IMAGE",
      requestId
    }, window.location.origin);
  });
}

function activateMiroMenuItem(item) {
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    view: window
  };

  item.dispatchEvent(new PointerEvent("pointerdown", {
    ...eventOptions,
    pointerType: "mouse"
  }));
  item.dispatchEvent(new MouseEvent("mousedown", eventOptions));
  item.dispatchEvent(new PointerEvent("pointerup", {
    ...eventOptions,
    pointerType: "mouse"
  }));
  item.dispatchEvent(new MouseEvent("mouseup", eventOptions));
  item.click();
}

function findMiroCopyAsImageItem() {
  return Array.from(document.querySelectorAll("[role='menuitem']"))
    .filter((item) => !item.closest(".talacher-root"))
    .find((item) => item.textContent?.trim().startsWith("Copy as image")) || null;
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function captureMiroImageCandidate(event) {
  const elements = document.elementsFromPoint(event.clientX, event.clientY);

  for (const element of elements) {
    const candidate = extractMiroImageFromElement(element);

    if (candidate) {
      return candidate;
    }
  }

  const nearbyImages = Array.from(document.querySelectorAll("img, image, canvas"))
    .map((element) => ({
      element,
      distance: distanceFromPointToElement(event.clientX, event.clientY, element)
    }))
    .filter((candidate) => candidate.distance < 160)
    .sort((a, b) => a.distance - b.distance);

  for (const { element } of nearbyImages) {
    const candidate = extractMiroImageFromElement(element);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function extractMiroImageFromElement(element) {
  const direct = imageCandidateFromNode(element);

  if (direct) {
    return direct;
  }

  for (const child of Array.from(element.querySelectorAll?.("img, image, canvas") || []).slice(0, 20)) {
    const childCandidate = imageCandidateFromNode(child);

    if (childCandidate) {
      return childCandidate;
    }
  }

  const backgroundUrl = getBackgroundImageUrl(element);

  if (backgroundUrl) {
    return {
      previewUrl: backgroundUrl,
      sourceUrl: backgroundUrl,
      fileName: "miro-selection.png",
      mimeType: "image/png",
      uploadable: true
    };
  }

  return null;
}

function imageCandidateFromNode(node) {
  if (node instanceof HTMLCanvasElement) {
    try {
      const dataUrl = node.toDataURL("image/png");

      if (dataUrl && dataUrl !== "data:,") {
        return {
          previewUrl: dataUrl,
          dataUrl,
          fileName: "miro-selection.png",
          mimeType: "image/png",
          uploadable: true
        };
      }
    } catch {
      return {
        previewUrl: null,
        fileName: "miro-selection.png",
        mimeType: "image/png",
        uploadable: false,
        reason: "Miro image preview was found, but Chrome blocked reading pixels from the canvas."
      };
    }
  }

  const sourceUrl = getNodeImageUrl(node);

  if (!sourceUrl || isTinyUtilityImage(node)) {
    return null;
  }

  return {
    previewUrl: sourceUrl,
    sourceUrl,
    fileName: fileNameFromUrl(sourceUrl),
    mimeType: mimeTypeFromUrl(sourceUrl),
    uploadable: true
  };
}

function getNodeImageUrl(node) {
  if (node instanceof HTMLImageElement) {
    return node.currentSrc || node.src || null;
  }

  if (node instanceof SVGImageElement) {
    return node.href?.baseVal || node.getAttribute("href") || node.getAttribute("xlink:href");
  }

  return null;
}

function isTinyUtilityImage(node) {
  const rect = node.getBoundingClientRect();
  return rect.width < 48 || rect.height < 48;
}

function getBackgroundImageUrl(element) {
  const backgroundImage = window.getComputedStyle(element).backgroundImage;
  const match = backgroundImage.match(/url\(["']?(.+?)["']?\)/);
  return match?.[1] || null;
}

function distanceFromPointToElement(x, y, element) {
  const rect = element.getBoundingClientRect();
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

function fileNameFromUrl(url) {
  if (url.startsWith("data:")) {
    return "miro-selection.png";
  }

  try {
    const parsed = new URL(url);
    const fileName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    return fileName.includes(".") ? fileName : "miro-selection.png";
  } catch {
    return "miro-selection.png";
  }
}

function mimeTypeFromUrl(url) {
  const cleanUrl = url.split("?")[0].toLowerCase();

  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (cleanUrl.endsWith(".webp")) {
    return "image/webp";
  }

  if (cleanUrl.endsWith(".gif")) {
    return "image/gif";
  }

  return "image/png";
}

function sendTalacherMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "Extension request failed."));
        return;
      }

      resolve(response.result);
    });
  });
}

async function loadMondayGroups(select, kicker) {
  try {
    const settings = await sendTalacherMessage({ type: "TALACHER_GET_SETTINGS" });
    const groups = settings.groups?.length
      ? settings.groups
      : [{ id: settings.config.groupId, title: settings.config.groupTitle }];

    select.replaceChildren(...groups.map((group) => {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.title;
      return option;
    }));

    const selectedGroup = groups.find((group) => group.id === settings.config.groupId) || groups[0];
    select.value = selectedGroup.id;
    kicker.textContent = selectedGroup.title;
    select.onchange = () => {
      kicker.textContent = groups.find((group) => group.id === select.value)?.title || "monday group";
    };
  } catch {
    kicker.textContent = "CH3 S1 OG Season";
  }
}

function stopMiroActionEvent(event) {
  event.preventDefault();
  event.stopPropagation();
}

function findMiroToolbarHost(lastPointer) {
  const selectors = [
    "[role='toolbar']",
    "[aria-label*='toolbar' i]",
    "[data-testid*='toolbar' i]",
    "[class*='toolbar' i]"
  ].join(",");

  return Array.from(document.querySelectorAll(selectors))
    .filter(isUsableMiroToolbarHost)
    .map((element) => ({
      element,
      score: scoreMiroToolbarHost(element, lastPointer)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.element || null;
}

function isUsableMiroToolbarHost(element) {
  if (element.closest(".talacher-root")) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width >= 80 &&
    rect.height >= 28 &&
    rect.width <= 760 &&
    rect.height <= 120 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    Number(style.opacity) > 0.05
  );
}

function scoreMiroToolbarHost(element, lastPointer) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const distance = Math.hypot(centerX - lastPointer.x, centerY - lastPointer.y);
  const name = [
    element.getAttribute("aria-label"),
    element.getAttribute("data-testid"),
    element.className
  ].join(" ").toLowerCase();

  let score = Math.max(0, 520 - distance);

  if (element.getAttribute("role") === "toolbar") {
    score += 220;
  }

  if (name.includes("toolbar")) {
    score += 100;
  }

  return score;
}

function findMiroMenuInsertionTarget() {
  const menuItems = Array.from(document.querySelectorAll("[role='menuitem']"))
    .filter((item) => !item.closest(".talacher-root"))
    .filter(isVisibleMiroMenuItem);

  if (!menuItems.length) {
    return null;
  }

  const copyLinkItem = menuItems.find((item) => item.textContent?.trim().startsWith("Copy link"));
  const copyAsImageItem = menuItems.find((item) => item.textContent?.trim().startsWith("Copy as image"));
  const copyItem = menuItems.find((item) => item.textContent?.trim().startsWith("Copy"));
  const reference = copyLinkItem || copyItem || copyAsImageItem;

  if (!reference || !looksLikeMiroContextMenu(menuItems)) {
    return null;
  }

  return {
    parent: reference.parentElement,
    reference: copyAsImageItem || reference.nextElementSibling
  };
}

function isVisibleMiroMenuItem(item) {
  const rect = item.getBoundingClientRect();
  const style = window.getComputedStyle(item);

  return (
    rect.width >= 160 &&
    rect.height >= 20 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    Number(style.opacity) > 0.05
  );
}

function looksLikeMiroContextMenu(menuItems) {
  const text = menuItems.map((item) => item.textContent || "").join("\n");
  return (
    text.includes("Copy") &&
    text.includes("Copy as image") &&
    (
      text.includes("Copy link") ||
      text.includes("Duplicate") ||
      text.includes("Rename") ||
      text.includes("Clear content")
    )
  );
}

function mountMiroMenuActions(target, actions) {
  if (!target.parent) {
    return;
  }

  let nextSibling = target.reference;

  for (const action of [...actions].reverse()) {
    if (action.parentElement !== target.parent || action.nextSibling !== nextSibling) {
      target.parent.insertBefore(action, nextSibling);
    }

    nextSibling = action;
  }
}

function mountMiroToolbarAction(host, action) {
  if (action.parentElement !== host) {
    host.append(action);
  }
}

function positionMiroFallback(action, pointer) {
  const x = Math.min(Math.max(pointer.x + 12, 12), window.innerWidth - 236);
  const y = Math.min(Math.max(pointer.y + 12, 12), window.innerHeight - 130);
  action.style.left = `${x}px`;
  action.style.top = `${y}px`;
}

function initializeMondayHoverPreview() {
  let activeRow = null;
  let activeHoverToken = 0;
  let previewDelayMs = 500;
  const imageCache = new Map();
  const previewAssetCache = new Map();
  let lastPreviewPoint = { x: 24, y: 24 };

  chrome.storage.local.get("talacherPreviewDelayMs").then((stored) => {
    previewDelayMs = Number.isFinite(stored.talacherPreviewDelayMs) ? stored.talacherPreviewDelayMs : 500;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.talacherPreviewDelayMs) {
      previewDelayMs = Number.isFinite(changes.talacherPreviewDelayMs.newValue)
        ? changes.talacherPreviewDelayMs.newValue
        : 500;
    }
  });

  const preview = document.createElement("div");
  preview.className = "talacher-root talacher-monday-preview";
  preview.hidden = true;
  preview.innerHTML = `
    <div class="talacher-preview-frame">
      <img alt="" data-talacher-monday-preview-image>
    </div>
    <p class="talacher-preview-caption" data-talacher-monday-preview-caption></p>
  `;
  const previewImage = preview.querySelector("[data-talacher-monday-preview-image]");
  const previewCaption = preview.querySelector("[data-talacher-monday-preview-caption]");

  document.documentElement.append(preview);

  const rowSelector = [
    "[data-pulse-id]",
    "[data-testid*='pulse']",
    "[data-testid*='row']",
    ".pulse-component",
    "[role='row']"
  ].join(",");

  const hidePreview = () => {
    activeHoverToken += 1;
    activeRow = null;
    preview.classList.remove("talacher-monday-preview-visible");
  };

  const positionPreview = (point = lastPreviewPoint) => {
    lastPreviewPoint = point;
    const rect = preview.getBoundingClientRect();
    const previewWidth = rect.width || 320;
    const previewHeight = rect.height || 520;
    let left = point.x + 14;
    let top = point.y + 14;

    if (left + previewWidth > window.innerWidth - 12) {
      left = point.x - previewWidth - 14;
    }

    if (top + previewHeight > window.innerHeight - 12) {
      top = point.y - previewHeight - 14;
    }

    preview.style.left = `${Math.max(left, 12)}px`;
    preview.style.top = `${Math.max(top, 12)}px`;
  };

  const renderPreview = (state, imageSize, point) => {
    applyMondayPreviewSize(preview, imageSize);
    previewImage.src = state.imageUrl;
    previewImage.alt = `${state.caption || state.itemName || "monday item"} image preview`;
    previewCaption.textContent = state.caption || state.itemName || "";
    preview.hidden = false;
    positionPreview(point);
    requestAnimationFrame(() => {
      positionPreview(point);
      preview.classList.add("talacher-monday-preview-visible");
    });
  };

  document.addEventListener("mouseover", (event) => {
    const row = event.target.closest(rowSelector);

    if (!row || row === activeRow || row.getAttribute("role") === "columnheader") {
      return;
    }

    if (!isMondayTitleHoverTarget(row, event)) {
      return;
    }

    activeRow = row;
    preview.classList.remove("talacher-monday-preview-visible");
    const hoverToken = activeHoverToken + 1;
    activeHoverToken = hoverToken;
    const startedAt = performance.now();
    const previewPoint = { x: event.clientX, y: event.clientY };
    const itemId = getMondayItemIdFromRow(row);
    const itemName = getMondayItemNameFromRow(row);
    const secondTitle = getMondaySecondTitleFromRow(row);
    const domImageUrl = getMondayImageRefUrlFromRow(row);

    if (!domImageUrl && !itemId && !itemName) {
      return;
    }

    loadMondayPreviewImage({ itemId, itemName, secondTitle, imageUrl: domImageUrl }, imageCache)
      .then(async (state) => {
        const imageSize = state.imageUrl
          ? await preloadMondayPreviewAsset(state.imageUrl, previewAssetCache)
          : null;
        const remainingDelay = Math.max(0, previewDelayMs - (performance.now() - startedAt));

        if (remainingDelay > 0) {
          await wait(remainingDelay);
        }

        if (activeHoverToken !== hoverToken || activeRow !== row || !state.imageUrl || !document.documentElement.contains(row)) {
          return;
        }

        renderPreview(state, imageSize, previewPoint);
      })
      .catch(() => {});
  }, true);

  document.addEventListener("mouseout", (event) => {
    if (!activeRow) {
      return;
    }

    const nextTarget = event.relatedTarget;

    if (nextTarget && activeRow.contains(nextTarget)) {
      return;
    }

    hidePreview();
  }, true);

  window.addEventListener("scroll", hidePreview, true);
  window.addEventListener("resize", hidePreview);
}

function getMondayItemIdFromRow(row) {
  const directId = row.getAttribute("data-pulse-id") || row.dataset?.pulseId;

  if (directId) {
    return directId;
  }

  const childWithId = row.querySelector("[data-pulse-id], [data-item-id], [data-pulseid]");

  if (childWithId) {
    return childWithId.getAttribute("data-pulse-id") ||
      childWithId.getAttribute("data-item-id") ||
      childWithId.getAttribute("data-pulseid") ||
      childWithId.dataset?.pulseId ||
      "";
  }

  const candidate = Array.from(row.querySelectorAll("*"))
    .flatMap((element) => Array.from(element.attributes || []))
    .find((attribute) => /(?:pulse|item).*id/i.test(attribute.name) && /^\d{6,}$/.test(attribute.value));

  return candidate?.value || "";
}

function isMondayTitleHoverTarget(row, event) {
  const rowRect = row.getBoundingClientRect();
  const x = event.clientX - rowRect.left;

  return x >= 36 && x <= 430;
}

function getMondayItemNameFromRow(row) {
  const rowRect = row.getBoundingClientRect();
  const ignored = new Set([
    "Not Categorized",
    "Pending",
    "Ready To Start",
    "In Progress",
    "Done",
    "Stuck",
    "Add first title"
  ]);
  const candidates = Array.from(row.querySelectorAll("span, div, a"))
    .map((element) => {
      const text = (element.innerText || element.textContent || "").trim();
      const rect = element.getBoundingClientRect();
      return { element, text, rect };
    })
    .filter(({ text, rect }) => (
      text &&
      text.length > 1 &&
      text.length <= 80 &&
      !ignored.has(text) &&
      !text.includes("https://") &&
      rect.width > 10 &&
      rect.height > 8 &&
      rect.left >= rowRect.left + 28 &&
      rect.left <= rowRect.left + 280 &&
      rect.top >= rowRect.top - 2 &&
      rect.bottom <= rowRect.bottom + 2
    ))
    .filter(({ element, text }) => !Array.from(element.children || []).some((child) => {
      const childText = (child.innerText || child.textContent || "").trim();
      return childText === text;
    }))
    .sort((a, b) => a.rect.left - b.rect.left || b.rect.width - a.rect.width);

  return candidates[0]?.text || "";
}

function getMondaySecondTitleFromRow(row) {
  const rowRect = row.getBoundingClientRect();
  const itemName = getMondayItemNameFromRow(row);
  const ignored = new Set([
    itemName,
    "Not Categorized",
    "Pending",
    "Ready To Start",
    "In Progress",
    "Done",
    "Stuck",
    "Add first title"
  ]);
  const gridCells = Array.from(row.querySelectorAll("[role='gridcell'], [data-testid*='cell'], .cell-component"))
    .map((cell) => ({
      cell,
      text: normalizeMondayCellText(cell),
      rect: cell.getBoundingClientRect()
    }))
    .filter(({ text, rect }) => (
      text &&
      !ignored.has(text) &&
      !text.includes("https://") &&
      rect.width > 30 &&
      rect.left >= rowRect.left + 220 &&
      rect.left <= rowRect.left + 620 &&
      rect.top >= rowRect.top - 2 &&
      rect.bottom <= rowRect.bottom + 2
    ))
    .sort((a, b) => a.rect.left - b.rect.left);

  if (gridCells[0]?.text) {
    return gridCells[0].text;
  }

  const candidates = Array.from(row.querySelectorAll("span, div, a"))
    .map((element) => {
      const text = (element.innerText || element.textContent || "").trim();
      const rect = element.getBoundingClientRect();
      return { element, text, rect };
    })
    .filter(({ text, rect }) => (
      text &&
      text.length > 1 &&
      text.length <= 100 &&
      !ignored.has(text) &&
      !text.includes("https://") &&
      rect.width > 10 &&
      rect.height > 8 &&
      rect.left >= rowRect.left + 220 &&
      rect.left <= rowRect.left + 620 &&
      rect.top >= rowRect.top - 2 &&
      rect.bottom <= rowRect.bottom + 2
    ))
    .filter(({ element, text }) => !Array.from(element.children || []).some((child) => {
      const childText = (child.innerText || child.textContent || "").trim();
      return childText === text;
    }))
    .sort((a, b) => a.rect.left - b.rect.left || b.rect.width - a.rect.width);

  return candidates[0]?.text || "";
}

function normalizeMondayCellText(cell) {
  const texts = Array.from(cell.querySelectorAll("span, div, a"))
    .map((element) => (element.innerText || element.textContent || "").trim())
    .filter(Boolean)
    .filter((text, index, all) => all.indexOf(text) === index)
    .filter((text) => text.length <= 100 && !text.includes("https://"));

  return texts[0] || (cell.innerText || cell.textContent || "").trim();
}

function getMondayImageRefUrlFromRow(row) {
  const links = Array.from(row.querySelectorAll("a[href], [title], [aria-label]"))
    .map((element) => (
      element.getAttribute("href") ||
      element.getAttribute("title") ||
      element.getAttribute("aria-label") ||
      ""
    ))
    .map(extractFirstUrl)
    .filter(Boolean);

  return links.find((url) => (
    url.includes("monday.com/protected_static") ||
    url.includes("monday.com") ||
    /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.test(url)
  )) || "";
}

function extractFirstUrl(value) {
  const match = String(value).match(/https?:\/\/[^\s"'<>]+/);
  return match?.[0] || "";
}

async function loadMondayPreviewImage(rowRef, cache) {
  const cacheKey = rowRef.itemId || rowRef.imageUrl || `name:${rowRef.itemName}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const previewRequest = resolveMondayPreviewImage(rowRef);
  cache.set(cacheKey, previewRequest);

  try {
    const state = await previewRequest;
    cache.set(cacheKey, state);
    return state;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
}

function preloadMondayPreviewAsset(imageUrl, cache) {
  if (cache.has(imageUrl)) {
    return cache.get(imageUrl);
  }

  const request = new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width || 320,
        height: image.naturalHeight || image.height || 420
      });
    };
    image.onerror = reject;
    image.src = imageUrl;
  });

  cache.set(imageUrl, request);
  return request;
}

function applyMondayPreviewSize(preview, imageSize) {
  const naturalWidth = Math.max(1, imageSize?.width || 320);
  const naturalHeight = Math.max(1, imageSize?.height || 420);
  const ratio = Math.min(Math.max(naturalWidth / naturalHeight, 0.22), 4.5);
  const viewportWidth = Math.max(280, window.innerWidth);
  const viewportHeight = Math.max(280, window.innerHeight);
  const maxFrameWidth = Math.min(420, viewportWidth - 32);
  const maxFrameHeight = Math.min(640, viewportHeight - 96);
  let frameWidth = maxFrameWidth;
  let frameHeight = frameWidth / ratio;

  if (frameHeight > maxFrameHeight) {
    frameHeight = maxFrameHeight;
    frameWidth = frameHeight * ratio;
  }

  const minFrameWidth = Math.min(maxFrameWidth, 220);
  const minFrameHeight = Math.min(maxFrameHeight, 180);

  if (frameWidth < minFrameWidth) {
    frameWidth = minFrameWidth;
    frameHeight = Math.min(maxFrameHeight, frameWidth / ratio);
  }

  if (frameHeight < minFrameHeight) {
    frameHeight = minFrameHeight;
    frameWidth = Math.min(maxFrameWidth, frameHeight * ratio);
  }

  preview.style.setProperty("--talacher-preview-width", `${Math.round(frameWidth + 16)}px`);
  preview.style.setProperty("--talacher-preview-frame-height", `${Math.round(frameHeight)}px`);
}

async function resolveMondayPreviewImage(rowRef) {
  if (rowRef.imageUrl) {
    return {
      imageUrl: rowRef.imageUrl,
      itemName: rowRef.itemName,
      secondTitle: rowRef.secondTitle,
      caption: formatMondayPreviewCaption(rowRef.itemName, rowRef.secondTitle)
    };
  }

  const result = await sendTalacherMessage({
    type: "TALACHER_GET_MONDAY_ITEM_IMAGE",
    itemId: rowRef.itemId,
    itemName: rowRef.itemName
  });
  const state = result.imageUrl
    ? {
      imageUrl: result.imageUrl,
      itemName: result.itemName,
      secondTitle: rowRef.secondTitle,
      caption: formatMondayPreviewCaption(result.itemName, rowRef.secondTitle)
    }
    : {
      itemName: result.itemName,
      secondTitle: rowRef.secondTitle,
      caption: ""
    };
  return state;
}

function formatMondayPreviewCaption(itemName, secondTitle) {
  return [itemName, secondTitle]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");
}
