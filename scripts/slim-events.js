#!/usr/bin/env node
/**
 * Create a slim events.json for fast dashboard loading.
 * Strips embeddings and truncates long messages to reduce parse time.
 * Run after parse/embed/summarize: node scripts/slim-events.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const inputPath = path.join(projectRoot, "public", "events.json");
const outputPath = path.join(projectRoot, "public", "events-slim.json");

const MAX_MESSAGE_LEN = 400;
const MAX_MESSAGE_LEN_MD_WRITE = 50000; // keep full content for md_write (modal view)

function slimEvent(e) {
  const { embedding, embeddingText, ...rest } = e;
  let message = rest.message ?? "";
  const maxLen = e.type === "md_write" ? MAX_MESSAGE_LEN_MD_WRITE : MAX_MESSAGE_LEN;
  if (message.length > maxLen) {
    message = message.slice(0, maxLen) + "…";
  }
  return { ...rest, message }; // keeps summary, modSummary, bytes
}

if (!fs.existsSync(inputPath)) {
  console.error("events.json not found. Run: npm run parse");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
const slimEvents = (data.events ?? []).map(slimEvent);
const output = { events: slimEvents, summary: data.summary ?? {} };

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

const inputSize = (fs.statSync(inputPath).size / 1024 / 1024).toFixed(1);
const outputSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
console.log(`Slim: ${inputSize}MB → ${outputSize}MB (${slimEvents.length} events)`);
console.log(`Output: ${outputPath}`);
