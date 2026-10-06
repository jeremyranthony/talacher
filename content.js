function initializeMiroTestAction() {
  let lastPointer = { x: 24, y: 96, time: Date.now() };
  let selectedImage = null;
  let syncTimer = null;

  const dialog = createMiroSendDialog(() => selectedImage);
  const fallback = createMiroFallbackAction(dialog.open);
  const menuAction = createMiroMenuAction(() => dialog.open({ preferClipboard: true }));
  const toolbarAction = createMiroToolbarAction(dialog.open);
  document.documentElement.append(dialog.element);
  document.documentElement.append(dialog.queueElement);
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

const TALACHER_FALLBACK_LABELS = {
  priority: ["Critical", "High", "Medium", "Low"],
  rarity: ["Pending", "Bronze", "Ruby", "Silver", "Unset", "Gold", "Amethyst", "Diamond"],
  assetType: [
    "Not Categorized", "Gloves", "Visor", "2D Shirt", "VFX", "Head Accessory", "3D Model", "Football",
    "Face Accessory", "2D Pants", "Emoji", "Face Mask", "LC Shirt", "Cleat", "Sleeve", "End Zone", "Costume",
    "Socks", "LC Pants", "Hat Accessory", "Arm Accessory", "Head", "Front Accessory", "Trail", "Backplate",
    "Hair", "Vest", "Waist Accessory", "Neck Accessory", "Helmet", "Back Accessory", "Wrist Accessory",
    "Animation", "Trade Booth"
  ]
};
const TALACHER_LABEL_DEFAULTS = { priority: "", rarity: "Pending", assetType: "Not Categorized" };

function createMiroSendDialog(getPointerSelection) {
  const dialog = document.createElement("div");
  const toast = document.createElement("div");
  let toastTimer = null;
  let activeSelection = null;
  let miroSnapshot = null;
  let captureToken = 0;
  let imageAttempt = 0;
  let isCapturing = false;
  let previewCache = new Map();

  dialog.className = "talacher-root talacher-dialog-shell";
  dialog.hidden = true;
  toast.className = "talacher-root talacher-toast";
  toast.hidden = true;
  dialog.innerHTML = `
    <div class="talacher-dialog-backdrop" data-talacher-close></div>
    <section class="talacher-send-dialog" role="dialog" aria-modal="true" aria-labelledby="talacher-send-title">
      <header class="talacher-dialog-header">
        <div>
          <h2 id="talacher-send-title">Send to monday board</h2>
          <p class="talacher-dialog-summary" data-talacher-summary></p>
        </div>
        <button class="talacher-icon-button" type="button" aria-label="Close" data-talacher-close>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </header>
      <form class="talacher-send-form" novalidate>
        <div class="talacher-send-layout">
          <section class="talacher-art" data-talacher-preview aria-label="Image to upload">
            <div class="talacher-image-preview-frame">
              <img alt="" data-talacher-preview-image>
              <div class="talacher-art-status" data-talacher-art-status hidden>
                <span class="talacher-spinner" aria-hidden="true"></span>
                <span data-talacher-art-status-label></span>
              </div>
            </div>
            <div class="talacher-art-strip" data-talacher-art-strip role="radiogroup" aria-label="Choose the image to upload" hidden></div>
            <p class="talacher-art-caption">
              <span data-talacher-preview-caption></span>
              <button type="button" class="talacher-link-button" data-talacher-recapture hidden>Read selection again</button>
            </p>
          </section>
          <div class="talacher-form-fields" data-talacher-fields>
            <div data-talacher-slot="groupId"></div>
            <div class="talacher-form-grid">
              <label class="talacher-field">
                <span class="talacher-field-label">First title</span>
                <input name="firstTitle" type="text" autocomplete="off" required>
              </label>
              <label class="talacher-field">
                <span class="talacher-field-label">Second title</span>
                <input name="secondTitle" type="text" autocomplete="off">
              </label>
            </div>
            <input name="status" type="hidden" value="Ready To Start">
            <div class="talacher-form-grid talacher-form-grid-3">
              <div data-talacher-slot="priority"></div>
              <div data-talacher-slot="rarity"></div>
              <div data-talacher-slot="assetType"></div>
            </div>
            <p class="talacher-label-sync" data-talacher-label-sync role="status"></p>
            <fieldset class="talacher-notes" data-talacher-notes hidden>
              <legend class="talacher-field-label">Write the titles on</legend>
              <div class="talacher-note-list" data-talacher-note-list></div>
            </fieldset>
            <label class="talacher-check" data-talacher-group-option hidden>
              <input type="checkbox" name="groupOnBoard">
              <span>
                <strong>Group the selection on Miro after sending</strong>
                <small data-talacher-group-hint></small>
              </span>
            </label>
          </div>
        </div>
        <div class="talacher-progress" data-talacher-progress hidden role="status">
          <div class="talacher-progress-track" aria-hidden="true">
            <span data-talacher-progress-bar></span>
          </div>
          <p data-talacher-progress-label></p>
        </div>
        <footer class="talacher-dialog-actions">
          <span class="talacher-shortcut-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to send</span>
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
  const secondTitle = form.elements.secondTitle;
  const submitButton = form.querySelector("button[type='submit']");
  const summary = dialog.querySelector("[data-talacher-summary]");
  const preview = dialog.querySelector("[data-talacher-preview]");
  const previewImage = dialog.querySelector("[data-talacher-preview-image]");
  const previewCaption = dialog.querySelector("[data-talacher-preview-caption]");
  const artStatus = dialog.querySelector("[data-talacher-art-status]");
  const artStatusLabel = dialog.querySelector("[data-talacher-art-status-label]");
  const artStrip = dialog.querySelector("[data-talacher-art-strip]");
  const recaptureButton = dialog.querySelector("[data-talacher-recapture]");
  const labelSyncStatus = dialog.querySelector("[data-talacher-label-sync]");
  const notesFieldset = dialog.querySelector("[data-talacher-notes]");
  const noteList = dialog.querySelector("[data-talacher-note-list]");
  const groupOption = dialog.querySelector("[data-talacher-group-option]");
  const groupHint = dialog.querySelector("[data-talacher-group-hint]");
  const pickers = {
    groupId: createTalacherPicker({ name: "groupId", label: "Group", layer: dialog, placeholder: "Choose a group" }),
    priority: createTalacherPicker({ name: "priority", label: "Priority", layer: dialog, placeholder: "No priority", emptyLabel: "No priority" }),
    rarity: createTalacherPicker({ name: "rarity", label: "Rarity", layer: dialog }),
    assetType: createTalacherPicker({ name: "assetType", label: "Asset type", layer: dialog })
  };
  let submitWithShift = false;
  let closeTimer = null;

  for (const [key, picker] of Object.entries(pickers)) {
    dialog.querySelector(`[data-talacher-slot="${key}"]`).replaceWith(picker.element);
  }

  for (const key of ["priority", "rarity", "assetType"]) {
    pickers[key].setOptions(TALACHER_FALLBACK_LABELS[key].map((label) => ({ value: label, label })), {
      defaultValue: TALACHER_LABEL_DEFAULTS[key]
    });
  }

  pickers.groupId.setOptions([{ value: "group_mm60k55f", label: "CH3 S1 OG Season" }], { defaultValue: "group_mm60k55f" });
  chrome.storage.local.get("talacherGroupOnBoard")
    .then(({ talacherGroupOnBoard }) => {
      form.elements.groupOnBoard.checked = Boolean(talacherGroupOnBoard);
      form.elements.groupOnBoard.defaultChecked = Boolean(talacherGroupOnBoard);
    })
    .catch(() => {});

  const show = () => {
    clearTimeout(closeTimer);
    dialog.classList.remove("talacher-dialog-closing");
    dialog.hidden = false;
  };

  const close = () => {
    Object.values(pickers).forEach((picker) => picker.close());
    captureToken += 1;

    if (dialog.hidden) {
      resetProgress();
      return;
    }

    clearTimeout(closeTimer);
    dialog.classList.add("talacher-dialog-closing");
    closeTimer = setTimeout(() => {
      dialog.hidden = true;
      dialog.classList.remove("talacher-dialog-closing");
      resetProgress();
    }, prefersReducedMotion() ? 0 : 150);
  };

  const showToast = (message, tone = "success") => {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.remove("talacher-toast-leaving");
    toast.classList.toggle("talacher-toast-neutral", tone === "neutral");
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.classList.add("talacher-toast-leaving");
      toastTimer = setTimeout(() => {
        toast.hidden = true;
        toast.classList.remove("talacher-toast-leaving");
      }, prefersReducedMotion() ? 0 : 180);
    }, 3200);
  };
  const uploadQueue = createMiroUploadQueue(showToast);

  const saveReadyTag = async (options = {}) => {
    setProgress("Saving ready tag...", 28, true);
    show();

    let tagSelection = null;

    if (!options.preferCurrentSelection) {
      tagSelection = await captureMiroSelectionViaClipboard();
    }

    tagSelection = tagSelection || await captureFirstSelectedMiroImage() || activeSelection || getPointerSelection();
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

  const open = (options = {}) => {
    resetProgress();
    show();
    loadMondayGroups(pickers.groupId);
    loadMondayColumnLabels(pickers, labelSyncStatus);
    setTimeout(() => firstTitle.focus(), 0);
    readMiroSelection(options);
  };

  async function readMiroSelection(options = {}) {
    const token = ++captureToken;
    activeSelection = null;
    miroSnapshot = null;
    previewCache = new Map();
    artStrip.hidden = true;
    artStrip.replaceChildren();
    renderNotes(null);
    renderGroupOption(null);
    renderArt(null);
    setCapturing(true, "Reading your Miro selection...");
    summary.textContent = "Reading your Miro selection...";

    try {
      miroSnapshot = await callMiroBridge("TALACHER_MIRO_GET_SELECTION", {}, 3000);
    } catch {
      miroSnapshot = null;
    }

    if (token !== captureToken) {
      return;
    }

    if (miroSnapshot) {
      summary.textContent = describeMiroSnapshot(miroSnapshot);
      renderNotes(miroSnapshot.notes);
      renderGroupOption(miroSnapshot);

      if (miroSnapshot.images.length) {
        renderArtStrip(miroSnapshot.images, token);
        await selectMiroImage(miroSnapshot.images[0], token);
        return;
      }
    }

    // No image item through the SDK: fall back to Miro's "Copy as image" (context menu only),
    // then to whatever image element was under the pointer.
    let fallback = null;

    if (options.preferClipboard) {
      setCapturing(true, "Copying the selection as an image...");
      fallback = await captureMiroSelectionViaClipboard();
    }

    if (token !== captureToken) {
      return;
    }

    fallback = fallback || (miroSnapshot ? null : getPointerSelection());

    if (!miroSnapshot) {
      summary.textContent = fallback
        ? "Miro's selection details aren't available, so notes can't be picked."
        : "Couldn't read the Miro selection.";
    }

    activeSelection = fallback;
    renderArt(fallback, fallback ? null : miroSnapshot
      ? "No image in the selection. The row will be created without one."
      : "No image found. Select an image on the board, then read the selection again.");
    setCapturing(false);
  }

  async function selectMiroImage(image, token) {
    for (const option of artStrip.querySelectorAll("[data-item-id]")) {
      option.setAttribute("aria-checked", String(option.dataset.itemId === image.id));
    }

    const attempt = ++imageAttempt;
    activeSelection = null;
    renderArt(null);
    setCapturing(true, "Loading the full-size image...");

    // The small preview arrives fast; show it softened until the original is ready.
    getMiroPreview(image.id).then((previewUrl) => {
      if (previewUrl && token === captureToken && attempt === imageAttempt && !activeSelection) {
        renderArt({ previewUrl }, null, { placeholder: true });
      }
    });

    try {
      const data = await callMiroBridge("TALACHER_MIRO_GET_IMAGE_DATA", { itemId: image.id, format: "original" }, 45000);

      if (token !== captureToken || attempt !== imageAttempt) {
        return;
      }

      activeSelection = {
        previewUrl: data.dataUrl,
        dataUrl: data.dataUrl,
        fileName: data.fileName,
        mimeType: data.mimeType,
        uploadable: true,
        source: "miro-web-sdk",
        itemId: image.id
      };
    } catch (error) {
      if (token !== captureToken || attempt !== imageAttempt) {
        return;
      }

      setCapturing(false);
      renderArt(null, `Couldn't load this image from Miro: ${error.message}`);
      return;
    }

    setCapturing(false);
    renderArt(activeSelection);
  }

  function getMiroPreview(itemId) {
    if (!previewCache.has(itemId)) {
      previewCache.set(itemId, callMiroBridge("TALACHER_MIRO_GET_IMAGE_DATA", { itemId, format: "preview" }, 10000)
        .then((data) => data.dataUrl)
        .catch(() => null));
    }

    return previewCache.get(itemId);
  }

  function renderArtStrip(images, token) {
    if (images.length < 2) {
      return;
    }

    artStrip.hidden = false;
    artStrip.replaceChildren(...images.map((image, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "talacher-art-thumb";
      button.dataset.itemId = image.id;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(index === 0));
      button.setAttribute("aria-label", image.title || `Image ${index + 1}`);
      button.title = image.title || `Image ${index + 1}`;
      button.append(Object.assign(document.createElement("img"), { alt: "" }));
      button.addEventListener("click", () => {
        if (button.getAttribute("aria-checked") !== "true" && token === captureToken) {
          selectMiroImage(image, token);
        }
      });
      return button;
    }));

    for (const image of images) {
      getMiroPreview(image.id).then((previewUrl) => {
        const img = artStrip.querySelector(`[data-item-id="${CSS.escape(image.id)}"] img`);

        if (img && previewUrl && token === captureToken) {
          img.src = previewUrl;
        }
      });
    }
  }

  function renderArt(selection, message = null, { placeholder = false } = {}) {
    const previewUrl = selection?.previewUrl || selection?.dataUrl || selection?.sourceUrl;

    preview.classList.toggle("talacher-image-preview-empty", !previewUrl);
    preview.classList.toggle("talacher-art-placeholder", placeholder);
    previewImage.hidden = !previewUrl;

    if (previewUrl) {
      previewImage.src = previewUrl;
    } else {
      previewImage.removeAttribute("src");
    }

    recaptureButton.hidden = Boolean(selection?.uploadable) || placeholder;

    if (placeholder) {
      previewCaption.textContent = "";
    } else if (message) {
      previewCaption.textContent = message;
    } else if (!selection) {
      previewCaption.textContent = "No image selected.";
    } else if (selection.uploadable) {
      previewCaption.textContent = `${selection.fileName} will be uploaded to the row.`;
    } else {
      previewCaption.textContent = selection.reason || "Preview found, but Chrome could not read an uploadable file.";
    }
  }

  function setCapturing(capturing, label = "") {
    isCapturing = capturing;
    artStatus.hidden = !capturing;
    artStatusLabel.textContent = label;
    preview.classList.toggle("talacher-art-loading", capturing);

    if (capturing) {
      previewCaption.textContent = "";
      recaptureButton.hidden = true;
    }

    submitButton.disabled = capturing;
    submitButton.textContent = capturing ? "Loading image..." : "Create monday row";
  }

  function renderNotes(notes) {
    noteList.replaceChildren();
    notesFieldset.hidden = !notes?.length;

    if (!notes?.length) {
      return;
    }

    const choices = [...notes, { id: "", text: "Don't write on a note", isNone: true }];

    for (const [index, note] of choices.entries()) {
      const card = document.createElement("label");
      card.className = `talacher-note-card${note.isNone ? " talacher-note-card-none" : ""}`;

      if (!note.isNone) {
        card.style.setProperty("--note", miroNoteColor(note));
      }

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "miroNoteId";
      radio.value = note.id;
      radio.checked = index === 0;
      radio.defaultChecked = index === 0;

      const text = document.createElement("span");
      text.className = "talacher-note-text";

      if (note.isNone || !note.text) {
        text.textContent = note.isNone ? note.text : "Empty note";
      } else {
        const [firstLine, ...otherLines] = note.text.split("\n");
        text.append(Object.assign(document.createElement("strong"), { textContent: firstLine }));

        if (otherLines.length) {
          text.append(` ${otherLines.join(" ")}`);
        }

        card.title = note.text;
      }
      card.append(radio, Object.assign(document.createElement("span"), { className: "talacher-note-swatch" }), text);

      if (!note.isNone && note.text) {
        const useText = document.createElement("button");
        useText.type = "button";
        useText.className = "talacher-link-button";
        useText.textContent = "Use as titles";
        useText.title = "Fill First title and Second title from this note";
        useText.addEventListener("click", () => {
          const [first, ...rest] = note.text.split("\n").map((line) => line.trim()).filter(Boolean);
          firstTitle.value = first || "";
          secondTitle.value = rest.join(" ");
          radio.checked = true;
          firstTitle.focus();
        });
        card.append(useText);
      }

      noteList.append(card);
    }
  }

  function renderGroupOption(snapshot) {
    const canGroup = snapshot && snapshot.itemIds.length > 1 && !snapshot.partlyGrouped;
    groupOption.hidden = !snapshot || snapshot.itemIds.length < 2;
    form.elements.groupOnBoard.disabled = !canGroup;
    groupHint.textContent = !snapshot
      ? ""
      : snapshot.alreadyGrouped
        ? "These items are already grouped."
        : snapshot.partlyGrouped
          ? "Some of these items are already in another group, so Miro can't group them."
          : `Groups the ${snapshot.itemIds.length} selected items once the row is created.`;
  }

  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-talacher-close]") || event.target.closest("[data-talacher-cancel]")) {
      event.preventDefault();
      close();
    }
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitWithShift = event.shiftKey;
      form.requestSubmit();
    }
  });

  recaptureButton.addEventListener("click", () => readMiroSelection());
  form.elements.groupOnBoard.addEventListener("change", () => {
    chrome.storage.local.set({ talacherGroupOnBoard: form.elements.groupOnBoard.checked }).catch(() => {});
    form.elements.groupOnBoard.defaultChecked = form.elements.groupOnBoard.checked;
  });
  form.addEventListener("reset", () => setTimeout(() => Object.values(pickers).forEach((picker) => picker.refresh()), 0));
  submitButton.addEventListener("click", (event) => {
    submitWithShift = event.shiftKey;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (isCapturing) {
      return;
    }

    if (!firstTitle.value.trim()) {
      firstTitle.focus();
      firstTitle.classList.add("talacher-input-invalid");
      setTimeout(() => firstTitle.classList.remove("talacher-input-invalid"), 600);
      return;
    }

    const { miroNoteId, groupOnBoard, ...payload } = Object.fromEntries(new FormData(form).entries());
    const isDevSuccess = submitWithShift;
    submitWithShift = false;
    const snapshot = miroSnapshot;
    const wantsNote = snapshot ? Boolean(miroNoteId) : true;
    const noteUpdate = wantsNote
      ? updateMiroNote(payload, snapshot ? miroNoteId : null)
        .then((result) => {
          if (!result.ok && isMissingMiroNoteError(result.error)) {
            showToast("No post-it note selected. Select the image and note together if you want Talacher to write the titles.", "neutral");
          }

          return result;
        })
        .catch((error) => ({ ok: false, error: error.message }))
      : Promise.resolve({ ok: false, skipped: true });
    const flightSource = previewImage.hidden ? null : previewImage.getBoundingClientRect();
    const job = uploadQueue.addJob({
      payload,
      selection: activeSelection,
      isDevSuccess,
      noteUpdate,
      groupItemIds: groupOnBoard && snapshot && !form.elements.groupOnBoard.disabled ? snapshot.itemIds : null
    });

    flyPreviewToQueue(previewImage, flightSource, job.element.querySelector("[data-talacher-queue-thumb]"));
    close();
    form.reset();
    uploadQueue.startJob(job);
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

  return {
    element: dialog,
    queueElement: uploadQueue.element,
    toastElement: toast,
    saveReadyTag,
    open,
    close
  };
}

function describeMiroSnapshot(snapshot) {
  const parts = [];
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

  if (snapshot.images.length) {
    parts.push(plural(snapshot.images.length, "image"));
  }

  if (snapshot.notes.length) {
    parts.push(plural(snapshot.notes.length, "note"));
  }

  const others = snapshot.itemIds.length - snapshot.images.length - snapshot.notes.length;

  if (others > 0) {
    parts.push(plural(others, "other item"));
  }

  return parts.length ? `From your Miro selection: ${parts.join(", ")}.` : "Nothing is selected on the Miro board.";
}

const MIRO_STICKY_COLORS = {
  gray: "#e6e6e6",
  light_yellow: "#fff9b1",
  yellow: "#f5d128",
  orange: "#ff9d48",
  light_green: "#d5f692",
  green: "#c9df56",
  dark_green: "#93d275",
  cyan: "#67c6c0",
  light_pink: "#ffcee0",
  pink: "#ea94bb",
  violet: "#c6a2d2",
  red: "#f0939d",
  light_blue: "#a6ccf5",
  blue: "#6cd8fa",
  dark_blue: "#9ea9ff",
  black: "#000000",
  white: "#ffffff"
};

function miroNoteColor(note) {
  if (/^#[0-9a-f]{3,8}$/i.test(note.color || "")) {
    return note.color;
  }

  return MIRO_STICKY_COLORS[note.color] || (note.type === "sticky_note" ? MIRO_STICKY_COLORS.light_yellow : "#ffffff");
}

// Talks to miro-page-bridge.js, which runs in Miro's page and can use the Web SDK.
function callMiroBridge(type, payload = {}, timeoutMs = 3000) {
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `talacher-${type}-${Date.now()}-${Math.random()}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Miro didn't respond in time."));
    }, timeoutMs);

    function onMessage(event) {
      if (event.source !== window || event.data?.type !== `${type}_RESULT` || event.data.requestId !== requestId) {
        return;
      }

      cleanup();

      if (event.data.ok) {
        resolve(event.data.result);
      } else {
        reject(new Error(event.data.error || "Miro request failed."));
      }
    }

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ type, requestId, payload }, window.location.origin);
  });
}

async function captureFirstSelectedMiroImage() {
  try {
    const snapshot = await callMiroBridge("TALACHER_MIRO_GET_SELECTION", {}, 3000);
    const image = snapshot.images[0];

    if (!image) {
      return null;
    }

    const data = await callMiroBridge("TALACHER_MIRO_GET_IMAGE_DATA", { itemId: image.id, format: "original" }, 45000);
    return { ...data, previewUrl: data.dataUrl, uploadable: true, source: "miro-web-sdk" };
  } catch {
    return null;
  }
}

function createMiroUploadQueue(showToast) {
  const queue = document.createElement("section");
  const jobs = new Map();
  let isCollapsed = false;

  queue.className = "talacher-root talacher-upload-queue";
  queue.hidden = true;
  queue.innerHTML = `
    <header class="talacher-queue-header">
      <button class="talacher-queue-toggle" type="button" aria-expanded="true" data-talacher-queue-toggle>
        <span>Talacher queue</span>
        <strong data-talacher-queue-count>0</strong>
      </button>
      <button class="talacher-queue-clear" type="button" data-talacher-queue-clear>Clear done</button>
    </header>
    <div class="talacher-queue-body" data-talacher-queue-body>
      <div class="talacher-queue-list" data-talacher-queue-list></div>
    </div>
  `;

  const count = queue.querySelector("[data-talacher-queue-count]");
  const list = queue.querySelector("[data-talacher-queue-list]");
  const toggle = queue.querySelector("[data-talacher-queue-toggle]");
  const clearDone = queue.querySelector("[data-talacher-queue-clear]");

  const body = queue.querySelector("[data-talacher-queue-body]");
  let bodyAnimation = null;
  toggle.addEventListener("click", () => {
    isCollapsed = !isCollapsed;
    queue.classList.toggle("talacher-upload-queue-collapsed", isCollapsed);
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    bodyAnimation?.cancel();

    if (prefersReducedMotion() || typeof body.animate !== "function") {
      body.hidden = isCollapsed;
      return;
    }

    body.hidden = false;
    const height = `${body.scrollHeight}px`;
    bodyAnimation = body.animate(
      isCollapsed ? [{ height }, { height: "0px" }] : [{ height: "0px" }, { height }],
      { duration: 220, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }
    );
    bodyAnimation.finished
      .then(() => {
        body.hidden = isCollapsed;
      })
      .catch(() => {});
  });

  clearDone.addEventListener("click", () => {
    for (const job of jobs.values()) {
      if (isTerminalQueueStatus(job.status)) {
        job.element.remove();
        jobs.delete(job.id);
      }
    }

    refreshQueue();
  });

  function addJob({ payload, selection, isDevSuccess, noteUpdate, groupItemIds = null }) {
    const id = crypto.randomUUID ? crypto.randomUUID() : `talacher-job-${Date.now()}-${jobs.size}`;
    const requestId = crypto.randomUUID ? crypto.randomUUID() : `talacher-request-${Date.now()}-${jobs.size}`;
    const previewUrl = selection?.previewUrl || selection?.dataUrl || selection?.sourceUrl || "";
    const title = formatQueueTitle(payload);
    const element = document.createElement("article");

    element.className = "talacher-queue-item talacher-queue-item-queued";
    element.innerHTML = `
      <div class="talacher-queue-thumb" data-talacher-queue-thumb></div>
      <div class="talacher-queue-copy">
        <strong data-talacher-queue-title></strong>
        <p data-talacher-queue-status>Queued</p>
        <div class="talacher-queue-progress" aria-hidden="true">
          <span data-talacher-queue-progress-bar></span>
        </div>
      </div>
      <button class="talacher-queue-cancel" type="button" data-talacher-queue-cancel>Cancel</button>
    `;

    const thumb = element.querySelector("[data-talacher-queue-thumb]");
    const titleNode = element.querySelector("[data-talacher-queue-title]");
    const cancelButton = element.querySelector("[data-talacher-queue-cancel]");

    titleNode.textContent = title;

    if (previewUrl) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = previewUrl;
      thumb.append(image);
    } else {
      thumb.textContent = "No image";
      thumb.classList.add("talacher-queue-thumb-empty");
    }

    const job = {
      id,
      requestId,
      payload: { ...payload },
      selection,
      isDevSuccess,
      noteUpdate,
      noteResult: null,
      groupItemIds,
      cancelled: false,
      status: "queued",
      element,
      statusNode: element.querySelector("[data-talacher-queue-status]"),
      progressBar: element.querySelector("[data-talacher-queue-progress-bar]"),
      cancelButton
    };

    cancelButton.addEventListener("click", () => cancelJob(job));
    job.statusNode.addEventListener("click", () => {
      if (job.status === "error") {
        job.statusNode.classList.toggle("talacher-queue-status-expanded");
      }
    });
    jobs.set(id, job);
    list.prepend(element);
    queue.hidden = false;
    refreshQueue();
    updateJob(job, "queued", "Queued", 6);
    return job;
  }

  function startJob(job) {
    runQueueJob(job);
  }

  async function runQueueJob(job) {
    try {
      updateJob(job, "running", job.selection?.uploadable
        ? "Preparing image upload..."
        : "Creating monday row without an uploadable image...", 18);

      const image = await prepareMiroImageForUpload(job.selection);
      throwIfQueueCancelled(job);
      job.payload.image = image;

      if (job.isDevSuccess) {
        updateJob(job, "running", "Dev success route...", 58, true);
        throwIfQueueCancelled(job);
        const details = await finishOnMiro(job);
        updateJob(job, "done", buildQueueDoneLabel("Dev success", details), 100);
        showToast(buildSuccessToast("Dev success", details));
        return;
      }

      updateJob(job, "running", image?.uploadable
        ? "Creating monday row and uploading image..."
        : "Creating monday row...", 52, true);
      const response = await sendTalacherMessage({
        type: "TALACHER_CREATE_MONDAY_ITEM",
        requestId: job.requestId,
        payload: job.payload
      });
      throwIfQueueCancelled(job);

      updateJob(job, "running", "Finishing on the Miro board...", 86);
      const details = await finishOnMiro(job);
      const baseMessage = response.asset?.url
        ? `Created row and uploaded image: ${response.item.name}`
        : `Created monday row: ${response.item.name}`;

      updateJob(job, "done", buildQueueDoneLabel(response.item.name, details), 100);
      showToast(buildSuccessToast(baseMessage, details));
    } catch (error) {
      if (job.cancelled || error.message === "Cancelled.") {
        updateJob(job, "cancelled", "Cancelled. A row may exist if monday already created it.", 100);
        showToast("Cancelled monday send. A row may exist if monday already created it.", "neutral");
        return;
      }

      updateJob(job, "error", error.message || "Upload failed.", 100);
    }
  }

  async function finishOnMiro(job) {
    const readyTagCopied = await copyReadyTagToClipboard().catch(() => false);
    const noteResult = await resolveQueueNoteUpdate(job);
    const groupResult = job.groupItemIds
      ? await callMiroBridge("TALACHER_MIRO_GROUP_ITEMS", { itemIds: job.groupItemIds }, 6000)
        .then((result) => ({ ok: result.grouped, ...result }))
        .catch((error) => ({ ok: false, error: error.message }))
      : null;

    return { readyTagCopied, noteResult, groupResult };
  }

  async function resolveQueueNoteUpdate(job) {
    if (job.noteResult) {
      return job.noteResult;
    }

    job.noteResult = job.noteUpdate
      ? await job.noteUpdate
      : { ok: false, error: "Miro note update was not started." };
    return job.noteResult;
  }

  function cancelJob(job) {
    if (isTerminalQueueStatus(job.status)) {
      return;
    }

    job.cancelled = true;
    updateJob(job, "cancelling", "Cancelling...", 82, true);

    sendTalacherMessage({
      type: "TALACHER_CANCEL_REQUEST",
      requestId: job.requestId
    }).catch(() => {});
  }

  function updateJob(job, status, label, percent, indeterminate = false) {
    job.status = status;
    job.element.className = `talacher-queue-item talacher-queue-item-${status}`;
    job.element.classList.toggle("talacher-queue-item-indeterminate", indeterminate);
    job.statusNode.textContent = label;
    job.statusNode.title = status === "error" ? `${label}\n\nClick to expand.` : "";
    job.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    job.cancelButton.disabled = isTerminalQueueStatus(status) || status === "cancelling";
    job.cancelButton.hidden = isTerminalQueueStatus(status);
    refreshQueue();
  }

  function refreshQueue() {
    const jobList = Array.from(jobs.values());
    const runningCount = jobList.filter((job) => !isTerminalQueueStatus(job.status)).length;
    count.textContent = runningCount ? `${runningCount}/${jobList.length}` : String(jobList.length);
    clearDone.disabled = !jobList.some((job) => isTerminalQueueStatus(job.status));
    queue.hidden = jobList.length === 0;
    requestAnimationFrame(() => {
      const maxHeight = parseFloat(getComputedStyle(list).maxHeight) || Infinity;
      const contentHeight = [...list.children].reduce((total, item) => total + item.getBoundingClientRect().height, 0);
      list.classList.toggle("talacher-queue-list-scrollable", contentHeight > maxHeight + 1);
    });
  }

  return {
    element: queue,
    addJob,
    startJob
  };
}

function formatQueueTitle(payload) {
  return [payload.firstTitle, payload.secondTitle]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ") || "Untitled item";
}

function buildQueueDoneLabel(itemName, { readyTagCopied, noteResult, groupResult }) {
  const details = [];

  if (readyTagCopied) {
    details.push("ready tag copied");
  }

  if (noteResult?.ok) {
    details.push("note updated");
  }

  if (groupResult?.ok) {
    details.push("grouped on board");
  }

  return details.length ? `Done: ${itemName} (${details.join(", ")})` : `Done: ${itemName}`;
}

function isTerminalQueueStatus(status) {
  return status === "done" || status === "error" || status === "cancelled";
}

function throwIfQueueCancelled(job) {
  if (job.cancelled) {
    throw new Error("Cancelled.");
  }
}

function isMissingMiroNoteError(error) {
  return /no selected miro sticky note|no selected.*text item/i.test(String(error || ""));
}

function buildSuccessToast(baseMessage, { readyTagCopied, noteResult, groupResult }) {
  const parts = [baseMessage];

  if (readyTagCopied) {
    parts.push("Ready tag copied.");
  }

  if (noteResult?.ok) {
    parts.push("Miro note updated.");
  } else if (noteResult?.error && !noteResult.skipped) {
    parts.push(`Miro note not updated: ${noteResult.error}`);
  }

  if (groupResult?.ok) {
    parts.push("Grouped on the board.");
  } else if (groupResult?.error) {
    parts.push(`Not grouped: ${groupResult.error}`);
  }

  return parts
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(" ");
}

function updateMiroNote(payload, itemId = null) {
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

  // Without an itemId the bridge falls back to the first selected note.
  return callMiroBridge("TALACHER_MIRO_UPDATE_NOTE", { itemId, contentHtml }, 4000)
    .then((result) => ({ ok: true, ...result }))
    .catch((error) => ({ ok: false, error: error.message }));
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

    // clipboard.read() can hang (e.g. waiting on a permission prompt), so cap it.
    const items = await Promise.race([
      navigator.clipboard.read(),
      wait(4000).then(() => {
        throw new Error("Timed out reading the clipboard.");
      })
    ]);

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
    // Miro draws the whole board into one big canvas; that is never "the selected image".
    const rect = node.getBoundingClientRect();

    if (rect.width * rect.height > window.innerWidth * window.innerHeight * 0.25) {
      return null;
    }

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

async function loadMondayGroups(picker) {
  try {
    const { groups, groupId } = await sendTalacherMessage({ type: "TALACHER_GET_GROUPS" });

    if (groups?.length) {
      picker.setOptions(groups.map((group) => ({ value: group.id, label: group.title, color: group.color })), {
        defaultValue: groupId
      });
      picker.setValue(groupId);
    }
  } catch {
    // Keep the current group list.
  }
}

async function loadMondayColumnLabels(pickers, status) {
  status.classList.remove("talacher-label-sync-error");
  status.textContent = "Loading options from the monday board...";

  try {
    const columns = await sendTalacherMessage({ type: "TALACHER_GET_COLUMN_LABELS" });
    const keys = ["priority", "assetType", "rarity"].filter((key) => columns?.[key]?.labels?.length);

    if (!keys.length) {
      throw new Error("The board returned no labels for Priority, Asset Type or Rarity.");
    }

    // Same order and colors as the label picker on the monday board.
    for (const key of keys) {
      pickers[key].setOptions(columns[key].labels.map((label) => ({
        value: label.label,
        label: label.label,
        color: label.color
      })), { defaultValue: TALACHER_LABEL_DEFAULTS[key] });
    }

    status.textContent = "";
  } catch (error) {
    // Keep the built-in options, but say so: a stale list is what causes "label has been deactivated".
    status.classList.add("talacher-label-sync-error");
    status.textContent = /context invalidated/i.test(error.message)
      ? "Talacher was updated. Refresh this Miro tab to load the board's current options."
      : `Couldn't load the board's current options, so this list may be out of date. ${error.message}`;
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function flyPreviewToQueue(sourceImage, from, targetThumb) {
  const targetImage = targetThumb?.querySelector("img");
  const queuePanel = targetThumb?.closest(".talacher-upload-queue");

  if (!from?.width || !targetImage || !queuePanel || queuePanel.classList.contains("talacher-upload-queue-collapsed")
    || prefersReducedMotion() || typeof Element.prototype.animate !== "function") {
    return;
  }

  // Settle the panel's own entrance first so the landing spot doesn't move mid-flight.
  queuePanel.getAnimations().forEach((animation) => animation.finish());
  const to = targetThumb.getBoundingClientRect();
  const ghost = document.createElement("img");
  ghost.className = "talacher-root talacher-send-ghost";
  ghost.alt = "";
  ghost.src = sourceImage.currentSrc || sourceImage.src;
  Object.assign(ghost.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`
  });
  targetThumb.classList.add("talacher-queue-thumb-awaiting");
  document.documentElement.append(ghost);

  let landed = false;
  const land = () => {
    if (landed) {
      return;
    }

    landed = true;
    ghost.remove();
    targetThumb.classList.remove("talacher-queue-thumb-awaiting");
    targetThumb.classList.add("talacher-queue-thumb-landed");
  };

  // Never leave the ghost on screen, even if the animation is throttled or never finishes.
  setTimeout(land, 900);
  ghost.animate([
    { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: "6px", opacity: 1 },
    { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: "6px", opacity: 0.85 }
  ], {
    duration: 520,
    easing: "cubic-bezier(0.5, 0, 0.2, 1)",
    fill: "forwards"
  }).finished.then(land, land);
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
  let previewImageMode = "legacy";
  let immediateStatusPreview = true;
  const imageCache = new Map();
  const previewAssetCache = new Map();
  let lastPreviewPoint = { x: 24, y: 24 };

  chrome.storage.local.get([
    "talacherPreviewDelayMs",
    "talacherPreviewImageMode",
    "talacherImmediateStatusPreview"
  ]).then((stored) => {
    previewDelayMs = Number.isFinite(stored.talacherPreviewDelayMs) ? stored.talacherPreviewDelayMs : 500;
    previewImageMode = stored.talacherPreviewImageMode === "monday-fetch" ? "monday-fetch" : "legacy";
    immediateStatusPreview = stored.talacherImmediateStatusPreview !== false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.talacherPreviewDelayMs) {
      previewDelayMs = Number.isFinite(changes.talacherPreviewDelayMs.newValue)
        ? changes.talacherPreviewDelayMs.newValue
        : 500;
    }

    if (areaName === "local" && changes.talacherPreviewImageMode) {
      previewImageMode = changes.talacherPreviewImageMode.newValue === "monday-fetch" ? "monday-fetch" : "legacy";
      imageCache.clear();
      previewAssetCache.clear();
    }

    if (areaName === "local" && changes.talacherImmediateStatusPreview) {
      immediateStatusPreview = changes.talacherImmediateStatusPreview.newValue !== false;
    }
  });

  const preview = document.createElement("div");
  preview.className = "talacher-root talacher-monday-preview";
  preview.hidden = true;
  preview.innerHTML = `
    <div class="talacher-preview-loading-panel" data-talacher-monday-preview-loading="true">
      <strong>Loading preview</strong>
      <span data-talacher-monday-preview-loading-status="true">Checking image source...</span>
      <div class="talacher-preview-loading-bar" aria-hidden="true"></div>
    </div>
    <div class="talacher-preview-frame">
      <img alt="" data-talacher-monday-preview-image="true" />
    </div>
    <p class="talacher-preview-caption" data-talacher-monday-preview-caption="true"></p>
  `;
  const previewLoading = preview.querySelector("[data-talacher-monday-preview-loading]");
  const previewLoadingStatus = preview.querySelector("[data-talacher-monday-preview-loading-status]");
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
    preview.classList.remove("talacher-monday-preview-loading");
    previewLoading.hidden = true;
    previewImage.hidden = false;
    previewImage.src = state.imageUrl;
    previewImage.alt = `${state.caption || state.itemName || "monday item"} image preview`;
    previewCaption.textContent = state.caption || state.itemName || "";
    previewCaption.hidden = false;
    preview.hidden = false;
    positionPreview(point);
    requestAnimationFrame(() => {
      positionPreview(point);
      preview.classList.add("talacher-monday-preview-visible");
    });
  };

  const renderLoadingPreview = (point) => {
    preview.style.setProperty("--talacher-preview-width", "260px");
    preview.style.removeProperty("--talacher-preview-frame-height");
    previewImage.removeAttribute("src");
    previewImage.hidden = true;
    previewCaption.hidden = true;
    previewLoading.hidden = false;
    previewLoadingStatus.textContent = previewImageMode === "monday-fetch"
      ? "Fetching latest monday update..."
      : "Loading ImageRef Link preview...";
    preview.classList.add("talacher-monday-preview-loading");
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
    const cacheKey = getMondayPreviewCacheKey({
      itemId,
      itemName,
      imageUrl: domImageUrl,
      imageMode: previewImageMode
    });
    const cachedPreviewState = imageCache.get(cacheKey);
    const cachedPreviewUrl = cachedPreviewState && typeof cachedPreviewState.then !== "function"
      ? cachedPreviewState.imageUrl
      : "";
    const cachedAssetUrl = cachedPreviewUrl || domImageUrl;
    const hasDecodedPreviewAsset = Boolean(cachedAssetUrl && previewAssetCache.has(cachedAssetUrl));
    const shouldShowLoadingPreview = immediateStatusPreview &&
      !hasDecodedPreviewAsset;

    if (!domImageUrl && !itemId && !itemName) {
      return;
    }

    if (shouldShowLoadingPreview) {
      renderLoadingPreview(previewPoint);
    }

    loadMondayPreviewImage({
      itemId,
      itemName,
      secondTitle,
      imageUrl: domImageUrl,
      imageMode: previewImageMode
    }, imageCache)
      .then(async (state) => {
        const previewAsset = state.imageUrl
          ? await resolveMondayPreviewAsset(state, previewAssetCache)
          : { state, imageSize: null };
        const remainingDelay = Math.max(0, previewDelayMs - (performance.now() - startedAt));

        if (remainingDelay > 0) {
          await wait(remainingDelay);
        }

        if (activeHoverToken !== hoverToken || activeRow !== row || !document.documentElement.contains(row)) {
          return;
        }

        if (!previewAsset.state.imageUrl) {
          hidePreview();
          return;
        }

        renderPreview(previewAsset.state, previewAsset.imageSize, previewPoint);
      })
      .catch(() => {
        if (activeHoverToken === hoverToken && activeRow === row) {
          hidePreview();
        }
      });
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
  const cacheKey = getMondayPreviewCacheKey(rowRef);

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

function getMondayPreviewCacheKey(rowRef) {
  return `${rowRef.imageMode || "legacy"}:${rowRef.itemId || rowRef.imageUrl || `name:${rowRef.itemName}`}`;
}

async function resolveMondayPreviewAsset(state, cache) {
  const patchedUrl = getRegularMondayResourceUrl(state.imageUrl);

  if (patchedUrl && patchedUrl !== state.imageUrl) {
    try {
      const imageSize = await preloadMondayPreviewAsset(patchedUrl, cache);
      return {
        state: {
          ...state,
          imageUrl: patchedUrl,
          fallbackImageUrl: state.imageUrl
        },
        imageSize
      };
    } catch {
      // Fall back to the URL stored in monday if the regular resource URL is unavailable.
    }
  }

  return {
    state,
    imageSize: await preloadMondayPreviewAsset(state.imageUrl, cache)
  };
}

function getRegularMondayResourceUrl(url) {
  if (!url || !/\/resources\/[^/]+\/thumb_small-/i.test(url)) {
    return url || "";
  }

  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/(\/resources\/[^/]+\/)thumb_small-/i, "$1");
    return parsed.toString();
  } catch {
    return String(url).replace(/(\/resources\/[^/]+\/)thumb_small-/i, "$1");
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
  const maxFrameWidth = Math.min(360, viewportWidth - 32);
  const maxFrameHeight = Math.min(560, viewportHeight - 96);
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
  const fallbackState = rowRef.imageUrl
    ? {
      imageUrl: rowRef.imageUrl,
      itemName: rowRef.itemName,
      secondTitle: rowRef.secondTitle,
      caption: formatMondayPreviewCaption(rowRef.itemName, rowRef.secondTitle)
    }
    : null;

  if (rowRef.imageMode !== "monday-fetch" && fallbackState) {
    return fallbackState;
  }

  if (!rowRef.itemId && !rowRef.itemName) {
    return fallbackState || {
      itemName: rowRef.itemName,
      secondTitle: rowRef.secondTitle,
      caption: ""
    };
  }

  let result;

  try {
    result = await sendTalacherMessage({
      type: "TALACHER_GET_MONDAY_ITEM_IMAGE",
      itemId: rowRef.itemId,
      itemName: rowRef.itemName,
      fallbackImageUrl: rowRef.imageUrl,
      imageMode: rowRef.imageMode
    });
  } catch (error) {
    if (fallbackState) {
      return fallbackState;
    }

    throw error;
  }

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

// Runs last so every top-level const above is initialized before setup uses it.
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
