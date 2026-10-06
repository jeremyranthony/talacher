// "Suggest names" window for the Miro send dialog: pick which images and notes describe the
// item, ask the AI (via the background worker) for First/Second title ideas, and browse history.

const TALACHER_NAMING_ITEM_TYPES = [
  "Animation", "ArmAccessory", "Back", "Backplate", "Cleat", "Emoji", "EndzoneEffect", "FBTexture", "FBTrail",
  "Facial", "Front", "Glove", "Hair", "Hand", "Hat", "HeadAccessory", "Helmet", "LegAccessory", "Mouthpiece",
  "Neck", "Pants", "Shell", "Shirt", "Shoulder", "Sock", "TeamDance", "Undershirt", "Visor", "Waist"
];
const TALACHER_NAMING_MAX_IMAGES = 4;

function createTalacherNamingModal({ onUse }) {
  const shell = document.createElement("div");
  const uid = `talacher-naming-${Math.random().toString(36).slice(2, 8)}`;
  let context = { images: [], notes: [] };
  let extraImages = [];
  let isGenerating = false;
  let generateToken = 0;
  let closeTimer = null;

  shell.className = "talacher-root talacher-naming-shell";
  shell.hidden = true;
  shell.innerHTML = `
    <div class="talacher-dialog-backdrop" data-naming-close></div>
    <section class="talacher-naming" role="dialog" aria-modal="true" aria-labelledby="${uid}-title">
      <header class="talacher-naming-header">
        <h2 id="${uid}-title">Name ideas</h2>
        <div class="talacher-tabs" role="tablist" aria-label="Name ideas">
          <button type="button" role="tab" id="${uid}-tab-suggest" aria-controls="${uid}-panel-suggest" aria-selected="true" data-tab="suggest">Suggest</button>
          <button type="button" role="tab" id="${uid}-tab-history" aria-controls="${uid}-panel-history" aria-selected="false" data-tab="history">History <span class="talacher-tab-count" data-history-count></span></button>
        </div>
        <button class="talacher-icon-button" type="button" aria-label="Close" data-naming-close>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </header>
      <div class="talacher-naming-body" role="tabpanel" id="${uid}-panel-suggest" aria-labelledby="${uid}-tab-suggest" data-panel="suggest">
        <div class="talacher-naming-context">
          <div class="talacher-field">
            <span class="talacher-field-label">Images the AI will look at</span>
            <div class="talacher-naming-images" data-images></div>
            <small class="talacher-field-hint">Up to ${TALACHER_NAMING_MAX_IMAGES}. You can also paste an image here.</small>
          </div>
          <div class="talacher-field" data-notes-field hidden>
            <span class="talacher-field-label">Notes from the board</span>
            <div class="talacher-naming-notes" data-notes></div>
          </div>
          <div data-slot="itemType"></div>
          <label class="talacher-field">
            <span class="talacher-field-label">Hint <small>(optional)</small></span>
            <input type="text" autocomplete="off" data-hint placeholder="e.g. mythology season, part of the Zeus set">
          </label>
          <button class="talacher-primary-button talacher-naming-generate" type="button" data-generate>Suggest names</button>
          <p class="talacher-naming-provider" data-provider></p>
        </div>
        <div class="talacher-naming-results" data-results aria-live="polite"></div>
      </div>
      <div class="talacher-naming-body talacher-naming-history-body" role="tabpanel" id="${uid}-panel-history" aria-labelledby="${uid}-tab-history" data-panel="history" hidden>
        <div class="talacher-naming-history" data-history></div>
      </div>
      <input type="file" accept="image/*" multiple hidden data-file>
    </section>
  `;

  const imageGrid = shell.querySelector("[data-images]");
  const notesField = shell.querySelector("[data-notes-field]");
  const notesList = shell.querySelector("[data-notes]");
  const hintInput = shell.querySelector("[data-hint]");
  const generateButton = shell.querySelector("[data-generate]");
  const providerNote = shell.querySelector("[data-provider]");
  const results = shell.querySelector("[data-results]");
  const historyList = shell.querySelector("[data-history]");
  const historyCount = shell.querySelector("[data-history-count]");
  const fileInput = shell.querySelector("[data-file]");
  const typePicker = createTalacherPicker({
    name: "namingItemType",
    label: "Item type",
    layer: shell,
    placeholder: "Let the AI decide",
    emptyLabel: "Let the AI decide"
  });

  shell.querySelector('[data-slot="itemType"]').replaceWith(typePicker.element);
  typePicker.setOptions(TALACHER_NAMING_ITEM_TYPES.map((type) => ({ value: type, label: splitPascalCase(type) })), { defaultValue: "" });

  shell.addEventListener("click", (event) => {
    if (event.target.closest("[data-naming-close]")) {
      close();
    }

    const tab = event.target.closest("[data-tab]");

    if (tab) {
      showTab(tab.dataset.tab);
    }
  });
  shell.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      generate();
    }
  });
  shell.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));

    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  });
  fileInput.addEventListener("change", () => {
    addFiles([...fileInput.files]);
    fileInput.value = "";
  });
  generateButton.addEventListener("click", generate);
  hintInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      generate();
    }
  });

  function open(nextContext) {
    clearTimeout(closeTimer);
    context = nextContext;
    extraImages = [];
    shell.classList.remove("talacher-dialog-closing");
    shell.hidden = false;
    typePicker.setValue(nextContext.itemTypeHint || "");
    renderImages();
    renderNotes();
    renderEmptyResults();
    showTab("suggest");
    refreshProviderNote();
    refreshHistory();
    setTimeout(() => generateButton.focus(), 0);
  }

  function close() {
    generateToken += 1;
    setGenerating(false);
    typePicker.close();
    shell.classList.add("talacher-dialog-closing");
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      shell.hidden = true;
      shell.classList.remove("talacher-dialog-closing");
    }, prefersReducedMotion() ? 0 : 150);
  }

  function showTab(name) {
    for (const tab of shell.querySelectorAll("[data-tab]")) {
      tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
    }

    for (const panel of shell.querySelectorAll("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== name;
    }

    if (name === "history") {
      refreshHistory();
    }
  }

  function allImages() {
    return [...context.images, ...extraImages];
  }

  function renderImages() {
    const images = allImages();
    imageGrid.replaceChildren(...images.map((image) => {
      const tile = document.createElement("label");
      tile.className = "talacher-naming-image";
      tile.title = image.label || "Image";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(image.checked);
      checkbox.setAttribute("aria-label", image.label || "Image");
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && allImages().filter((candidate) => candidate.checked).length >= TALACHER_NAMING_MAX_IMAGES) {
          checkbox.checked = false;
          return;
        }

        image.checked = checkbox.checked;
      });

      const img = document.createElement("img");
      img.alt = "";
      Promise.resolve(image.previewUrl).then((url) => {
        if (url) {
          img.src = url;
        }
      });

      tile.append(checkbox, img);
      return tile;
    }));

    const add = document.createElement("button");
    add.type = "button";
    add.className = "talacher-naming-image talacher-naming-image-add";
    add.setAttribute("aria-label", "Add an image");
    add.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    add.addEventListener("click", () => fileInput.click());
    imageGrid.append(add);
  }

  function renderNotes() {
    notesField.hidden = !context.notes.length;
    notesList.replaceChildren(...context.notes.map((note) => {
      const chip = document.createElement("label");
      chip.className = "talacher-naming-note";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = note.checked !== false;
      checkbox.addEventListener("change", () => {
        note.checked = checkbox.checked;
      });
      const text = document.createElement("span");
      text.textContent = note.text.replace(/\n+/g, " ");
      chip.title = note.text;
      chip.append(checkbox, text);
      return chip;
    }));
  }

  async function addFiles(files) {
    for (const file of files) {
      const dataUrl = await blobToDataUrl(file);
      const willCheck = allImages().filter((image) => image.checked).length < TALACHER_NAMING_MAX_IMAGES;
      extraImages.push({ id: `extra-${Date.now()}-${extraImages.length}`, label: file.name || "Pasted image", previewUrl: dataUrl, loadDataUrl: async () => dataUrl, checked: willCheck });
    }

    renderImages();
  }

  async function refreshProviderNote() {
    try {
      const settings = await sendTalacherMessage({ type: "TALACHER_AI_GET_SETTINGS" });
      const label = settings.provider === "groq" ? "Groq" : "Gemini";
      providerNote.textContent = settings.configured[settings.provider]
        ? `Using ${label} (${settings.model})${settings.catalogSize ? `, learning from ${settings.catalogSize} existing items` : ""}.`
        : `Add a ${label} API key in the Talacher popup to get suggestions.`;
      providerNote.classList.toggle("talacher-naming-provider-missing", !settings.configured[settings.provider]);
    } catch {
      providerNote.textContent = "";
    }
  }

  async function generate() {
    if (isGenerating) {
      return;
    }

    const chosen = allImages().filter((image) => image.checked);
    const notes = context.notes.filter((note) => note.checked !== false).map((note) => note.text);

    if (!chosen.length && !notes.length && !hintInput.value.trim()) {
      renderError("Pick at least one image or note, or write a hint, so the AI knows what the item is.");
      return;
    }

    const token = ++generateToken;
    setGenerating(true);
    renderLoading();

    try {
      const dataUrls = (await Promise.all(chosen.map((image) => image.loadDataUrl().catch(() => null)))).filter(Boolean);
      const [images, thumbnails] = await Promise.all([
        Promise.all(dataUrls.map((url) => resizeImageDataUrl(url, 768, 0.88))),
        Promise.all(dataUrls.map((url) => resizeImageDataUrl(url, 96, 0.8)))
      ]);
      const entry = await sendTalacherMessage({
        type: "TALACHER_AI_SUGGEST_NAMES",
        request: {
          images: images.filter(Boolean),
          thumbnails: thumbnails.filter(Boolean),
          notes,
          hint: hintInput.value,
          itemTypeHint: typePicker.value
        }
      });

      if (token === generateToken) {
        renderSuggestions(entry);
        refreshHistoryCount();
      }
    } catch (error) {
      if (token === generateToken) {
        renderError(/context invalidated/i.test(error.message)
          ? "Talacher was updated. Refresh this Miro tab and try again."
          : error.message);
      }
    } finally {
      if (token === generateToken) {
        setGenerating(false);
      }
    }
  }

  function setGenerating(generating) {
    isGenerating = generating;
    generateButton.disabled = generating;
    generateButton.textContent = generating ? "Thinking..." : "Suggest names";
  }

  function renderEmptyResults() {
    results.replaceChildren(Object.assign(document.createElement("p"), {
      className: "talacher-naming-empty",
      textContent: "Choose what describes the item, then ask for names. Each option comes with an item type you can apply in one click."
    }));
  }

  function renderLoading() {
    results.replaceChildren(...Array.from({ length: 6 }, () => Object.assign(document.createElement("div"), {
      className: "talacher-name-card talacher-name-card-loading"
    })));
  }

  function renderError(message) {
    results.replaceChildren(Object.assign(document.createElement("p"), {
      className: "talacher-naming-error",
      textContent: message
    }));
  }

  function renderSuggestions(entry) {
    if (!entry.suggestions.length) {
      renderError("No usable names came back. Try again or add a hint.");
      return;
    }

    results.replaceChildren(...entry.suggestions.map((suggestion, index) => {
      const card = createSuggestionCard(entry, suggestion);
      card.style.setProperty("--stagger", `${index * 45}ms`);
      return card;
    }));
  }

  function createSuggestionCard(entry, suggestion, { compact = false } = {}) {
    const card = document.createElement("article");
    card.className = `talacher-name-card${compact ? " talacher-name-card-compact" : ""}`;
    card.classList.toggle("talacher-name-card-duplicate", Boolean(suggestion.duplicateOf));
    card.classList.toggle("talacher-name-card-used", isUsed(entry, suggestion));

    const titles = document.createElement("div");
    titles.className = "talacher-name-titles";
    titles.append(
      Object.assign(document.createElement("strong"), { textContent: suggestion.firstTitle || "—" }),
      Object.assign(document.createElement("span"), { textContent: suggestion.secondTitle })
    );

    const meta = document.createElement("div");
    meta.className = "talacher-name-meta";

    if (suggestion.itemType) {
      meta.append(createTalacherChip({ label: splitPascalCase(suggestion.itemType) }));
    }

    if (suggestion.duplicateOf) {
      meta.append(Object.assign(document.createElement("span"), {
        className: "talacher-name-flag",
        textContent: "Already exists",
        title: suggestion.duplicateOf
      }));
    } else if (isUsed(entry, suggestion)) {
      meta.append(Object.assign(document.createElement("span"), { className: "talacher-name-flag talacher-name-flag-used", textContent: "Used" }));
    }

    const use = document.createElement("button");
    use.type = "button";
    use.className = compact ? "talacher-link-button" : "talacher-secondary-button";
    use.textContent = "Use name";
    use.addEventListener("click", () => {
      onUse(suggestion);
      sendTalacherMessage({
        type: "TALACHER_AI_MARK_USED",
        used: { entryId: entry.id, firstTitle: suggestion.firstTitle, secondTitle: suggestion.secondTitle }
      }).catch(() => {});
      close();
    });

    card.append(titles, meta);

    if (suggestion.reason && !compact) {
      card.append(Object.assign(document.createElement("p"), { className: "talacher-name-reason", textContent: suggestion.reason }));
    }

    card.append(use);
    return card;
  }

  function isUsed(entry, suggestion) {
    return entry.used?.firstTitle === suggestion.firstTitle && entry.used?.secondTitle === suggestion.secondTitle;
  }

  async function refreshHistoryCount() {
    try {
      const history = await sendTalacherMessage({ type: "TALACHER_AI_GET_HISTORY" });
      historyCount.textContent = history.length ? String(history.length) : "";
      return history;
    } catch {
      return [];
    }
  }

  async function refreshHistory() {
    const history = await refreshHistoryCount();

    if (!history.length) {
      historyList.replaceChildren(Object.assign(document.createElement("p"), {
        className: "talacher-naming-empty",
        textContent: "Suggestions you ask for are saved here, so you can come back to a name later."
      }));
      return;
    }

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "talacher-link-button talacher-naming-clear";
    clear.textContent = "Clear history";
    clear.addEventListener("click", async () => {
      await sendTalacherMessage({ type: "TALACHER_AI_DELETE_HISTORY", target: {} }).catch(() => {});
      refreshHistory();
    });

    historyList.replaceChildren(clear, ...history.map((entry) => {
      const section = document.createElement("section");
      section.className = "talacher-history-entry";

      const head = document.createElement("header");
      const thumbs = document.createElement("div");
      thumbs.className = "talacher-history-thumbs";
      thumbs.append(...(entry.thumbnails || []).map((src) => Object.assign(document.createElement("img"), { src, alt: "" })));

      const info = document.createElement("div");
      info.className = "talacher-history-info";
      info.append(
        Object.assign(document.createElement("strong"), { textContent: formatRelativeTime(entry.createdAt) }),
        Object.assign(document.createElement("span"), {
          textContent: [entry.itemTypeHint && splitPascalCase(entry.itemTypeHint), entry.hint, entry.notes?.[0]].filter(Boolean).join(", ") || `${entry.suggestions.length} names`
        })
      );

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "talacher-icon-button talacher-history-remove";
      remove.setAttribute("aria-label", "Delete this entry");
      remove.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      remove.addEventListener("click", async () => {
        await sendTalacherMessage({ type: "TALACHER_AI_DELETE_HISTORY", target: { entryId: entry.id } }).catch(() => {});
        refreshHistory();
      });

      head.append(thumbs, info, remove);
      const list = document.createElement("div");
      list.className = "talacher-history-names";
      list.append(...entry.suggestions.map((suggestion) => createSuggestionCard(entry, suggestion, { compact: true })));
      section.append(head, list);
      return section;
    }));
  }

  return { element: shell, open, close };
}

function splitPascalCase(value) {
  return String(value || "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

// Maps a Studio ItemType (e.g. "TeamDance", "Shirt") to the closest monday Asset Type label.
function mapItemTypeToAssetLabel(itemType, labels) {
  const key = normalizePickerText(splitPascalCase(itemType)).replace(/\s+/g, "");

  if (!key) {
    return null;
  }

  const compact = (label) => normalizePickerText(label).replace(/\s+/g, "");
  return labels.find((label) => compact(label) === key)
    || labels.find((label) => compact(label).startsWith(key))
    || labels.find((label) => compact(label).replace(/s$/, "") === key.replace(/s$/, ""))
    || null;
}

// Maps a monday Asset Type label back to a Studio ItemType for the AI's type hint.
function mapAssetLabelToItemType(label) {
  const key = normalizePickerText(label).replace(/\s+/g, "");

  if (!key || key === "notcategorized") {
    return "";
  }

  return TALACHER_NAMING_ITEM_TYPES.find((type) => type.toLowerCase() === key)
    || TALACHER_NAMING_ITEM_TYPES.find((type) => key.startsWith(type.toLowerCase()))
    || "";
}

function resizeImageDataUrl(dataUrl, maxSize, quality) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      // Flatten transparency onto white so JPEG keeps the art readable.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

function formatRelativeTime(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (seconds < 60) {
    return "Just now";
  }

  if (seconds < 3600) {
    return format.format(-Math.round(seconds / 60), "minute");
  }

  if (seconds < 86400) {
    return format.format(-Math.round(seconds / 3600), "hour");
  }

  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
