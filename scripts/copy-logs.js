#!/usr/bin/env node
/**
 * Move logs from common moltbot/openclaw locations into bot-log-analysis/logs/
 * Run: node scripts/copy-logs.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const logsDir = path.join(projectRoot, "logs");

const SOURCES = [
  process.env.OPENCLAW_LOG_DIR,
  path.join(process.env.HOME || "~", "Downloads", "chat-and-cron-logs"),
  path.join(process.env.HOME || "~", "Downloads", "moltbot-chat-logs", "chat-and-cron-logs"),
  path.join(process.env.HOME || "~", "Downloads", "moltbot-chat-logs"),
  "/tmp/openclaw",
  path.join(process.env.HOME || "~", ".openclaw"),
].filter(Boolean);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isLogFile(name) {
  return name.endsWith(".log") || name.endsWith(".jsonl") || name === "openclaw.log";
}

function moveLogs(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return 0;
  let count = 0;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const src = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(src);
        continue;
      }
      if (e.isFile() && isLogFile(e.name)) {
        const relative = path.relative(srcDir, src);
        const dest = path.join(destDir, relative);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        try {
          fs.renameSync(src, dest);
        } catch {
          fs.copyFileSync(src, dest);
          fs.unlinkSync(src);
        }
        count++;
      }
    }
  }
  walk(srcDir);
  return count;
}

ensureDir(logsDir);
let total = 0;
for (const src of SOURCES) {
  const expanded = src.replace("~", process.env.HOME || "");
  const n = moveLogs(expanded, logsDir);
  if (n > 0) {
    console.log(`Moved ${n} log file(s) from ${expanded}`);
    total += n;
  }
}
if (total === 0) {
  console.log("No logs found at:", SOURCES.map((s) => s.replace("~", process.env.HOME || "")));
  console.log("Place your openclaw log files (e.g. openclaw-YYYY-MM-DD.log) in ./logs/");
} else {
  console.log(`Total: ${total} log files in ./logs/`);
}
