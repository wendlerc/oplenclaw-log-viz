#!/usr/bin/env node
/**
 * Download MiniLM model to public/models/ for local semantic search.
 * Fixes "JSON Parse error: Unrecognized token '<'" from Hugging Face CDN/CORS.
 * Run: node scripts/download-model.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
// Match hub.js localPath: localModelPath + "Xenova/all-MiniLM-L6-v2/" + filename
const modelDir = path.join(projectRoot, "public", "models", "Xenova", "all-MiniLM-L6-v2");

const BASE = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main";
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "vocab.txt",
  "onnx/model.onnx",
];

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res;
}

async function main() {
  fs.mkdirSync(modelDir, { recursive: true });
  fs.mkdirSync(path.join(modelDir, "onnx"), { recursive: true });

  for (const file of FILES) {
    const url = `${BASE}/${file}`;
    const dest = path.join(modelDir, file);
    if (fs.existsSync(dest)) {
      console.log(`  skip ${file}`);
      continue;
    }
    console.log(`  ${file}...`);
    const res = await download(url);
    const buf = await res.arrayBuffer();
    fs.writeFileSync(dest, new Uint8Array(buf));
  }

  console.log(`Model saved to ${modelDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
