const statusEl = document.getElementById("devStatus");
const button = document.getElementById("checkReload");
const tokenInput = document.getElementById("mondayToken");
const saveButton = document.getElementById("saveSettings");
const fetchButton = document.getElementById("fetchSchema");
const settingsStatus = document.getElementById("settingsStatus");
const saveReadyTagButton = document.getElementById("saveReadyTag");
const readyTagStatus = document.getElementById("readyTagStatus");
const previewDelayInput = document.getElementById("previewDelay");
const savePreviewDelayButton = document.getElementById("savePreviewDelay");
const previewDelayStatus = document.getElementById("previewDelayStatus");

function sendMessage(message) {
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

function sendTabMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) {
        reject(new Error("No active tab found."));
        return;
      }

      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || "Tab request failed."));
          return;
        }

        resolve(response.result);
      });
    });
  });
}

async function loadSettings() {
  try {
    const settings = await sendMessage({ type: "TALACHER_GET_SETTINGS" });
    const { talacherReadyTag, talacherPreviewDelayMs } = await chrome.storage.local.get(["talacherReadyTag", "talacherPreviewDelayMs"]);
    settingsStatus.textContent = settings.tokenConfigured
      ? `Token saved. Default group: ${settings.config.groupTitle}.`
      : "No monday token saved yet.";
    readyTagStatus.textContent = talacherReadyTag?.savedAt
      ? `Ready tag saved.`
      : "No ready tag saved yet.";
    previewDelayInput.value = String(Number.isFinite(talacherPreviewDelayMs) ? talacherPreviewDelayMs : 500);
    previewDelayStatus.textContent = `Preview delay is ${previewDelayInput.value} ms.`;
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
}

async function saveSettings() {
  const token = tokenInput.value.trim();

  if (!token) {
    settingsStatus.textContent = "Paste a monday token first.";
    return;
  }

  saveButton.disabled = true;
  settingsStatus.textContent = "Saving token...";

  try {
    const settings = await sendMessage({
      type: "TALACHER_SAVE_SETTINGS",
      settings: { token }
    });
    tokenInput.value = "";
    settingsStatus.textContent = `Token saved. Default group: ${settings.config.groupTitle}.`;
  } catch (error) {
    settingsStatus.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
}

async function fetchSchema() {
  fetchButton.disabled = true;
  settingsStatus.textContent = "Fetching monday board...";

  try {
    const schema = await sendMessage({ type: "TALACHER_FETCH_BOARD_SCHEMA" });
    settingsStatus.textContent = `Fetched ${schema.groups.length} groups from ${schema.board.name}.`;
  } catch (error) {
    settingsStatus.textContent = error.message;
  } finally {
    fetchButton.disabled = false;
  }
}

async function saveReadyTagFromTab() {
  saveReadyTagButton.disabled = true;
  readyTagStatus.textContent = "Saving selected Miro element...";

  try {
    const result = await sendTabMessage({ type: "TALACHER_SAVE_READY_TAG_FROM_SELECTION" });
    readyTagStatus.textContent = result?.saved
      ? "Ready tag saved."
      : "Could not save ready tag from this tab.";
  } catch (error) {
    readyTagStatus.textContent = "Open Miro, select the ready tag, then try again.";
  } finally {
    saveReadyTagButton.disabled = false;
  }
}

async function savePreviewDelay() {
  const value = Math.max(0, Math.min(3000, Number(previewDelayInput.value) || 500));
  await chrome.storage.local.set({ talacherPreviewDelayMs: value });
  previewDelayInput.value = String(value);
  previewDelayStatus.textContent = `Preview delay is ${value} ms.`;
}

async function checkDevWatcher() {
  try {
    const response = await fetch("http://127.0.0.1:17321/version", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    statusEl.textContent = `Dev watcher online. Version ${payload.version}.`;
  } catch (error) {
    statusEl.textContent = "Dev watcher offline. Run npm run dev.";
  }
}

button.addEventListener("click", checkDevWatcher);
saveButton.addEventListener("click", saveSettings);
fetchButton.addEventListener("click", fetchSchema);
saveReadyTagButton.addEventListener("click", saveReadyTagFromTab);
savePreviewDelayButton.addEventListener("click", savePreviewDelay);
checkDevWatcher();
loadSettings();
