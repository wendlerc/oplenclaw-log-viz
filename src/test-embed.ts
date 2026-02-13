/**
 * Minimal browser test for embedding - same config as semantic-search-panel.
 * Served at /test-embed.html via Vite.
 */
const out = document.getElementById("out") as HTMLPreElement;
if (!out) throw new Error("No #out element");

async function run() {
  out.textContent = "Loading...";
  try {
    const ort = (await import("onnxruntime-web")).default;
    if (ort?.env?.wasm) {
      ort.env.wasm.proxy = false;
      ort.env.wasm.simd = false;
      ort.env.wasm.wasmPaths = "/onnx-wasm/";
      ort.env.wasm.numThreads = 1;
    }
    out.textContent += "\n- ort env set";

    const { pipeline, env } = await import("@xenova/transformers");
    env.localModelPath = "/models/";
    env.allowRemoteModels = false;
    env.useBrowserCache = false;
    out.textContent += "\n- transformers env set";

    out.textContent += "\n- loading pipeline...";
    const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      local_files_only: true,
    });
    out.textContent += "\n- embedding...";
    const result = await extractor("test", {
      pooling: "mean",
      normalize: true,
    });
    const arr = Array.from(result?.data ?? []);
    out.textContent += `\n✓ dim=${result?.dims?.slice(-1)[0] ?? arr.length} [0:3]=${JSON.stringify(arr.slice(0, 3))}`;
  } catch (e) {
    out.textContent += `\n✗ ${e instanceof Error ? e.message : String(e)}\n${e instanceof Error ? e.stack : ""}`;
  }
}

(document.getElementById("run") as HTMLButtonElement)?.addEventListener("click", run);
