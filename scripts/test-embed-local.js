#!/usr/bin/env node
/**
 * Test embedding using LOCAL model files only (same mechanism as browser intent).
 * Verifies: model loads from local path, embedding works.
 * Run: node scripts/test-embed-local.js
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const localModelPath = path.join(projectRoot, "public", "models");

const MODEL = "Xenova/all-MiniLM-L6-v2";
const TEST_TEXT = "user authentication and login";

async function main() {
  console.log("Test: embedding with local model (same as browser intent)\n");

  const { pipeline, env } = await import("@xenova/transformers");

  // Match browser config: use local only, no remote
  env.localModelPath = path.join(localModelPath, "");
  env.allowRemoteModels = false;

  console.log("  env.localModelPath =", env.localModelPath);
  console.log("  env.allowRemoteModels =", env.allowRemoteModels);

  console.log("\nLoading pipeline (local_files_only)...");
  const extractor = await pipeline("feature-extraction", MODEL, {
    local_files_only: true,
  });

  console.log("Embedding test text:", JSON.stringify(TEST_TEXT));
  const out = await extractor(TEST_TEXT, {
    padding: true,
    truncation: true,
    pooling: "mean",
    normalize: true,
  });

  const arr = Array.isArray(out?.data) ? out.data : Array.from(out?.data ?? []);
  const dim = out?.dims?.[out.dims.length - 1] ?? 384;
  const embedding = Array.from(arr.slice(0, dim));

  console.log("  dim:", dim);
  console.log("  embedding[0:5]:", embedding.slice(0, 5));
  console.log("\n✓ Local embedding test passed");
}

main().catch((e) => {
  console.error("\n✗ Error:", e.message);
  console.error(e);
  process.exit(1);
});
