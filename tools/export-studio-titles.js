// Exports FirstTitle/SecondTitle examples from item ModuleScripts open in Roblox Studio into
// naming-data/items.json (git-ignored) for the AI name suggestions.
//
// Read-only: it talks to Studio's built-in MCP bridge (StudioMCP.exe) and refuses any tool that is
// not in READ_ONLY_TOOLS. Studio needs the MCP server enabled (Assistant settings) and the place
// with the item scripts open.
//
// Usage: npm run export-titles [-- --path Workspace] [-- --studio "UF:Logging"]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const READ_ONLY_TOOLS = new Set(["list_roblox_studios", "search_game_tree", "script_read"]);
const OUTPUT = path.join(__dirname, "..", "naming-data", "items.json");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const rootPath = option("path", "Workspace");
const studioFilter = option("studio", "");

function findStudioMcp() {
  const versions = path.join(process.env.LOCALAPPDATA || "", "Roblox", "Versions");
  const candidates = fs.existsSync(versions)
    ? fs.readdirSync(versions)
      .map((name) => path.join(versions, name, "StudioMCP.exe"))
      .filter((file) => fs.existsSync(file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];

  if (!candidates.length) {
    throw new Error("StudioMCP.exe not found. Open Roblox Studio and enable its MCP server in Assistant settings.");
  }

  return candidates[0];
}

function createClient(exe) {
  const child = spawn(exe, [], { stdio: ["pipe", "pipe", "ignore"] });
  const pending = new Map();
  let buffer = "";
  let nextId = 0;

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;

    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);

      try {
        const message = line ? JSON.parse(line) : null;

        if (message?.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        }
      } catch {
        // Ignore non-JSON log lines.
      }
    }
  });

  function request(method, params = {}) {
    const id = ++nextId;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 120000);
    });
  }

  async function callTool(name, toolArgs) {
    if (!READ_ONLY_TOOLS.has(name)) {
      throw new Error(`Refusing to call "${name}": not a read-only tool.`);
    }

    const response = await request("tools/call", { name, arguments: toolArgs });

    if (response.error || response.result?.isError) {
      throw new Error(`${name} failed: ${JSON.stringify(response.error || response.result?.content)}`);
    }

    return (response.result?.content || []).map((part) => part.text || "").join("\n");
  }

  return { request, callTool, close: () => child.kill(), notify: (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`) };
}

function parseField(source, field) {
  const match = new RegExp(`\\b${field}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([A-Za-z0-9_.+-]+))`).exec(source);
  return match ? (match[1] ?? match[2]) : undefined;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const client = createClient(findStudioMcp());

  try {
    await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "talacher-export-titles", version: "1.0" }
    });
    client.notify("notifications/initialized");

    // Studio connects to the bridge a few seconds after it starts.
    let studio = null;

    for (let attempt = 0; attempt < 12 && !studio; attempt += 1) {
      await sleep(2500);
      const { studios } = JSON.parse(await client.callTool("list_roblox_studios", {}));
      studio = studios.find((candidate) => !studioFilter || candidate.name.includes(studioFilter)) || null;
    }

    if (!studio) {
      throw new Error("No Roblox Studio connected. Check that the place is open and the MCP server is enabled.");
    }

    console.log(`Reading item scripts from ${studio.name} under ${rootPath}...`);
    const treeText = await client.callTool("search_game_tree", {
      studio_id: studio.id,
      datamodel_type: "Edit",
      path: rootPath,
      instance_type: "ModuleScript",
      max_depth: 10,
      head_limit: 50000
    });
    const modules = JSON.parse(treeText.slice(treeText.indexOf("["))).filter((node) => node.className === "ModuleScript");
    const items = [];
    const seen = new Set();
    const skipped = [];

    for (const [index, module] of modules.entries()) {
      let source;

      try {
        source = await client.callTool("script_read", { studio_id: studio.id, target_file: module.fullPath });
      } catch {
        // e.g. names containing "." can't be addressed by a dotted path.
        skipped.push(module.fullPath);
        continue;
      }

      const itemType = parseField(source, "ItemType");
      const firstTitle = (parseField(source, "FirstTitle") || "").replace(/\s+/g, " ").trim();
      const secondTitle = (parseField(source, "SecondTitle") || "").replace(/\s+/g, " ").trim();
      const key = `${firstTitle}|${secondTitle}|${itemType}`.toLowerCase();

      if (itemType && secondTitle && !/\btest\b/i.test(`${firstTitle} ${secondTitle}`) && !seen.has(key)) {
        seen.add(key);
        const parts = module.fullPath.split(".");
        items.push({
          firstTitle,
          secondTitle,
          itemType,
          rarity: (parseField(source, "Rarity") || "").replace(/^./, (character) => character.toUpperCase()),
          event: parseField(source, "Event") || "",
          collection: parts.length > 2 ? parts[parts.length - 2] : "",
          isNFL: parseField(source, "IsNFL") === "Yes"
        });
      }

      if ((index + 1) % 50 === 0) {
        console.log(`  ${index + 1}/${modules.length}`);
      }
    }

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify({ source: studio.name, exportedAt: new Date().toISOString(), items }, null, 1));
    console.log(`Wrote ${items.length} title examples to ${path.relative(process.cwd(), OUTPUT)}. Reload the extension to use them.`);

    if (skipped.length) {
      console.log(`Skipped ${skipped.length} script(s) Studio couldn't read: ${skipped.join(", ")}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    client.close();
  }
})();
