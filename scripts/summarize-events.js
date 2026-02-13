#!/usr/bin/env node
import "dotenv/config";
/**
 * Precompute summaries for md_write events using OpenRouter API.
 * Run once after parse. Requires OPENROUTER_API_KEY.
 * Uses parallel requests (concurrency limit) for speed.
 *
 * node scripts/summarize-events.js
 * LIMIT=10 node scripts/summarize-events.js   # test run first (10 summaries)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const eventsPath = path.join(projectRoot, "public", "events.json");

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "meta-llama/llama-3.2-3b-instruct";
const MAX_INPUT_CHARS = 1500;
const CONCURRENCY = 20;
const DELAY_MS = 400; // Delay between requests to avoid rate limits
const SAVE_INTERVAL = 50;
const BAR_WIDTH = 40;
const LIMIT = parseInt(process.env.LIMIT || "0", 10) || 0;
const TEST_FIRST = process.env.TEST_FIRST === "1" || process.env.TEST_FIRST === "true";

function truncate(text, maxLen = MAX_INPUT_CHARS) {
  const t = (text || "").trim();
  if (!t) return "";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

async function summarizeText(apiKey, text) {
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
      messages: [
        {
          role: "user",
          content: `Summarize this in one short sentence (max 15 words):\n\n${truncated}`,
        },
      ],
      max_tokens: 60,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  let summary = msg?.content?.trim();
  if (!summary && msg?.reasoning) {
    // stepfun puts output in reasoning; prefer content after "ANSWER:" or use last complete sentence
    const r = msg.reasoning.trim();
    const answerMatch = r.match(/ANSWER:?\s*\n?(.+?)(?:\n|$)/s);
    if (answerMatch) {
      summary = answerMatch[1].trim().slice(0, 100);
    } else {
      const sentences = r.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 10 && s.length < 120);
      summary = sentences.length ? (sentences[sentences.length - 1] + ".").slice(0, 100) : r.slice(-100).trim();
    }
  }
  return summary || null;
}

function progressBar(done, total, extras = "") {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const filled = Math.round((done / total) * BAR_WIDTH) || 0;
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  return `\r[${bar}] ${pct}% ${done}/${total}${extras ? `  ${extras}` : ""}   `;
}

function runWithConcurrency(tasks, concurrency, items, { onProgress, onComplete }) {
  return new Promise((resolve) => {
    const results = new Array(tasks.length);
    let index = 0;
    let completed = 0;
    let okCount = 0;
    let errCount = 0;

    function runNext() {
      if (index >= tasks.length) return;
      if (completed === tasks.length) {
        resolve(results);
        return;
      }

      const i = index++;
      const task = tasks[i];
      const item = items[i];

      const exec = () => task()
        .then((value) => {
          results[i] = { ok: true, value };
          okCount++;
          if (value && item?.ev) item.ev.summary = value;
          if (onComplete) onComplete(completed + 1);
        })
        .catch((err) => {
          results[i] = { ok: false, error: err };
          errCount++;
          if (onComplete) onComplete(completed + 1);
        })
        .finally(() => {
          completed++;
          if (onProgress) onProgress(completed, tasks.length, okCount, errCount);
          if (completed === tasks.length) resolve(results);
          else runNext();
        });

      if (i > 0) setTimeout(exec, DELAY_MS);
      else exec();
    }

    for (let j = 0; j < Math.min(concurrency, tasks.length); j++) {
      runNext();
    }
  });
}

async function runBatch(apiKey, data, limit = 0) {
  const events = data.events ?? [];
  const mdWrites = events
    .map((e, i) => ({ ev: e, i }))
    .filter(({ ev }) => ev.type === "md_write" && ev.message?.trim());

  let toSummarize = mdWrites.filter(({ ev }) => !ev.summary);
  if (toSummarize.length === 0) return { okCount: 0, errCount: 0, total: 0 };

  if (limit > 0) toSummarize = toSummarize.slice(0, limit);

  const tasks = toSummarize.map(({ ev }) => () => summarizeText(apiKey, ev.message));
  const start = Date.now();

  const results = await runWithConcurrency(tasks, CONCURRENCY, toSummarize, {
    onProgress: (done, total, okCount, errCount) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      process.stdout.write(progressBar(done, total, `${okCount} ok, ${errCount} err | ${elapsed}s`));
    },
    onComplete: (done) => {
      if (done % SAVE_INTERVAL === 0) {
        fs.writeFileSync(eventsPath, JSON.stringify(data, null, 2), "utf-8");
      }
    },
  });

  let okCount = 0;
  let errCount = 0;
  for (const r of results) {
    if (r.ok && r.value) okCount++;
    else if (!r.ok) errCount++;
  }

  fs.writeFileSync(eventsPath, JSON.stringify(data, null, 2), "utf-8");
  return { okCount, errCount, total: results.length };
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Set OPENROUTER_API_KEY env var. Get one at https://openrouter.ai/keys");
    process.exit(1);
  }

  if (!fs.existsSync(eventsPath)) {
    console.error("events.json not found. Run: npm run parse");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(eventsPath, "utf-8"));
  const events = data.events ?? [];
  const mdWrites = events
    .map((e, i) => ({ ev: e, i }))
    .filter(({ ev }) => ev.type === "md_write" && ev.message?.trim());
  const toSummarize = mdWrites.filter(({ ev }) => !ev.summary);

  if (toSummarize.length === 0) {
    console.log("All md_write events already have summaries.");
    return;
  }

  const effectiveLimit = LIMIT > 0 ? LIMIT : 0;
  const doTestFirst = TEST_FIRST && effectiveLimit === 0;

  if (doTestFirst) {
    console.log("TEST: Running 10 summaries first...\n");
    const test = await runBatch(apiKey, data, 10);
    process.stdout.write("\n");
    if (test.errCount > 0 || test.okCount === 0) {
      console.error(`Test failed: ${test.okCount} ok, ${test.errCount} errors. Fix before full run.`);
      process.exit(1);
    }
    console.log(`Test OK (${test.okCount} summaries). Running full batch...\n`);
  }

  if (effectiveLimit > 0 && !doTestFirst) {
    console.log(`TEST MODE: Limiting to ${effectiveLimit} summaries.\n`);
  }

  const { okCount, errCount, total } = await runBatch(apiKey, data, doTestFirst ? 0 : effectiveLimit);
  process.stdout.write("\n");
  console.log(`Done. ${okCount} summaries, ${errCount} errors. Wrote to ${eventsPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
