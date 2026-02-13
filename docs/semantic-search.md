# Semantic Search

How the semantic search feature works in the Bot Log Analysis dashboard.

## Overview

Semantic search finds log events whose messages are **semantically similar** to user-defined prompts. Instead of keyword matching, it uses embeddings (dense vectors) from a sentence transformer model. Events with high cosine similarity to a prompt appear as dots on that prompt’s timeline row.

## Architecture

```
┌─────────────────┐     POST /api/embed      ┌──────────────────┐
│  Dashboard UI   │ ──────────────────────► │  Embed API       │
│  (semantic-     │     { "text": "..." }    │  (Node.js)       │
│   search-panel) │                          │  scripts/        │
│                 │ ◄──────────────────────  │  embed-api.js    │
└─────────────────┘     { "embedding": [] } └────────┬─────────┘
        │                                              │
        │ reads events.json                            │ loads model
        ▼                                              ▼
┌─────────────────┐                          ┌──────────────────┐
│  events.json    │                          │  @xenova/        │
│  (with pre-     │                          │  transformers    │
│   computed      │                          │  Xenova/all-     │
│   embeddings)   │                          │  MiniLM-L6-v2    │
└─────────────────┘                          └──────────────────┘
```

### Two embedding sources

1. **Pre-computed (events)** – `npm run embed` uses `scripts/embed-events.js` to add a 384‑dim `embedding` field to each event in `events.json`. Events with a `message` field are embedded; the rest are skipped.

2. **User prompts** – When you add a prompt (e.g. "email", "deployment"), the UI calls the embed API, which runs the same model in Node and returns the embedding.

## Flow

1. **Parse logs** – `npm run parse` → `events.json`
2. **Download model** – `npm run download-model` → `public/models/Xenova/all-MiniLM-L6-v2/`
3. **Embed events** – `npm run embed` → adds `embedding` to each event in `events.json`
4. **Run dev server** – `npm run dev` starts Vite + embed API
5. **Use semantic search** – Add prompts; each prompt is embedded via API and compared to event embeddings with cosine similarity

## Algorithm

### Embedding model

- **Model:** `Xenova/all-MiniLM-L6-v2` (384‑dimensional sentence transformer)
- **Options:** `pooling: "mean"`, `normalize: true`, `padding: true`, `truncation: true`

### Similarity

Cosine similarity between two embedding vectors:

```
sim(a, b) = (a · b) / (||a|| × ||b||)
```

Range: -1 to 1. Higher values = more similar.

### Matching

For each prompt and each event with an embedding:

- Compute `cosineSimilarity(prompt.embedding, event.embedding)`
- If `score >= threshold`, the event is a match

Default threshold: 0.6 (configurable via slider, 0.3–0.95).

### Dot size

Dot radius scales with similarity: `4 + (score - 0.5) * 8` pixels. Higher scores → larger dots.

## API

The embed API (`scripts/embed-api.js`) runs on port 3001. Vite proxies `/api` to it.

**Request:**

```
POST /api/embed
Content-Type: application/json

{ "text": "your prompt here" }
```

**Response:**

```json
{
  "embedding": [0.046, -0.018, 0.053, ...]
}
```

## UI

- **Prompt input** – Add prompts; each becomes a row
- **Similarity threshold** – Slider (0.3–0.95)
- **Timeline** – One row per prompt; dots for matching events
- **Brush** – Time range filter
- **Tooltip** – Hover over a dot for similarity, full message, and timestamp

## Files

| File | Role |
|------|------|
| `scripts/download-model.js` | Downloads model files to `public/models/` |
| `scripts/embed-events.js` | Adds embeddings to `events.json` (batch) |
| `scripts/embed-api.js` | HTTP API for on-demand embedding (prompts) |
| `src/semantic-search-panel.ts` | UI: prompts, threshold, timeline, dots |
| `vite.config.ts` | Proxies `/api` → embed API |

## Troubleshooting

See [debugging-semantic-search.md](./debugging-semantic-search.md).
