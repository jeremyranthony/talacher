const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const rootDir = __dirname;
const port = 17321;
let version = Date.now();
let debounceTimer = null;

const ignored = new Set([".git", "node_modules"]);

function touchVersion(filePath) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    version = Date.now();
    const relativePath = path.relative(rootDir, filePath || rootDir) || ".";
    console.log(`Reload signal ${version}: ${relativePath}`);
  }, 80);
}

function watchDirectory(dir) {
  fs.watch(dir, { persistent: true }, (_eventType, fileName) => {
    if (!fileName || ignored.has(fileName)) {
      return;
    }

    const changedPath = path.join(dir, fileName.toString());
    touchVersion(changedPath);

    if (fs.existsSync(changedPath) && fs.statSync(changedPath).isDirectory()) {
      watchTree(changedPath);
    }
  });
}

function watchTree(dir) {
  const baseName = path.basename(dir);

  if (ignored.has(baseName)) {
    return;
  }

  watchDirectory(dir);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      watchTree(path.join(dir, entry.name));
    }
  }
}

const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");

  if (request.url === "/version") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ version }));
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not found");
});

watchTree(rootDir);

server.listen(port, "127.0.0.1", () => {
  console.log(`Dev reload watcher running at http://127.0.0.1:${port}`);
  console.log("Load this folder as an unpacked extension in chrome://extensions");
});
