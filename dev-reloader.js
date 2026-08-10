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
    imageRefLink: "text_mm63k2nn"
  }
};

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
    .map((group) => ({ id: group.id, title: group.title }));

  const defaultGroup = groups.find((group) => group.title === DEFAULT_MONDAY_CONFIG.groupTitle) || groups[0];
  const nextConfig = {
    ...settings.config,
    boardId: board.id,
    groupId: settings.config.groupId || defaultGroup?.id || DEFAULT_MONDAY_CONFIG.groupId,
    groupTitle: groups.find((group) => group.id === settings.config.groupId)?.title || defaultGroup?.title || DEFAULT_MONDAY_CONFIG.groupTitle
  };

  await chrome.storage.local.set({
    mondayGroups: groups,
    mondayConfig: nextConfig
  });

  return {
    board: { id: board.id, name: board.name },
    groups,
    columns: board.columns,
    config: nextConfig
  };
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
  setStatusColumn(columnValues, config.columns.priority, payload.priority, MONDAY_STATUS_INDEXES.priority);
  setStatusColumn(columnValues, config.columns.status, payload.status || "Ready To Start", MONDAY_STATUS_INDEXES.status);
  setStatusColumn(columnValues, config.columns.assetType, payload.assetType, MONDAY_STATUS_INDEXES.assetType);
  setStatusColumn(columnValues, config.columns.rarity, payload.rarity, MONDAY_STATUS_INDEXES.rarity);

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

  const data = await mondayRequest(mutation, {
    boardId: config.boardId,
    groupId: config.groupId,
    itemName: firstTitle,
    columnValues: JSON.stringify(columnValues)
  }, signal);

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

async function mondayRequest(query, variables, signal) {
  const { mondayToken } = await chrome.storage.local.get("mondayToken");

  if (!mondayToken) {
    throw new Error("monday API token is not configured. Open the extension popup and save it first.");
  }

  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Authorization": mondayToken,
      "API-Version": "2025-04",
      "Content-Type": "application/json"
    },
    signal,
    body: JSON.stringify({ query, variables })
  });

  const body = await response.json();

  if (!response.ok || body.errors?.length) {
    throw new Error(body.errors?.[0]?.message || `monday API request failed with HTTP ${response.status}.`);
  }

  return body.data;
}
