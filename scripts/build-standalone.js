#!/usr/bin/env node
/**
 * Build a standalone deployable dashboard for static hosting (GitHub Pages, etc.).
 * Output: deploy/ with index.html and events-slim.json — no server required.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const deployDir = path.join(projectRoot, "deploy");
const publicDir = path.join(projectRoot, "public");

const eventsPath = path.join(publicDir, "events-slim.json");
const viewPath = path.join(publicDir, "md-edits-view.html");

if (!fs.existsSync(eventsPath)) {
  console.error("events-slim.json not found. Run: npm run parse && npm run slim");
  process.exit(1);
}

fs.mkdirSync(deployDir, { recursive: true });

// Copy events-slim.json
fs.copyFileSync(eventsPath, path.join(deployDir, "events-slim.json"));

// Copy HTML, replace fetch path for standalone (relative URL)
let html = fs.readFileSync(viewPath, "utf-8");
html = html.replace('fetch("/events-slim.json")', 'fetch("./events-slim.json")');
html = html.replace("<title>MD File Edits</title>", "<title>MD File Edits — Bot Log Analysis</title>");
fs.writeFileSync(path.join(deployDir, "index.html"), html);

const size = (fs.statSync(path.join(deployDir, "events-slim.json")).size / 1024 / 1024).toFixed(1);
console.log(`Standalone build → deploy/`);
console.log(`  index.html`);
console.log(`  events-slim.json (${size} MB)`);
console.log(`\nUpload to GitHub Pages: copy deploy/* to your repo or enable Pages on deploy/`);
console.log(`Link from bots.baulab.info: add a link to your deployed URL`);
