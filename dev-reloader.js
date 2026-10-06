importScripts("ai-naming.js");

const DEV_SERVER_URL = "http://127.0.0.1:17321/version";
const POLL_INTERVAL_MS = 1000;
const MONDAY_API_URL = "https://api.monday.com/v2";
const activeTalacherRequests = new Map();

const DEFAULT_MONDAY_CONFIG = {
  boardId: "9457306673",
  groupId: "group_mm60k55f",
  groupTitle: "CH3 S1 OG Season",
  columns: {
    secondTitle: "text_mm57ycz1",
    priority: "color_mktbawq0",
    status: "status",
    assetType: "color_mktbqa5b",
    rarity: "color_mm1y1nam",
    imageRefLink: "text_mm63k2nn",
    artist: "person"
  }
};

const MONDAY_LABEL_COLUMN_KEYS = ["priority", "status", "assetType", "rarity"];
const MONDAY_LABEL_COLUMN_TITLES = {
  priority: "Priority",
  status: "Status",
  assetType: "Asset Type",
  rarity: "Rarity"
};
const MONDAY_LABELS_CACHE_MS = 5 * 60 * 1000;
const MONDAY_GROUPS_CACHE_MS = 5 * 60 * 1000;

// Fallback for label colors when only the 2025-10 color names are available.
const MONDAY_COLOR_NAMES = {
  done_green: "#00c875",
  working_orange: "#fdab3d",
  stuck_red: "#df2f4a",
  dark_blue: "#007eb5",
  bright_blue: "#579bfc",
  purple: "#9d50dd",
  dark_purple: "#784bd1",
  grass_green: "#037f4c",
  bright_green: "#9cd326",
  saladish: "#cab641",
  egg_yolk: "#ffcb00",
  dark_orange: "#ff6d3b",
  dark_red: "#bb3354",
  sofia_pink: "#ff158a",
  lipstick: "#ff5ac4",
  chili_blue: "#66ccff",
  american_gray: "#757575",
  explosive: "#c4c4c4",
  blackish: "#333333",
  brown: "#7f5347",
  sunset: "#ff7575",
  bubble: "#faa1f1",
  peach: "#ffadad",
  berry: "#7e3b8a",
  winter: "#9aadbd",
  river: "#68a1bd",
  navy: "#225091",
  aquamarine: "#4eccc6",
  indigo: "#5559df",
  dark_indigo: "#401694",
  pecan: "#563e3e",
  lavender: "#bda8f9",
  royal: "#2b76e5",
  steel: "#a9bee8",
  orchid: "#e484bd",
  lilac: "#9d99b9",
  tan: "#a1887f",
  sky: "#a1e3f6",
  coffee: "#cd9282",
  teal: "#175a63"
};

// Fallback only: used when the board's live labels can't be fetched.
const MONDAY_STATUS_INDEXES = {
  priority: {
    "Critical": 10,
    "Critical ⚠️️": 10,
    "High": 110,
    "Medium": 109,
    "Low": 7
  },
  status: {
    "In Progress": 0,
    "Done": 1,
    "Stuck": 2,
    "Ready To Start": 3,
    "Ready for Review": 4
  },
  assetType: {
    "Backplate": 0,
    "VFX": 1,
    "Animation": 2,
    "Helmet": 4,
    "Not Categorized": 5,
    "3D Model": 6,
    "Gloves": 10,
    "Football": 11,
    "Cleat": 13,
    "Hat Accessory": 14,
    "Hair": 15,
    "Back Accessory": 16,
    "Visor": 18,
    "Face Accessory": 19,
    "2D Shirt": 101,
    "Sleeve": 102,
    "Vest": 103,
    "Arm Accessory": 104,
    "LC Shirt": 105,
    "End Zone": 106,
    "Waist Accessory": 107,
    "Waist Accesory": 107,
    "LC Pants": 108,
    "Head": 109,
    "Emoji": 110,
    "Wrist Accessory": 151,
    "Costume": 152,
    "Front Accessory": 153,
    "Neck Accessory": 154,
    "Trade Booth": 155,
    "Head Accessory": 156,
    "Face Mask": 157,
    "2D Pants": 158,
    "Socks": 159,
    "Trail": 160
  },
  rarity: {
    "Silver": 0,
    "Gold": 1,
    "Amethyst": 2,
    "Diamond": 3,
    "Bronze": 4,
    "Pending": 5,
    "Ruby": 6,
    "Unset": 7
  }
};

let lastVersion = null;

async function pollForChanges() {
  try {
    const response = await fetch(DEV_SERVER_URL, { cache: "no-store" });

    if (!response.ok) {
      return;
    }

    const payload = await response.json();

    if (lastVersion === null) {
      lastVersion = payload.version;
      return;
    }

    if (payload.version !== lastVersion) {
      chrome.runtime.reload();
    }
  } catch {
    // The watcher is optional; ignore failures when it is not running.
  }
}

pollForChanges();
setInterval(pollForChanges, POLL_INTERVAL_MS);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type?.startsWith("TALACHER_")) {
    return false;
  }

  handleTalacherMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "Unknown error" }));

  return true;
});

async function handleTalacherMessage(message) {
  if (message.type === "TALACHER_GET_SETTINGS") {
    return getSettings();
  }

  if (message.type === "TALACHER_SAVE_SETTINGS") {
    return saveSettings(message.settings || {});
  }

  if (message.type === "TALACHER_FETCH_BOARD_SCHEMA") {
    return fetchBoardSchema();
  }

  if (message.type === "TALACHER_GET_ARTISTS") {
    return getMondayArtists();
  }

  if (message.type === "TALACHER_FIND_MONDAY_TITLES") {
    return findMondayItemsByTitle(message.titles || {});
  }

  if (message.type === "TALACHER_GET_NAMING_INDEX") {
    return (await loadNamingCatalog()).map((item) => ({ firstTitle: item.firstTitle, secondTitle: item.secondTitle, itemType: item.itemType }));
  }

  if (message.type === "TALACHER_AI_SUGGEST_NAMES") {
    return suggestItemNames(message.request || {});
  }

  if (message.type === "TALACHER_AI_GET_SETTINGS") {
    return getNamingSettings();
  }

  if (message.type === "TALACHER_AI_SAVE_SETTINGS") {
    return saveNamingSettings(message.settings || {});
  }

  if (message.type === "TALACHER_AI_GET_HISTORY") {
    return getNamingHistory();
  }

  if (message.type === "TALACHER_AI_MARK_USED") {
    return markNamingSuggestionUsed(message.used || {});
  }

  if (message.type === "TALACHER_AI_DELETE_HISTORY") {
    return deleteNamingHistory(message.target || {});
  }

  if (message.type === "TALACHER_GET_GROUPS") {
    return getMondayGroups();
  }

  if (message.type === "TALACHER_GET_COLUMN_LABELS") {
    return getMondayColumnLabels(await getSettings());
  }

  if (message.type === "TALACHER_CREATE_MONDAY_ITEM") {
    return createMondayItem(message.payload || {}, message.requestId);
  }

  if (message.type === "TALACHER_CANCEL_REQUEST") {
    return cancelTalacherRequest(message.requestId);
  }

  if (message.type === "TALACHER_GET_MONDAY_ITEM_IMAGE") {
    return getMondayItemImage(message.itemId, message.itemName, message.fallbackImageUrl, message.imageMode);
  }

  throw new Error(`Unsupported message type: ${message.type}`);
}

async function getSettings() {
  const stored = await chrome.storage.local.get(["mondayToken", "mondayConfig", "mondayGroups"]);
  const config = {
    ...DEFAULT_MONDAY_CONFIG,
    ...(stored.mondayConfig || {}),
    columns: {
      ...DEFAULT_MONDAY_CONFIG.columns,
      ...(stored.mondayConfig?.columns || {})
    }
  };

  return {
    config,
    groups: stored.mondayGroups || [{ id: config.groupId, title: config.groupTitle }],
    tokenConfigured: Boolean(stored.mondayToken)
  };
}

async function saveSettings(settings) {
  const updates = {};

  if (typeof settings.token === "string") {
    const token = settings.token.trim();

    if (token) {
      updates.mondayToken = token;
    }
  }

  if (settings.config) {
    updates.mondayConfig = {
      ...DEFAULT_MONDAY_CONFIG,
      ...settings.config,
      columns: {
        ...DEFAULT_MONDAY_CONFIG.columns,
        ...(settings.config.columns || {})
      }
    };
  }

  if (Array.isArray(settings.groups)) {
    updates.mondayGroups = settings.groups;
  }

  await chrome.storage.local.set(updates);
  return getSettings();
}

async function fetchBoardSchema() {
  const settings = await getSettings();
  const query = `
    query BoardSchema($boardId: [ID!]) {
      boards(ids: $boardId) {
        id
        name
        groups {
          id
          title
          color
          archived
          deleted
        }
        columns {
          id
          title
          type
          settings_str
        }
      }
    }
  `;

  const data = await mondayRequest(query, { boardId: [settings.config.boardId] });
  const board = data.boards?.[0];

  if (!board) {
    throw new Error("monday board was not found.");
  }

  const groups = board.groups
    .filter((group) => !group.archived && !group.deleted)
    .map((group) => ({ id: group.id, title: group.title, color: group.color || null }));

  const defaultGroup = groups.find((group) => group.title === DEFAULT_MONDAY_CONFIG.groupTitle) || groups[0];
  // Drop a saved group that has since been archived or deleted.
  const savedGroup = groups.find((group) => group.id === settings.config.groupId);
  const nextConfig = {
    ...settings.config,
    boardId: board.id,
    groupId: savedGroup?.id || defaultGroup?.id || DEFAULT_MONDAY_CONFIG.groupId,
    groupTitle: savedGroup?.title || defaultGroup?.title || DEFAULT_MONDAY_CONFIG.groupTitle
  };

  await chrome.storage.local.set({
    mondayGroups: groups,
    mondayGroupsFetchedAt: Date.now(),
    mondayConfig: nextConfig
  });
  await getMondayColumnLabelsOrNull({ ...settings, config: nextConfig }, { force: true });

  return {
    board: { id: board.id, name: board.name },
    groups,
    columns: board.columns,
    config: nextConfig
  };
}

// Groups for the send dialog: refreshed from monday every few minutes so new groups (e.g. a new
// season) appear without pressing "Fetch board"; falls back to the stored list when offline.
// People who can be set as the row's Artist: the board's subscribers (falls back to all
// non-guest users), cached for 30 minutes.
async function getMondayArtists() {
  const { mondayArtists } = await chrome.storage.local.get("mondayArtists");

  if (mondayArtists && Date.now() - mondayArtists.fetchedAt < 30 * 60 * 1000) {
    return mondayArtists.users;
  }

  const settings = await getSettings();
  const data = await mondayRequest(`
    query TalacherArtists($boardId: [ID!]) {
      boards(ids: $boardId) { subscribers { id name photo_thumb_small enabled is_guest } }
    }
  `, { boardId: [settings.config.boardId] });
  let users = data.boards?.[0]?.subscribers || [];

  if (users.length < 2) {
    const all = await mondayRequest(`
      query TalacherAllUsers { users(kind: non_guests, limit: 1000) { id name photo_thumb_small enabled is_guest } }
    `, {});
    users = all.users || [];
  }

  const artists = users
    .filter((user) => user.enabled !== false && !user.is_guest)
    .map((user) => ({ id: String(user.id), name: user.name, photo: user.photo_thumb_small || null }))
    .sort((a, b) => a.name.localeCompare(b.name));

  await chrome.storage.local.set({ mondayArtists: { fetchedAt: Date.now(), users: artists } });
  return artists;
}

// Rows on the board whose First title matches exactly, flagged when the Second Title matches too.
async function findMondayItemsByTitle({ firstTitle, secondTitle }) {
  const first = String(firstTitle || "").trim();

  if (!first) {
    return [];
  }

  const settings = await getSettings();
  const data = await mondayRequest(`
    query TalacherFindTitles($boardId: ID!, $values: [String]!, $secondTitleColumn: [String!]) {
      items_page_by_column_values(board_id: $boardId, limit: 25, columns: [{ column_id: "name", column_values: $values }]) {
        items { id name url group { title } column_values(ids: $secondTitleColumn) { text } }
      }
    }
  `, { boardId: settings.config.boardId, values: [first], secondTitleColumn: [settings.config.columns.secondTitle] });
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  return (data.items_page_by_column_values?.items || []).map((item) => ({
    id: item.id,
    firstTitle: item.name,
    secondTitle: item.column_values?.[0]?.text || "",
    group: item.group?.title || "",
    url: item.url,
    exact: normalize(item.column_values?.[0]?.text) === normalize(secondTitle)
  }));
}

async function getMondayGroups() {
  const settings = await getSettings();
  const { mondayGroupsFetchedAt } = await chrome.storage.local.get("mondayGroupsFetchedAt");
  const isFresh = Date.now() - (mondayGroupsFetchedAt || 0) < MONDAY_GROUPS_CACHE_MS
    && settings.groups.every((group) => "color" in group);

  if (!isFresh && settings.tokenConfigured) {
    try {
      const schema = await fetchBoardSchema();
      return { groups: schema.groups, groupId: schema.config.groupId, stale: false };
    } catch (error) {
      console.warn("Talacher could not refresh monday groups; using the saved list.", error);
      return { groups: settings.groups, groupId: settings.config.groupId, stale: true };
    }
  }

  return { groups: settings.groups, groupId: settings.config.groupId, stale: false };
}

async function createMondayItem(payload, requestId) {
  const controller = new AbortController();

  if (requestId) {
    activeTalacherRequests.set(requestId, controller);
  }

  try {
    return await createMondayItemWithSignal(payload, controller.signal);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Cancelled.");
    }

    throw error;
  } finally {
    if (requestId) {
      activeTalacherRequests.delete(requestId);
    }
  }
}

function cancelTalacherRequest(requestId) {
  const controller = activeTalacherRequests.get(requestId);

  if (!controller) {
    return { cancelled: false };
  }

  controller.abort();
  activeTalacherRequests.delete(requestId);
  return { cancelled: true };
}

async function createMondayItemWithSignal(payload, signal) {
  const settings = await getSettings();
  const config = {
    ...settings.config,
    groupId: payload.groupId || settings.config.groupId
  };
  const selectedGroup = settings.groups.find((group) => group.id === config.groupId);
  const firstTitle = payload.firstTitle?.trim();

  if (!firstTitle) {
    throw new Error("First title is required.");
  }

  const columnValues = {};
  setTextColumn(columnValues, config.columns.secondTitle, payload.secondTitle);

  if (config.columns.artist && /^\d+$/.test(String(payload.artistId || ""))) {
    columnValues[config.columns.artist] = { personsAndTeams: [{ id: Number(payload.artistId), kind: "person" }] };
  }

  const statusSelections = await setStatusColumns(columnValues, settings, payload, signal);

  const mutation = `
    mutation CreateTalacherItem($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $columnValues
      ) {
        id
        name
        url
      }
    }
  `;

  let data;

  try {
    data = await mondayRequest(mutation, {
      boardId: config.boardId,
      groupId: config.groupId,
      itemName: firstTitle,
      columnValues: JSON.stringify(columnValues)
    }, signal);
  } catch (error) {
    if (/deactivated/i.test(error.message)) {
      // The board's labels changed since they were cached; force a fresh lookup on the next send.
      await chrome.storage.local.remove("mondayColumnLabels");
      const sentLabels = statusSelections.map((selection) => `${MONDAY_LABEL_COLUMN_TITLES[selection.key]}: ${selection.label}`).join(", ");
      throw new Error(`monday rejected a deactivated label (${sentLabels}). Board labels were refreshed, so reopen the form and try again.`);
    }

    throw error;
  }

  const item = data.create_item;
  let update = null;
  let asset = null;

  if (payload.image?.uploadable) {
    throwIfAborted(signal);
    update = await createMondayUpdate(item.id, "Miro reference image uploaded Via Talacher.", signal);
    throwIfAborted(signal);
    asset = await uploadFileToMondayUpdate(update.id, payload.image, signal);

    if (asset?.url) {
      throwIfAborted(signal);
      await updateImageRefLink(config.boardId, item.id, config.columns.imageRefLink, asset.public_url || asset.url, signal);
    }
  }

  await chrome.storage.local.set({
    mondayConfig: {
      ...settings.config,
      groupId: config.groupId,
      groupTitle: selectedGroup?.title || settings.config.groupTitle
    }
  });

  return {
    item,
    group: selectedGroup || { id: config.groupId, title: settings.config.groupTitle },
    update,
    asset
  };
}

async function getMondayItemImage(itemId, itemName, fallbackImageUrl = "", imageMode = "legacy") {
  if (!itemId && !itemName) {
    throw new Error("No monday item ID or row title was found for this row.");
  }

  const settings = await getSettings();
  const includeUpdates = imageMode === "monday-fetch";

  if (!itemId) {
    return getMondayItemImageByName(itemName, settings, fallbackImageUrl, imageMode);
  }

  const updatesSelection = includeUpdates ? `
        updates(limit: 10) {
          id
          created_at
          assets {
            id
            name
            file_extension
            url
            public_url
            url_thumbnail
          }
        }` : "";
  const query = `
    query TalacherItemImage($itemIds: [ID!], $columnIds: [String!]) {
      items(ids: $itemIds) {
        id
        name
${updatesSelection}
        column_values(ids: $columnIds) {
          id
          text
          value
        }
      }
    }
  `;
  const data = await mondayRequest(query, {
    itemIds: [String(itemId)],
    columnIds: [settings.config.columns.imageRefLink]
  });
  const item = data.items?.[0];
  return buildMondayItemImageState(item, fallbackImageUrl, String(itemId), includeUpdates);
}

async function getMondayItemImageByName(itemName, settings, fallbackImageUrl = "", imageMode = "legacy") {
  const includeUpdates = imageMode === "monday-fetch";
  const updatesSelection = includeUpdates ? `
            updates(limit: 10) {
              id
              created_at
              assets {
                id
                name
                file_extension
                url
                public_url
                url_thumbnail
              }
            }` : "";
  const query = `
    query TalacherBoardImages($boardIds: [ID!], $columnIds: [String!]) {
      boards(ids: $boardIds) {
        items_page(limit: 200) {
          items {
            id
            name
${updatesSelection}
            column_values(ids: $columnIds) {
              id
              text
              value
            }
          }
        }
      }
    }
  `;
  const data = await mondayRequest(query, {
    boardIds: [settings.config.boardId],
    columnIds: [settings.config.columns.imageRefLink]
  });
  const normalizedName = normalizeMondayName(itemName);
  const items = data.boards?.[0]?.items_page?.items || [];
  const item = items.find((candidate) => normalizeMondayName(candidate.name) === normalizedName);

  if (!item) {
    throw new Error(`No monday item matched "${itemName}".`);
  }

  return buildMondayItemImageState(item, fallbackImageUrl, "", includeUpdates);
}

function normalizeMondayName(value) {
  return String(value || "").trim().toLowerCase();
}

function extractMondayImageUrl(column) {
  if (!column) {
    return "";
  }

  if (column.text?.trim()) {
    return column.text.trim();
  }

  if (!column.value) {
    return "";
  }

  try {
    const parsed = JSON.parse(column.value);

    if (typeof parsed === "string") {
      return parsed;
    }

    return parsed?.url || parsed?.text || "";
  } catch {
    return "";
  }
}

function buildMondayItemImageState(item, fallbackImageUrl = "", fallbackItemId = "", includeUpdates = false) {
  const latestUpdateImageUrl = includeUpdates ? extractLatestMondayUpdateImageUrl(item?.updates || []) : "";
  const columnUrl = extractMondayImageUrl(item?.column_values?.[0]);

  return {
    itemId: item?.id || fallbackItemId,
    itemName: item?.name || "monday item",
    imageUrl: latestUpdateImageUrl || fallbackImageUrl || columnUrl,
    imageSource: latestUpdateImageUrl ? "latest_update" : "image_ref_link"
  };
}

function extractLatestMondayUpdateImageUrl(updates) {
  return [...updates]
    .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
    .flatMap((update) => update.assets || [])
    .map(getMondayAssetImageUrl)
    .find(Boolean) || "";
}

function getMondayAssetImageUrl(asset) {
  if (!asset) {
    return "";
  }

  const url = asset.public_url || asset.url || asset.url_thumbnail || "";
  const fileHint = `${asset.name || ""}.${asset.file_extension || ""}`;

  if (!url) {
    return "";
  }

  if (/\.(png|jpe?g|webp|gif|bmp|avif)(?:$|[?#])/i.test(fileHint) || asset.url_thumbnail) {
    return url;
  }

  return "";
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException("Cancelled.", "AbortError");
  }
}

async function createMondayUpdate(itemId, body, signal) {
  const mutation = `
    mutation CreateTalacherUpdate($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id
      }
    }
  `;
  const data = await mondayRequest(mutation, { itemId, body }, signal);
  return data.create_update;
}

async function uploadFileToMondayUpdate(updateId, image, signal) {
  const file = await fileFromMiroImage(image, signal);
  const query = `
    mutation AddTalacherFileToUpdate($file: File!) {
      add_file_to_update(update_id: ${JSON.stringify(updateId)}, file: $file) {
        id
        name
        url
        public_url
        url_thumbnail
      }
    }
  `;
  const formData = new FormData();
  formData.append("query", query);
  formData.append("map", JSON.stringify({ image: "variables.file" }));
  formData.append("image", file);
  const { mondayToken } = await chrome.storage.local.get("mondayToken");

  const response = await fetch("https://api.monday.com/v2/file", {
    method: "POST",
    headers: {
      "Authorization": mondayToken,
      "API-Version": "2025-04"
    },
    signal,
    body: formData
  });
  const body = await response.json();

  if (!response.ok || body.errors?.length) {
    throw new Error(body.errors?.[0]?.message || `monday file upload failed with HTTP ${response.status}.`);
  }

  return body.data.add_file_to_update;
}

async function fileFromMiroImage(image, signal) {
  throwIfAborted(signal);

  if (image.dataUrl) {
    const blob = dataUrlToBlob(image.dataUrl);
    return new File([blob], image.fileName || "miro-selection.png", {
      type: blob.type || image.mimeType || "image/png"
    });
  }

  if (image.sourceUrl) {
    const response = await fetch(image.sourceUrl, { cache: "no-store", signal });

    if (!response.ok) {
      throw new Error(`Could not download selected Miro image. HTTP ${response.status}.`);
    }

    const blob = await response.blob();
    return new File([blob], image.fileName || "miro-selection.png", {
      type: blob.type || image.mimeType || "image/png"
    });
  }

  throw new Error("No uploadable Miro image data was found.");
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mimeType = header.match(/^data:(.+?);base64$/)?.[1] || "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

async function updateImageRefLink(boardId, itemId, columnId, imageUrl, signal) {
  if (!columnId || !imageUrl) {
    return null;
  }

  const mutation = `
    mutation UpdateTalacherImageRef($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value
      ) {
        id
      }
    }
  `;

  return mondayRequest(mutation, {
    boardId,
    itemId,
    columnId,
    value: JSON.stringify(imageUrl)
  }, signal);
}

function setTextColumn(columnValues, columnId, value) {
  const trimmedValue = value?.trim();

  if (columnId && trimmedValue) {
    columnValues[columnId] = trimmedValue;
  }
}

async function setStatusColumns(columnValues, settings, payload, signal) {
  const selections = MONDAY_LABEL_COLUMN_KEYS
    .map((key) => ({
      key,
      columnId: settings.config.columns[key],
      label: (key === "status" ? payload.status || "Ready To Start" : payload[key] || "").trim()
    }))
    .filter((selection) => selection.columnId && selection.label);

  if (!selections.length) {
    return selections;
  }

  let liveColumns = await getMondayColumnLabelsOrNull(settings, { signal });

  if (liveColumns && selections.some((selection) => findMondayLabelId(liveColumns[selection.key], selection.label) === null)) {
    liveColumns = await getMondayColumnLabelsOrNull(settings, { force: true, signal }) || liveColumns;
  }

  for (const selection of selections) {
    const liveColumn = liveColumns?.[selection.key];

    if (!liveColumn) {
      // Live labels unavailable: fall back to the hardcoded index map.
      setStatusColumn(columnValues, selection.columnId, selection.label, MONDAY_STATUS_INDEXES[selection.key]);
      continue;
    }

    const labelId = findMondayLabelId(liveColumn, selection.label);

    if (labelId === null) {
      throw new Error(`${MONDAY_LABEL_COLUMN_TITLES[selection.key]}: "${selection.label}" is not an active label on the monday board. Reopen the form to load the current options.`);
    }

    columnValues[selection.columnId] = { index: labelId };
  }

  return selections;
}

async function getMondayColumnLabels(settings, { force = false, signal } = {}) {
  const { mondayColumnLabels } = await chrome.storage.local.get("mondayColumnLabels");
  const isFresh = mondayColumnLabels?.boardId === settings.config.boardId
    && Date.now() - mondayColumnLabels.fetchedAt < MONDAY_LABELS_CACHE_MS;

  if (isFresh && !force) {
    return mondayColumnLabels.columns;
  }

  const columns = await fetchMondayColumnLabels(settings.config, signal);
  await chrome.storage.local.set({
    mondayColumnLabels: {
      boardId: settings.config.boardId,
      fetchedAt: Date.now(),
      columns
    }
  });

  return columns;
}

async function getMondayColumnLabelsOrNull(settings, options) {
  try {
    return await getMondayColumnLabels(settings, options);
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }

    console.warn("Talacher could not load monday labels; using built-in label indexes.", error);
    return null;
  }
}

async function fetchMondayColumnLabels(config, signal) {
  const columnIds = MONDAY_LABEL_COLUMN_KEYS.map((key) => config.columns[key]).filter(Boolean);
  const variables = { boardId: [config.boardId], columnIds };

  // 2025-10 `settings` says which labels are deactivated; legacy `settings_str` carries the
  // label hex colors. Fetch both and merge whatever succeeds.
  const [modern, legacy] = await Promise.allSettled([
    mondayRequest(`
      query TalacherColumnLabels($boardId: [ID!], $columnIds: [String]) {
        boards(ids: $boardId) {
          columns(ids: $columnIds) { id title settings }
        }
      }
    `, variables, signal, { apiVersion: "2025-10" }),
    mondayRequest(`
      query TalacherColumnLabelsLegacy($boardId: [ID!], $columnIds: [String]) {
        boards(ids: $boardId) {
          columns(ids: $columnIds) { id title settings_str }
        }
      }
    `, variables, signal)
  ]);

  for (const outcome of [modern, legacy]) {
    if (outcome.status === "rejected" && outcome.reason?.name === "AbortError") {
      throw outcome.reason;
    }
  }

  const modernColumns = modern.status === "fulfilled" ? modern.value.boards?.[0]?.columns || [] : [];
  const legacyColumns = legacy.status === "fulfilled" ? legacy.value.boards?.[0]?.columns || [] : [];

  if (!modernColumns.length && !legacyColumns.length) {
    const reason = modern.reason || legacy.reason;
    throw reason || new Error("monday label columns were not found on the board.");
  }

  const result = {};

  for (const key of MONDAY_LABEL_COLUMN_KEYS) {
    const columnId = config.columns[key];
    const modernColumn = modernColumns.find((candidate) => candidate.id === columnId);
    const legacyColumn = legacyColumns.find((candidate) => candidate.id === columnId);
    const column = modernColumn || legacyColumn;

    if (!column) {
      continue;
    }

    const legacyColors = parseMondayLabelColors(legacyColumn?.settings_str);
    result[key] = {
      id: column.id,
      title: column.title,
      labels: parseMondayStatusLabels(modernColumn ? modernColumn.settings : legacyColumn.settings_str)
        .map((label) => ({
          ...label,
          color: legacyColors[label.id] || MONDAY_COLOR_NAMES[label.colorName] || null
        }))
    };
  }

  return result;
}

function parseMondayLabelColors(settingsStr) {
  try {
    const settings = JSON.parse(settingsStr || "{}");
    return Object.fromEntries(Object.entries(settings.labels_colors || {})
      .map(([id, value]) => [Number(id), value?.color])
      .filter(([, color]) => /^#[0-9a-f]{6}$/i.test(color || "")));
  } catch {
    return {};
  }
}

function parseMondayStatusLabels(rawSettings) {
  const settings = typeof rawSettings === "string" ? JSON.parse(rawSettings || "{}") : rawSettings || {};

  // API 2025-10+: labels is an array of { id, label, index, is_deactivated }.
  if (Array.isArray(settings.labels)) {
    return settings.labels
      .filter((label) => !label.is_deactivated && label.label?.trim())
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((label) => ({ id: Number(label.id), label: label.label, colorName: label.color }));
  }

  // Older settings_str: labels is a { id: text } map.
  const deactivated = new Set((settings.deactivated_labels || []).map(String));
  const positions = settings.labels_positions_v2 || {};

  return Object.entries(settings.labels || {})
    .filter(([id, text]) => !deactivated.has(id) && String(text).trim())
    .sort(([a], [b]) => (positions[a] ?? Number(a)) - (positions[b] ?? Number(b)))
    .map(([id, text]) => ({ id: Number(id), label: text }));
}

function findMondayLabelId(column, label) {
  if (!column?.labels) {
    return null;
  }

  const exact = column.labels.find((candidate) => candidate.label === label);

  if (exact) {
    return exact.id;
  }

  const normalized = normalizeMondayLabel(label);
  const loose = column.labels.find((candidate) => normalizeMondayLabel(candidate.label) === normalized);
  return loose ? loose.id : null;
}

function normalizeMondayLabel(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function setStatusColumn(columnValues, columnId, label, indexMap) {
  if (!columnId || !label) {
    return;
  }

  if (indexMap && Object.prototype.hasOwnProperty.call(indexMap, label)) {
    columnValues[columnId] = { index: indexMap[label] };
    return;
  }

  columnValues[columnId] = { label };
}

async function mondayRequest(query, variables, signal, { apiVersion = "2025-04" } = {}) {
  const { mondayToken } = await chrome.storage.local.get("mondayToken");

  if (!mondayToken) {
    throw new Error("monday API token is not configured. Open the extension popup and save it first.");
  }

  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Authorization": mondayToken,
      "API-Version": apiVersion,
      "Content-Type": "application/json"
    },
    signal,
    body: JSON.stringify({ query, variables })
  });

  const body = await response.json();

  if (!response.ok || body.errors?.length) {
    const message = body.errors?.[0]?.message?.replace(/\s*Please check our API documentation[\s\S]*$/i, "");
    throw new Error(message || `monday API request failed with HTTP ${response.status}.`);
  }

  return body.data;
}
