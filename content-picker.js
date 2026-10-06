// Searchable dropdown used by the Miro send dialog. Options render as colored chips, matching
// how labels look on the monday board. The value lives in a hidden input so FormData and
// form.reset() keep working.
function createTalacherPicker({
  name,
  label,
  layer,
  placeholder = "Select",
  emptyLabel = null,
  searchThreshold = 7,
  gridThreshold = 12
}) {
  const uid = `talacher-picker-${name}-${Math.random().toString(36).slice(2, 8)}`;
  const field = document.createElement("div");
  const popover = document.createElement("div");
  let options = [];
  let filtered = [];
  let activeIndex = -1;
  let isOpen = false;

  field.className = "talacher-field talacher-picker";
  field.innerHTML = `
    <span class="talacher-field-label" id="${uid}-label"></span>
    <button type="button" class="talacher-picker-trigger" role="combobox" aria-haspopup="listbox"
      aria-expanded="false" aria-controls="${uid}-list" aria-labelledby="${uid}-label ${uid}-value">
      <span class="talacher-picker-value" id="${uid}-value"></span>
      <svg class="talacher-picker-chevron" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <input type="hidden" name="${name}">
  `;
  popover.className = "talacher-root talacher-picker-popover";
  popover.hidden = true;
  popover.innerHTML = `
    <div class="talacher-picker-search">
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      <input type="text" autocomplete="off" spellcheck="false" role="searchbox"
        aria-controls="${uid}-list" aria-autocomplete="list">
    </div>
    <div class="talacher-picker-list" id="${uid}-list" role="listbox" tabindex="-1" aria-labelledby="${uid}-label"></div>
    <p class="talacher-picker-empty" hidden></p>
  `;

  const labelNode = field.querySelector(".talacher-field-label");
  const trigger = field.querySelector(".talacher-picker-trigger");
  const valueNode = field.querySelector(".talacher-picker-value");
  const input = field.querySelector("input[type='hidden']");
  const searchWrap = popover.querySelector(".talacher-picker-search");
  const search = popover.querySelector(".talacher-picker-search input");
  const list = popover.querySelector(".talacher-picker-list");
  const emptyNode = popover.querySelector(".talacher-picker-empty");

  labelNode.textContent = label;
  search.placeholder = `Search ${label.toLowerCase()}`;
  search.setAttribute("aria-label", `Search ${label.toLowerCase()}`);
  layer.append(popover);

  labelNode.addEventListener("click", () => trigger.focus());
  trigger.addEventListener("click", () => (isOpen ? close() : open()));
  trigger.addEventListener("keydown", (event) => {
    if (isOpen) {
      handleListKey(event);
      return;
    }

    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      open();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && isSearchable()) {
      // Typing on the closed picker starts a search.
      event.preventDefault();
      open(event.key);
    }
  });
  search.addEventListener("input", () => {
    renderList();
    setActive(filtered.length ? 0 : -1);
  });
  search.addEventListener("keydown", handleListKey);
  list.addEventListener("keydown", handleListKey);
  list.addEventListener("pointermove", (event) => {
    const option = event.target.closest("[data-index]");

    if (option) {
      setActive(Number(option.dataset.index), { scroll: false });
    }
  });
  list.addEventListener("click", (event) => {
    const option = event.target.closest("[data-index]");

    if (option) {
      choose(filtered[Number(option.dataset.index)]);
    }
  });

  const onOutsidePointer = (event) => {
    if (!field.contains(event.target) && !popover.contains(event.target)) {
      close({ focusTrigger: false });
    }
  };
  const onViewportChange = () => position();

  function isSearchable() {
    return options.length >= searchThreshold;
  }

  function allChoices() {
    return emptyLabel === null ? options : [{ value: "", label: emptyLabel, isEmpty: true }, ...options];
  }

  function open(initialQuery = "") {
    if (isOpen) {
      return;
    }

    isOpen = true;
    search.value = initialQuery;
    searchWrap.hidden = !isSearchable();
    list.classList.toggle("talacher-picker-list-grid", options.length >= gridThreshold);
    renderList();
    popover.hidden = false;
    popover.classList.remove("talacher-picker-popover-leaving");
    trigger.setAttribute("aria-expanded", "true");
    position();

    const selectedIndex = filtered.findIndex((option) => option.value === input.value);
    setActive(initialQuery ? 0 : Math.max(0, selectedIndex));
    (isSearchable() ? search : list).focus({ preventScroll: true });

    document.addEventListener("pointerdown", onOutsidePointer, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
  }

  function close({ focusTrigger = true } = {}) {
    if (!isOpen) {
      return;
    }

    isOpen = false;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
    popover.classList.add("talacher-picker-popover-leaving");
    setTimeout(() => {
      if (!isOpen) {
        popover.hidden = true;
        popover.classList.remove("talacher-picker-popover-leaving");
      }
    }, 120);

    if (focusTrigger) {
      trigger.focus({ preventScroll: true });
    }
  }

  function position() {
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(Math.max(rect.width, options.length >= gridThreshold ? 340 : 220), window.innerWidth - margin * 2);
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const placeAbove = spaceBelow < 260 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(360, (placeAbove ? spaceAbove : spaceBelow) - 6);

    popover.style.width = `${width}px`;
    popover.style.left = `${Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin)}px`;
    popover.style.maxHeight = `${Math.max(140, maxHeight)}px`;
    popover.style.top = placeAbove ? "" : `${rect.bottom + 6}px`;
    popover.style.bottom = placeAbove ? `${window.innerHeight - rect.top + 6}px` : "";
    popover.classList.toggle("talacher-picker-popover-above", placeAbove);
  }

  function renderList() {
    const query = normalizePickerText(search.value);
    filtered = allChoices().filter((option) => !query || (!option.isEmpty && normalizePickerText(option.label).includes(query)));
    list.replaceChildren(...filtered.map((option, index) => {
      const node = document.createElement("div");
      node.className = "talacher-picker-option";
      node.id = `${uid}-option-${index}`;
      node.dataset.index = String(index);
      node.setAttribute("role", "option");
      node.setAttribute("aria-selected", String(option.value === input.value));
      node.append(createTalacherChip(option));
      return node;
    }));
    emptyNode.hidden = filtered.length > 0;
    emptyNode.textContent = `No ${label.toLowerCase()} matches “${search.value.trim()}”.`;
  }

  function setActive(index, { scroll = true } = {}) {
    activeIndex = index;
    let activeNode = null;

    for (const node of list.children) {
      const isActive = Number(node.dataset.index) === index;
      node.classList.toggle("talacher-picker-option-active", isActive);

      if (isActive) {
        activeNode = node;
      }
    }

    const owner = isSearchable() ? search : list;

    if (activeNode) {
      owner.setAttribute("aria-activedescendant", activeNode.id);

      if (scroll) {
        activeNode.scrollIntoView({ block: "nearest" });
      }
    } else {
      owner.removeAttribute("aria-activedescendant");
    }
  }

  function handleListKey(event) {
    const columns = list.classList.contains("talacher-picker-list-grid") ? 2 : 1;
    const moves = {
      ArrowDown: columns,
      ArrowUp: -columns,
      ArrowRight: event.currentTarget === search ? 0 : 1,
      ArrowLeft: event.currentTarget === search ? 0 : -1
    };

    if (event.key in moves && moves[event.key] !== 0) {
      event.preventDefault();

      if (filtered.length) {
        setActive(Math.min(filtered.length - 1, Math.max(0, activeIndex + moves[event.key])));
      }
    } else if (event.key === "Home" && event.currentTarget !== search) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End" && event.currentTarget !== search) {
      event.preventDefault();
      setActive(filtered.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();

      if (filtered[activeIndex]) {
        choose(filtered[activeIndex]);
      }
    } else if (event.key === "Escape") {
      // Close only the picker, not the whole dialog.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      event.preventDefault();
      close();
    }
  }

  function choose(option) {
    const changed = input.value !== option.value;
    input.value = option.value;
    renderValue();
    close();

    if (changed) {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function renderValue() {
    const option = allChoices().find((candidate) => candidate.value === input.value);
    valueNode.replaceChildren(option && !option.isEmpty
      ? createTalacherChip(option)
      : Object.assign(document.createElement("span"), {
        className: "talacher-picker-placeholder",
        textContent: placeholder
      }));
  }

  function findOption(value) {
    const key = normalizePickerText(value);
    return options.find((option) => option.value === value)
      || options.find((option) => normalizePickerText(option.value) === key);
  }

  return {
    element: field,
    input,
    get value() {
      return input.value;
    },
    setOptions(nextOptions, { defaultValue } = {}) {
      options = nextOptions;
      const keep = findOption(input.value);
      const fallback = findOption(defaultValue ?? input.defaultValue);

      if (defaultValue !== undefined) {
        input.defaultValue = fallback?.value ?? (emptyLabel === null ? options[0]?.value ?? "" : "");
      }

      input.value = keep?.value ?? fallback?.value ?? (emptyLabel === null ? options[0]?.value ?? "" : "");
      renderValue();

      if (isOpen) {
        renderList();
        position();
      }
    },
    setValue(value) {
      const option = findOption(value);
      input.value = option?.value ?? (emptyLabel === null ? input.value : "");
      renderValue();
    },
    getOptions: () => options.slice(),
    // Re-reads the hidden input, e.g. after form.reset().
    refresh: renderValue,
    close: () => close({ focusTrigger: false })
  };
}

function createTalacherChip(option) {
  const chip = document.createElement("span");
  chip.className = "talacher-chip";
  chip.textContent = option.label;

  if (option.person) {
    // People show a photo (or initials) before the name.
    chip.classList.add("talacher-chip-person");
    const avatar = option.avatar
      ? Object.assign(document.createElement("img"), { src: option.avatar, alt: "" })
      : Object.assign(document.createElement("span"), {
        textContent: option.label.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase()
      });
    avatar.className = "talacher-chip-avatar";
    chip.prepend(avatar);
    return chip;
  }

  if (option.isEmpty) {
    chip.classList.add("talacher-chip-empty");
  } else if (option.color) {
    chip.style.setProperty("--chip", option.color);
    chip.classList.toggle("talacher-chip-light", isLightTalacherColor(option.color));
  } else {
    chip.classList.add("talacher-chip-plain");
  }

  return chip;
}

function isLightTalacherColor(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());

  if (!match) {
    return false;
  }

  const value = parseInt(match[1], 16);
  const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

function normalizePickerText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
