#!/usr/bin/env node
/**
 * Build a standalone deployable dashboard for static hosting (GitHub Pages, etc.).
 * Output: deploy/ with index.html and events-slim.json — no server required.
 * Redacts secrets (Discord tokens, GitHub PATs, etc.) before deploy.
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

/** Redact common secret patterns to avoid pushing to public repos. */
function redactSecrets(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/ghp_[A-Za-z0-9\\|_"$]+/g, "[REDACTED]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED]")
    .replace(/\b[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}\b/g, "[REDACTED]") // Discord bot token
    .replace(/\b[A-Za-z0-9_-]{59,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}\b/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{48,}/g, "[REDACTED]")
    .replace(/sk-proj-[A-Za-z0-9]{48,}/g, "[REDACTED]");
}

/** Recursively redact all string values in an object. */
function redactObject(obj) {
  if (typeof obj === "string") return redactSecrets(obj);
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = redactObject(v);
    return out;
  }
  return obj;
}

if (!fs.existsSync(eventsPath)) {
  console.error("events-slim.json not found. Run: npm run parse && npm run slim");
  process.exit(1);
}

fs.mkdirSync(deployDir, { recursive: true });

// Copy events-slim.json with secret redaction (recursive to catch nested strings)
const data = JSON.parse(fs.readFileSync(eventsPath, "utf-8"));
data.events = (data.events || []).map(redactObject);
if (data.summary && typeof data.summary === "object") {
  data.summary = redactObject(data.summary);
}
fs.writeFileSync(path.join(deployDir, "events-slim.json"), JSON.stringify(data, null, 2), "utf-8");

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
