// AI name suggestions for NFL UF items. Loaded into the background service worker with
// importScripts(). Real title pairs live in naming-data/items.json (git-ignored, exported from
// Studio with `npm run export-titles`); without it the AI works from the guide alone.

const NAMING_ITEM_TYPES = [
  "Animation", "ArmAccessory", "Back", "Backplate", "Cleat", "Emoji", "EndzoneEffect", "FBTexture", "FBTrail",
  "Facial", "Front", "Glove", "Hair", "Hand", "Hat", "HeadAccessory", "Helmet", "LegAccessory", "Mouthpiece",
  "Neck", "Pants", "Shell", "Shirt", "Shoulder", "Sock", "TeamDance", "Undershirt", "Visor", "Waist"
];

const NAMING_PROVIDERS = {
  gemini: { label: "Gemini", defaultModel: "gemini-2.5-flash" },
  groq: { label: "Groq", defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct" }
};

const NAMING_HISTORY_KEY = "talacherNamingHistory";
const NAMING_HISTORY_LIMIT = 100;
const NAMING_MAX_IMAGES = 4;

const NFL_UF_NAMING_GUIDE = `
You name cosmetic items for NFL Universe Football (NFL UF), a Roblox football game. Every item has two
display titles that players read together as one name: FirstTitle then SecondTitle.

STRUCTURE
- FirstTitle = the identity: theme, collection, team, character or modifier ("Zeus", "Cold Stare",
  "Black Hanging", "Cowboys", "God of Thunder").
- SecondTitle = what the item is: the item noun, often with one descriptive word ("Crown", "Snowboard",
  "Mouthguard", "Hanging Mouthguard", "Crop Top").
- Read together they must sound like a product name: "Cold Stare Snowboard", "Black Hanging Mouthguard".
- Length: FirstTitle 1-2 words (3 max). SecondTitle 1-2 words (3 max). Short and punchy beats descriptive.
- Title Case. No ALL CAPS (exception: Emoji items use "EMOJI" as the SecondTitle). No emoji, hashtags or
  quotes; apostrophes are fine ("Zeus'", "Odin's", "I'd Win").

SECONDTITLE NOUNS BY ITEM TYPE (use these words; they are how players recognise the slot)
- Visor: "Visor" or "<Word> Visor"; variant families put the finish here ("Red Tinted", "Purple Dented").
- Hat: Beanie, 9Fifty, Cap, Crown, Hat, Helmet, Commando. Hair: Hair, Afro, Buzz Cut, "Hair and Beard".
- Back: Guitar, Acoustic Guitar, Jetpack, Shield, Backpack, Skateboard, Snowboard, Wings, Staff, Speaker.
- Shirt: Top, Hoodie, Tee, Jacket, Crop Top, "Tee with Hoodie". Pants: Bottoms (plural). Front: Vest, Puffer Vest.
- Cleat: Cleats (plural). Glove: Gloves (plural). Mouthpiece: Mouthguard, Hanging Mouthguard.
- Backplate: Backplate. Helmet: Facemask. Shell: Shell. Neck: Chain, Necklace, Cuban.
- FBTexture: Football. FBTrail: Trail. ArmAccessory: Sleeve. Hand: Watch, Bracelet. Waist: Hand Warmer.
- Facial: Beard, Glasses, Shades, Mask, Shiesty. Emoji: EMOJI. Animation/TeamDance: the move's name.

PATTERNS THAT ARE NORMAL IN THE GAME
- Sets share one FirstTitle across pieces: "God of Thunder" Top / Bottoms / Cleats / Helmet.
- Variant families move the family name into FirstTitle and the variant into SecondTitle:
  "Meta Visor" / "Purple Dented", "Meta Visor" / "Red Tinted".
- Colour-led names put the colour first: "Pink Hanging" / "Mouthguard", "Green" / "Laurel Crown".
- NFL team items use the team NICKNAME, never the city: "Cowboys" / "Beanie", "Chiefs" / "Shield".
  Event drops add the event: "Bears Kickoff 2026" / "Tee with Hoodie", "SB LX", "NFL Draft 2026", "Pro Bowl".

THE VIBE
- Hype and confident, like sneaker and streetwear drops, mixed with football swagger and internet humour.
- Recurring flavours: mythology (Zeus, Hades, Neptune, Odin, Anubis, Medusa, Olympus, Bifrost, Valkyrie),
  streetwear (Delicacies, Anarchy, Tech, Y2K, Drip, Shiesty), football swagger and memes (Beast Mode,
  Big Motion, Show Time, Him, I'd Win, Show Up Show Out), seasonal (Candy Cane, Snowflake, Cranberry Pie,
  Pumpkin Eyes), materials and elements (Ice, Frost, Volcanic, Molten, Lava, Void, Stone, Neon, Animated).
- Name what the art actually shows, then give it a twist. Never generic ("New Item", "Cool Hat").
- Higher rarities (Diamond) get the boldest names; common items stay descriptive.
`.trim();

let namingCatalogPromise = null;

function loadNamingCatalog() {
  namingCatalogPromise ??= fetch(chrome.runtime.getURL("naming-data/items.json"))
    .then((response) => (response.ok ? response.json() : { items: [] }))
    .then((data) => data.items || [])
    .catch(() => []);
  return namingCatalogPromise;
}

function normalizeTitle(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleKey(firstTitle, secondTitle) {
  return `${normalizeTitle(firstTitle)}|${normalizeTitle(secondTitle)}`;
}

function formatCatalogExamples(catalog, itemTypeHint) {
  // Same-type examples first (most useful), then everything else for overall vibe and to avoid repeats.
  const sameType = catalog.filter((item) => item.itemType === itemTypeHint);
  const others = catalog.filter((item) => item.itemType !== itemTypeHint);
  const line = (item) => `${item.firstTitle} / ${item.secondTitle} (${item.itemType}${item.rarity ? `, ${item.rarity}` : ""})`;
  const sections = [];

  if (sameType.length) {
    sections.push(`Existing ${itemTypeHint} items:\n${sameType.map(line).join("\n")}`);
  }

  if (others.length) {
    sections.push(`Other existing items:\n${others.map(line).join("\n")}`);
  }

  return sections.join("\n\n");
}

function buildNamingPrompt({ notes, hint, itemTypeHint, count, imageCount, catalog }) {
  const lines = [
    `Suggest ${count} different name options for the NFL UF item shown in the ${imageCount} attached image(s).`,
    itemTypeHint ? `The item type is ${itemTypeHint}.` : "Work out the item type from the art.",
    notes.length ? `Notes written next to the art on the Miro board:\n${notes.map((note) => `- ${note}`).join("\n")}` : "",
    hint ? `Designer hint: ${hint}` : "",
    "Vary the options: mix safe descriptive names with bolder hype ones, and try different flavours.",
    "Never reuse an existing First/Second pair listed below. Sharing a FirstTitle with an existing set is fine when the item clearly belongs to that set.",
    `itemType must be one of: ${NAMING_ITEM_TYPES.join(", ")}.`,
    "Respond with JSON only: {\"suggestions\":[{\"firstTitle\":\"\",\"secondTitle\":\"\",\"itemType\":\"\",\"reason\":\"\"}]} where reason is one short sentence on why the name fits.",
    catalog.length ? `\n${formatCatalogExamples(catalog, itemTypeHint)}` : ""
  ];

  return lines.filter(Boolean).join("\n");
}

function splitDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  return match ? { mimeType: match[1], data: match[2] } : null;
}

async function callGeminiForNames({ apiKey, model, prompt, images }) {
  const parts = [{ text: prompt }];

  for (const image of images) {
    const split = splitDataUrl(image);

    if (split) {
      parts.push({ inline_data: { mime_type: split.mimeType, data: split.data } });
    }
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: NFL_UF_NAMING_GUIDE }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 1,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            suggestions: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  firstTitle: { type: "STRING" },
                  secondTitle: { type: "STRING" },
                  itemType: { type: "STRING", enum: NAMING_ITEM_TYPES },
                  reason: { type: "STRING" }
                },
                required: ["firstTitle", "secondTitle", "itemType", "reason"]
              }
            }
          },
          required: ["suggestions"]
        }
      }
    })
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Gemini: ${body.error?.message || `HTTP ${response.status}`}`);
  }

  return body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

async function callGroqForNames({ apiKey, model, prompt, images }) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: NFL_UF_NAMING_GUIDE },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...images.map((url) => ({ type: "image_url", image_url: { url } }))
          ]
        }
      ]
    })
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Groq: ${body.error?.message || `HTTP ${response.status}`}`);
  }

  return body.choices?.[0]?.message?.content || "";
}

function parseNameSuggestions(text) {
  const jsonText = String(text).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : null;
  }

  const list = Array.isArray(parsed) ? parsed : parsed?.suggestions;

  if (!Array.isArray(list) || !list.length) {
    throw new Error("The AI didn't return any name suggestions. Try again.");
  }

  return list
    .map((suggestion) => ({
      firstTitle: String(suggestion.firstTitle || suggestion.FirstTitle || "").replace(/\s+/g, " ").trim(),
      secondTitle: String(suggestion.secondTitle || suggestion.SecondTitle || "").replace(/\s+/g, " ").trim(),
      itemType: NAMING_ITEM_TYPES.find((type) => normalizeTitle(type) === normalizeTitle(suggestion.itemType || suggestion.ItemType)) || "",
      reason: String(suggestion.reason || "").trim()
    }))
    .filter((suggestion) => suggestion.secondTitle);
}

async function getNamingSettings() {
  const stored = await chrome.storage.local.get(["talacherAiProvider", "talacherAiKeys", "talacherAiModels"]);
  const provider = NAMING_PROVIDERS[stored.talacherAiProvider] ? stored.talacherAiProvider : "gemini";
  const keys = stored.talacherAiKeys || {};
  const models = stored.talacherAiModels || {};

  return {
    provider,
    model: models[provider] || NAMING_PROVIDERS[provider].defaultModel,
    apiKey: keys[provider] || "",
    configured: Object.fromEntries(Object.keys(NAMING_PROVIDERS).map((id) => [id, Boolean(keys[id])])),
    models: Object.fromEntries(Object.entries(NAMING_PROVIDERS).map(([id, info]) => [id, models[id] || info.defaultModel])),
    catalogSize: (await loadNamingCatalog()).length
  };
}

async function saveNamingSettings({ provider, apiKey, model }) {
  const stored = await chrome.storage.local.get(["talacherAiKeys", "talacherAiModels"]);
  const updates = {};

  if (provider && NAMING_PROVIDERS[provider]) {
    updates.talacherAiProvider = provider;

    if (typeof apiKey === "string" && apiKey.trim()) {
      updates.talacherAiKeys = { ...(stored.talacherAiKeys || {}), [provider]: apiKey.trim() };
    }

    if (typeof model === "string") {
      updates.talacherAiModels = { ...(stored.talacherAiModels || {}), [provider]: model.trim() || NAMING_PROVIDERS[provider].defaultModel };
    }
  }

  await chrome.storage.local.set(updates);
  return getNamingSettings();
}

async function suggestItemNames(request) {
  const settings = await getNamingSettings();

  if (!settings.apiKey) {
    throw new Error(`No ${NAMING_PROVIDERS[settings.provider].label} API key saved. Add one in the Talacher extension popup.`);
  }

  const catalog = await loadNamingCatalog();
  const images = (request.images || []).slice(0, NAMING_MAX_IMAGES);
  const notes = (request.notes || []).map((note) => String(note).trim()).filter(Boolean);
  const itemTypeHint = NAMING_ITEM_TYPES.includes(request.itemTypeHint) ? request.itemTypeHint : "";
  const count = Math.min(10, Math.max(3, Number(request.count) || 6));
  const prompt = buildNamingPrompt({ notes, hint: String(request.hint || "").trim(), itemTypeHint, count, imageCount: images.length, catalog });
  const call = settings.provider === "groq" ? callGroqForNames : callGeminiForNames;
  const startedAt = Date.now();
  const text = await call({ apiKey: settings.apiKey, model: settings.model, prompt, images });
  const existing = new Map(catalog.map((item) => [titleKey(item.firstTitle, item.secondTitle), item]));
  const seen = new Set();
  const suggestions = parseNameSuggestions(text)
    .filter((suggestion) => {
      const key = titleKey(suggestion.firstTitle, suggestion.secondTitle);
      return seen.has(key) ? false : seen.add(key);
    })
    .map((suggestion) => {
      const match = existing.get(titleKey(suggestion.firstTitle, suggestion.secondTitle));
      return match ? { ...suggestion, duplicateOf: `${match.firstTitle} / ${match.secondTitle} (${match.itemType})` } : suggestion;
    });

  const entry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    durationMs: Date.now() - startedAt,
    provider: settings.provider,
    model: settings.model,
    hint: String(request.hint || "").trim(),
    itemTypeHint,
    notes,
    thumbnails: (request.thumbnails || []).slice(0, NAMING_MAX_IMAGES),
    suggestions,
    used: null
  };
  await addNamingHistoryEntry(entry);
  return entry;
}

async function getNamingHistory() {
  const { [NAMING_HISTORY_KEY]: history } = await chrome.storage.local.get(NAMING_HISTORY_KEY);
  return Array.isArray(history) ? history : [];
}

async function addNamingHistoryEntry(entry) {
  const history = await getNamingHistory();
  await chrome.storage.local.set({ [NAMING_HISTORY_KEY]: [entry, ...history].slice(0, NAMING_HISTORY_LIMIT) });
}

async function markNamingSuggestionUsed({ entryId, firstTitle, secondTitle }) {
  const history = await getNamingHistory();
  const next = history.map((entry) => (entry.id === entryId ? { ...entry, used: { firstTitle, secondTitle, at: Date.now() } } : entry));
  await chrome.storage.local.set({ [NAMING_HISTORY_KEY]: next });
  return { ok: true };
}

async function deleteNamingHistory({ entryId } = {}) {
  const history = await getNamingHistory();
  await chrome.storage.local.set({ [NAMING_HISTORY_KEY]: entryId ? history.filter((entry) => entry.id !== entryId) : [] });
  return getNamingHistory();
}
