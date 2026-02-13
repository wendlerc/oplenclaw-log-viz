#!/usr/bin/env node
/**
 * Test what the browser would receive when fetching model URLs.
 * Run while dev server is up: node scripts/test-fetch-model-urls.js
 * Uses BASE_URL from env or defaults to http://localhost:5173
 */
const BASE = process.env.BASE_URL || "http://localhost:5173";
const FILES = [
  "/models/Xenova/all-MiniLM-L6-v2/config.json",
  "/models/Xenova/all-MiniLM-L6-v2/tokenizer.json",
  "/models/Xenova/all-MiniLM-L6-v2/onnx/model.onnx",
];

async function fetchAndCheck(url) {
  const res = await fetch(url);
  const text = await res.text();
  const first50 = text.slice(0, 50);
  const isJson = text.trimStart().startsWith("{") || text.trimStart().startsWith("[");
  const isHtml = text.trimStart().startsWith("<");
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    first50,
    isJson,
    isHtml,
    length: text.length,
  };
}

async function main() {
  console.log(`Testing model URLs at ${BASE}\n`);

  for (const file of FILES) {
    const url = BASE + file;
    process.stdout.write(`  ${file} ... `);
    try {
      const r = await fetchAndCheck(url);
      if (r.status === 200 && r.isJson && !r.isHtml) {
        console.log(`✓ ${r.status} JSON (${r.length} bytes)`);
      } else if (r.status === 200 && file.endsWith(".onnx")) {
        console.log(`✓ ${r.status} binary (${r.length} bytes)`);
      } else {
        console.log(`✗ status=${r.status} isJson=${r.isJson} isHtml=${r.isHtml}`);
        console.log(`    first50: ${JSON.stringify(r.first50)}`);
      }
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
