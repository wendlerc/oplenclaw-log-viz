#!/usr/bin/env node
/**
 * Add modification-focused summaries for md_write events.
 * Uses qwen/qwen3-vl-32b-instruct to parse out relevant content from boilerplate
 * (tool call JSON, chat templates) and summarize the actual modification.
 * Run after parse. Requires OPENROUTER_API_KEY.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const eventsPath = path.join(projectRoot, "public", "events.json");

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "qwen/qwen3-vl-32b-instruct";
const MAX_INPUT_CHARS = 12000; // enough for full edit content to produce concrete summaries
const DELAY_MS = 300;
const TARGET_FILES = ["SOUL.md", "AGENTS.md", "IDENTITY.md", "USER.md", "MEMORY.md", "HEARTBEAT.md"];

function truncate(text, maxLen = MAX_INPUT_CHARS) {
  const t = (text || "").trim();
  if (!t) return "";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

async function summarizeModification(apiKey, text, filename) {
  const truncated = truncate(text);
  if (!truncated) return null;

  const res = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{
        role: "user",
        content: `Parse this log message about a file write/edit. Strip tool call markup, JSON, chat templates, and boilerplate.

Your summary MUST describe the SPECIFIC CONTENT that was written — what topic, what was added or changed, concrete details. NEVER use generic phrases like "updated with context", "added information", "stored context", "updated memory", "wrote to file". Be concrete: e.g. "Added beads task to debug Discord DM" or "Recorded security test results vs Jarvis" or "Logged user preference for dark mode".

Return ONLY one sentence (max 18 words). If the message is just "Successfully wrote X bytes" with no content, return "Wrote X bytes".

File: ${filename}

Message:
${truncated}`,
      }],
      max_tokens: 80,
    }),
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  let summary = msg?.content?.trim();
  if (!summary && msg?.reasoning) {
    const r = msg.reasoning.trim();
    const m = r.match(/ANSWER:?\s*\n?(.+?)(?:\n|$)/s);
    summary = m ? m[1].trim().slice(0, 100) : r.slice(-80).trim();
  }
  return summary || null;
}

const LIMIT = parseInt(process.env.LIMIT || "0", 10) || 0;
const FORCE = process.env.FORCE === "1" || process.env.FORCE === "true";
const SAVE_INTERVAL = 50;

async function runBatch(apiKey, data, eventsPath) {
  const events = data.events ?? [];
  let mdWrites = events
    .filter(e => e.type === "md_write" && TARGET_FILES.includes(e.category) && e.message?.trim())
    .filter(e => FORCE || !e.modSummary);
  if (FORCE) mdWrites.forEach(e => delete e.modSummary);
  if (mdWrites.length === 0) return { ok: 0, err: 0 };
  if (LIMIT > 0) mdWrites = mdWrites.slice(0, LIMIT);

  let ok = 0, err = 0;
  for (let i = 0; i < mdWrites.length; i++) {
    const ev = mdWrites[i];
    await new Promise(r => setTimeout(r, DELAY_MS));
    try {
      const s = await summarizeModification(apiKey, ev.message, ev.category);
      if (s) {
        ev.modSummary = s;
        ok++;
      }
    } catch (e) {
      err++;
      console.error(`Error: ${e.message}`);
    }
    process.stdout.write(`\r${ok} ok, ${err} err (${i + 1}/${mdWrites.length})`);
    if ((i + 1) % SAVE_INTERVAL === 0) {
      fs.writeFileSync(eventsPath, JSON.stringify(data, null, 2), "utf-8");
    }
  }
  return { ok, err };
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Set OPENROUTER_API_KEY");
    process.exit(1);
  }
  if (!fs.existsSync(eventsPath)) {
    console.error("events.json not found. Run: npm run parse");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(eventsPath, "utf-8"));
  const before = data.events.filter(e => e.type === "md_write" && e.modSummary).length;
  console.log(`Model: ${MODEL}`);
  console.log(`Adding modSummary for md_write events (target files). Existing: ${before}`);
  if (LIMIT > 0) console.log(`Test mode: limiting to ${LIMIT} events`);

  const { ok, err } = await runBatch(apiKey, data, eventsPath);
  fs.writeFileSync(eventsPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`\nDone. ${ok} summaries, ${err} errors. Wrote ${eventsPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
