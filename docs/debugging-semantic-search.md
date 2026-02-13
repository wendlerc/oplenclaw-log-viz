# Debugging Semantic Search

Notes on failed and successful approaches for the semantic search / embedding feature. See [semantic-search.md](./semantic-search.md) for how it works.

## Errors Encountered

### 1. "JSON Parse error: Unrecognized token '<'"

**Cause:** A fetch returns HTML (starts with `<`) instead of JSON. Caller tries `JSON.parse()` on it.

**Possible sources:**
- Hugging Face CDN returns HTML (404, rate limit, auth page) instead of model JSON
- Local model path wrong → server returns index.html (SPA fallback)
- Stale browser cache holds HTML from previous failed request

### 2. "Can't create session"

**Cause:** ONNX Runtime Web fails to create an inference session.

**Associated with:** Web Worker "proxy" mode that uses `SharedArrayBuffer`, which needs:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Our dev server does not set these headers, so proxy mode fails.

## Approaches Tried

### A. Use local model (download to public/models/)

**Status:** Correct approach for avoiding Hugging Face CDN/CORS.

**Implementation:** `scripts/download-model.js` fetches model files from Hugging Face (Node has no CORS) and saves to `public/models/Xenova/all-MiniLM-L6-v2/`.

**Verification:** `node scripts/test-embed-local.js` passes.

### B. Set env.localModelPath and env.allowRemoteModels

**Status:** Required for local loading.

**In browser:** `env.localModelPath = "/models/"` (path served by Vite at root)

**In Node:** `env.localModelPath = path.join(projectRoot, "public", "models")`

### C. Set ort.env.wasm.proxy = false

**Status:** Intended to fix "Can't create session" by disabling SharedArrayBuffer.

**Result:** Did not resolve the error in user's environment.

### D. Fetch test (scripts/test-fetch-model-urls.js)

**Status:** When server is running, `/models/Xenova/all-MiniLM-L6-v2/config.json` returns 200 JSON. Server is serving correctly.

### E. Browser cache (`env.useBrowserCache = false`)

**Status:** Implemented.

**Cause of "Unrecognized token '<'" with cache:** When `useBrowserCache` is true, the library caches responses. On cache lookup it tries `localPath` first, then `proposedCacheKey` (remote URL). If a previous attempt fetched from Hugging Face and got HTML (404/error page), that response was cached under the remote URL. On a later load, `localPath` has no cache entry, but `tryCache` then tries the remote URL key — cache hit returns the cached HTML. The code then parses it as JSON → "Unrecognized token '<'".

**Fix:** Set `env.useBrowserCache = false` before loading the pipeline so no stale HTML is served from cache.

**User fallback:** If the error persists, clear site data (Application → Storage → Clear site data) or use DevTools → Application → Cache Storage → delete "transformers-cache".

## Working Baseline

- **Node:** `node scripts/test-embed-local.js` — loads from `public/models/`, embeds successfully.
- **Server:** Model URLs return correct JSON/binary when fetched directly.

## Test Results (run: npm run test:embed, npm run test:fetch, npm run test:embed-browser)

| Test | Command | Result |
|------|---------|--------|
| Node embed | `npm run test:embed` | ✓ PASS |
| Fetch model URLs | `npm run test:fetch` (dev server must be running) | ✓ PASS |
| Browser embed | `npm run test:embed-browser` | ✗ FAIL — "Can't create a session" (ONNX) |

**Browser test:** Uses Playwright to load `/test-embed.html`, click Run, wait for result. Fails in Playwright (Chromium/Firefox) with "Can't create session". Approaches tried: proxy=false, simd=false, wasmPaths=/onnx-wasm/, numThreads=1, local WASM files, SwiftShader, site isolation disabled, COOP/COEP+proxy. Manual test at `/test-embed.html` in a real browser may succeed.

### F. Backend API (fix for "Can't create session")

**Status:** Implemented. Embed runs in Node via `scripts/embed-api.js`; dashboard fetches from `/api/embed`. Vite proxies `/api` to the embed API (port 3001). Run `npm run dev` to start both Vite and the embed API.

## Next Steps

1. ~~Disable browser cache when loading model: `env.useBrowserCache = false`~~ Done
2. Ensure env is set before any transformers import
3. Consider loading pipeline at app init (eager) vs on first prompt (lazy) — lazy may allow env to be overwritten by other code paths
4. Investigate "Can't create session" in headless Chromium — try headed mode or real browser
