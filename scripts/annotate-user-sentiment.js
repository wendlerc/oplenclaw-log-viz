#!/usr/bin/env node
/**
 * Annotate user_message events with sentiment (very_delighted, delighted, neutral, upset, very_upset).
 * Uses OpenRouter for instruction-following model.
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
const MAX_INPUT_CHARS = 2000;
const DELAY_MS = 300;

const SENTIMENT_LABELS = ["very_delighted", "delighted", "neutral", "upset", "very_upset"];

function truncate(text, maxLen = MAX_INPUT_CHARS) {
  const t = (text || "").trim();
  if (!t) return "";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

async function annotateSentiment(apiKey, text) {
  const truncated = truncate(text);
  if (!truncated) return "neutral";

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
        content: `Classify the sentiment of this user message to an AI agent. The user is talking to their AI assistant.

Return EXACTLY one of these labels:

- very_delighted: user is complimenting, praising, expressing excitement ("this is awesome!", "you're amazing", "incredible work")
- delighted: user is pleased, satisfied, positive ("thanks!", "nice", "perfect", "good job")
- neutral: factual, question, instruction, or unclear sentiment

- upset: user is frustrated, annoyed, or disappointed ("this isn't working", "why did you...", "come on")
- very_upset: user is angry, strongly criticizing, or expressing extreme frustration ("this is terrible", "you're useless", "I'm done")

Message:
${truncated}`,
      }],
      max_tokens: 20,
    }),
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  let label = msg?.content?.trim()?.toLowerCase().replace(/\s+/g, "_");
  if (!label || !SENTIMENT_LABELS.includes(label)) {
    const match = label?.match(SENTIMENT_LABELS.join("|"));
    label = match ? match[0] : "neutral";
  }
  return label;
}

const LIMIT = parseInt(process.env.LIMIT || "0", 10) || 0;
const FORCE = process.env.FORCE === "1" || process.env.FORCE === "true";
const SAVE_INTERVAL = 50;

async function runBatch(apiKey, data, eventsPath) {
  const events = data.events ?? [];
  let userMsgs = events
    .filter(e => e.type === "user_message" && e.message?.trim())
    .filter(e => FORCE || !e.sentiment);
  if (FORCE) userMsgs.forEach(e => delete e.sentiment);
  if (userMsgs.length === 0) return { ok: 0, err: 0 };
  if (LIMIT > 0) userMsgs = userMsgs.slice(0, LIMIT);

  let ok = 0, err = 0;
  for (let i = 0; i < userMsgs.length; i++) {
    const ev = userMsgs[i];
    await new Promise(r => setTimeout(r, DELAY_MS));
    try {
      const s = await annotateSentiment(apiKey, ev.message);
      ev.sentiment = s;
      ok++;
    } catch (e) {
      err++;
      ev.sentiment = "neutral";
      console.error(`Error: ${e.message}`);
    }
    process.stdout.write(`\r${ok} ok, ${err} err (${i + 1}/${userMsgs.length})`);
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
  const before = data.events.filter(e => e.type === "user_message" && e.sentiment).length;
  console.log(`Model: ${MODEL}`);
  console.log(`Annotating user_message sentiment. Existing: ${before}`);
  if (LIMIT > 0) console.log(`Test mode: limiting to ${LIMIT} events`);

  const { ok, err } = await runBatch(apiKey, data, eventsPath);
  fs.writeFileSync(eventsPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`\nDone. ${ok} annotated, ${err} errors. Wrote ${eventsPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
