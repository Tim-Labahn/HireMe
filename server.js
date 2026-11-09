"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const publicFiles = new Set(["index.html", "style.css", "app.js", "pdf-import.js"]);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream", ".ttf": "font/ttf" };
const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { response.writeHead(400).end("Ungültige Adresse"); return; }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  const vendor = path.resolve(root, "vendor") + path.sep;
  if (!publicFiles.has(relative) && !file.startsWith(vendor)) { response.writeHead(404).end("Nicht gefunden"); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Datei konnte nicht geladen werden"); return; }
    response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
    response.end(data);
  });
});
server.on("error", error => { console.error("Der lokale Server konnte nicht gestartet werden:", error.message); process.exitCode = 1; });
server.listen(4173, "127.0.0.1", () => console.log("HireMe: http://127.0.0.1:4173"));
