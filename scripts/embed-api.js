#!/usr/bin/env node
/**
 * Embed API server - runs model in Node (same as embed-events.js).
 * POST /embed { "text": "..." } -> { "embedding": [0.1, ...] }
 * Run: node scripts/embed-api.js
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const modelPath = path.join(projectRoot, "public", "models");
const MODEL = "Xenova/all-MiniLM-L6-v2";
const PORT = parseInt(process.env.EMBED_API_PORT || "3001", 10);

let extractor = null;

async function loadModel() {
  if (extractor) return extractor;
  const { pipeline, env } = await import("@xenova/transformers");
  env.localModelPath = path.join(modelPath, "");
  env.allowRemoteModels = false;
  extractor = await pipeline("feature-extraction", MODEL, {
    local_files_only: true,
  });
  return extractor;
}

async function embed(text) {
  const pipe = await loadModel();
  const out = await pipe(text.trim(), {
    padding: true,
    truncation: true,
    pooling: "mean",
    normalize: true,
  });
  const arr = Array.isArray(out?.data) ? out.data : Array.from(out?.data ?? []);
  const dim = out?.dims?.[out.dims.length - 1] ?? 384;
  return Array.from(arr.slice(0, dim));
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/embed") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const text = data?.text;
  if (typeof text !== "string" || !text.trim()) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing or invalid 'text'" }));
    return;
  }

  try {
    const embedding = await embed(text);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ embedding }));
  } catch (e) {
    console.error("Embed error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e?.message || "Embed failed" }));
  }
});

server.listen(PORT, () => {
  console.log(`Embed API listening on http://localhost:${PORT}`);
});
