# OpenClaw Log Viz

Visualize OpenClaw/moltbot logs: MD file edits with diff-based summaries.

## Quick Start

```bash
# 1. Clone and install
git clone git@github.com:wendlerc/oplenclaw-log-viz.git
cd oplenclaw-log-viz
npm install

# 2. Put your logs in ./logs/
#    - JSONL files from sessions_snap/, cron_snap/, or .log files
#    - Or copy from OpenClaw: npm run copy-logs
#    - Or generate samples: npm run sample

# 3. Parse, summarize, slim
npm run parse
npm run summarize:mods   # requires OPENROUTER_API_KEY
npm run slim

# 4. Run
npm run dev
# Open http://localhost:5173 (redirects to MD edits view)
```

## Pipeline Overview

| Step | Command | Output | Notes |
|------|---------|--------|------|
| Parse | `npm run parse` | `public/events.json` | Extracts events from logs. **Writes only** (no reads). |
| Summarize mods | `npm run summarize:mods` | Adds `modSummary` to events | OpenRouter (qwen). Saves every 50. |
| Slim | `npm run slim` | `public/events-slim.json` | Strips embeddings, truncates messages. Fast load. |

One-liner after parse: `npm run mods-then-slim`

## Static deploy (GitHub Pages, etc.)

```bash
npm run deploy
```

Outputs `deploy/` with `index.html` and `events-slim.json` — pure HTML/JS, no server. Upload to any static host (GitHub Pages, Netlify, etc.). To link from bots.baulab.info: add a link to your deployed URL (e.g. `https://yourname.github.io/bot-log-viz/`).

## MD Edits View (main viz)

**http://localhost:5173** — root redirects here.

- **X-axis:** Time (brush to zoom)
- **Y-axis:** SOUL.md, AGENTS.md, IDENTITY.md, USER.md, MEMORY.md, HEARTBEAT.md
- **Dots:** Size = bytes written. Color per file. 10 sub-rows; dots are spaced vertically when they would overlap (based on pixel positions and radii).
- **Hover:** Shows `modSummary` (or `summary`). Click opens full-edit modal.
- **Modal:** Scrollable view with prior context (same-session events) and full edit content (diff or plain text). Jump-to-edit button when prior context exists. Close with Escape or click outside.

## Deprecated views

The following are no longer the default; the main app (`/`) now redirects to the MD edits view. The old dashboard (bar charts, timeline, semantic search) remains in `src/` but is not served by default.

## What Was Done

### Parser changes (writes only)
- **Removed** "MD file mentions in assistant text" — that included reads (e.g. "From SOUL.md: ...").
- **Added** `md_write` only from:
  - Tool calls `write` / `edit` with `path` to an MD file
  - Tool results `write` / `edit` with "Successfully wrote X bytes to ..."
- Plain logs: only when message contains "wrote", "updated", "edited", or byte count.
- **Full content for md_write:** Stores full edit content (up to 100k chars) instead of truncating to 120 chars, so summarization and modal can use it.

### Modification summaries
- `summarize:mods` uses `qwen/qwen3-vl-32b-instruct` to summarize diffs, tool call JSON, or plain text.
- Summaries describe the specific change (what was added/removed/modified).
- Input up to 12k chars per event; handles unified diffs (`-` removed, `+` added).
- Requires `OPENROUTER_API_KEY` in `.env` or env.
- Re-summarize: `FORCE=1 npm run summarize:mods`

### Slim file
- `events-slim.json` strips embeddings and truncates messages for fast dashboard load (~17MB vs ~486MB full).
- Keeps full message for `md_write` (up to 50k chars) for modal view.

## Log Format

Expects JSONL with `type: "message"`, `message.role`, `message.content` (toolCall, toolResult, text, thinking). Also plain `.log` with `time`, `level`, `message`.

### Write/Edit tool structure (what the logs contain)

| Source | write | edit |
|--------|-------|------|
| **Tool call** (`content[].type: "toolCall"`) | `arguments.path`, `arguments.content` (full file) | `arguments.path`, `arguments.oldText`, `arguments.newText` |
| **Tool result** (`role: "toolResult"`) | `content[0].text`: "Successfully wrote X bytes to …" | `content[0].text`: "Successfully replaced text in …"<br>`details.diff`: unified diff of changes |

The parser emits `md_write` from both tool call and tool result. The modal shows whichever event the dot represents. Tool-call events have full content; tool-result events use `details.diff` when available (edit) or the short confirmation text (write).

## Scripts

| Script | Description |
|--------|-------------|
| `parse` | Parse logs → events.json |
| `summarize:mods` | Add modSummary (OpenRouter) |
| `slim` | Generate events-slim.json |
| `mods-then-slim` | summarize:mods && slim |
| `copy-logs` | Copy from ~/.openclaw, /tmp/openclaw |
| `sample` | Generate demo logs |
