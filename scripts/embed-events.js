#!/usr/bin/env node
/**
 * Add embedding vectors to events.json for semantic search.
 * Uses Xenova/all-MiniLM-L6-v2 (384-dim). Run after parse.
 * node scripts/embed-events.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const eventsPath = path.join(projectRoot, "public", "events.json");

const MODEL = "Xenova/all-MiniLM-L6-v2";
const BATCH_SIZE = 32;
const MAX_TEXT_LEN = 512;

function getText(ev) {
  const m = (ev.embeddingText ?? ev.message)?.trim?.() ?? "";
  if (!m) return null;
  return m.length > MAX_TEXT_LEN ? m.slice(0, MAX_TEXT_LEN) : m;
}

async function main() {
  if (!fs.existsSync(eventsPath)) {
    console.error("events.json not found. Run: npm run parse");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(eventsPath, "utf-8"));
  const events = data.events ?? [];
  const withText = events.map((e, i) => ({ ev: e, i, text: getText(e) })).filter((x) => x.text);

  if (withText.length === 0) {
    console.log("No events with message text to embed.");
    return;
  }

  console.log(`Loading model ${MODEL}...`);
  const { pipeline } = await import("@xenova/transformers");
  const extractor = await pipeline("feature-extraction", MODEL, {
    pooling: "mean",
    normalize: true,
  });

  console.log(`Embedding ${withText.length} events...`);
  for (let i = 0; i < withText.length; i += BATCH_SIZE) {
    const batch = withText.slice(i, i + BATCH_SIZE);
    const texts = batch.map((b) => b.text);
    const out = await extractor(texts, { padding: true, truncation: true });
    const arr = Array.isArray(out.data) ? out.data : Array.from(out.data);
    const dim = out.dims?.[out.dims.length - 1] ?? 384;
    for (let j = 0; j < batch.length; j++) {
      const start = j * dim;
      batch[j].ev.embedding = Array.from(arr.slice(start, start + dim));
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, withText.length)} / ${withText.length}`);
  }
  console.log("");

  data.embeddingModel = MODEL;
  fs.writeFileSync(eventsPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`Wrote embeddings to ${eventsPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
