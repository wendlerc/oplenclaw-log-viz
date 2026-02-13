# OpenClaw Log Viz

Visualize OpenClaw/moltbot logs: MD file edits, user sentiment, and a unified log god file.

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

# 3. Parse, summarize, annotate, slim
npm run parse
npm run summarize:mods   # requires OPENROUTER_API_KEY
npm run annotate:sentiment   # requires OPENROUTER_API_KEY (optional, for sentiment viz)
npm run slim

# 4. Run
npm run dev
# Open http://localhost:5173
```

## Pipeline Overview

| Step | Command | Output | Notes |
|------|---------|--------|------|
| Parse | `npm run parse` | `public/events.json` | Extracts events from logs. Preserves existing sentiment when re-parsing. |
| Summarize mods | `npm run summarize:mods` | Adds `modSummary` to events | OpenRouter (qwen). Saves every 50. |
| Annotate sentiment | `npm run annotate:sentiment` | Adds `sentiment` to user_message | OpenRouter. very_delighted → very_upset. |
| Slim | `npm run slim` | `public/events-slim.json` | Strips embeddings, truncates messages. Fast load. |

One-liner after parse: `npm run mods-then-slim`

## Views

| View | URL | Description |
|------|-----|--------------|
| **Timeline** | `/timeline-view.html` | MD edits + sentiment on shared x-axis. Brush to zoom both. |
| **MD Edits** | `/md-edits-view.html` | MD file writes over time. Dot size = bytes. |
| **Sentiment** | `/user-sentiment-view.html` | User messages by sentiment. Dot size = message length. Click → god file. |
| **Sentiment Summary** | `/sentiment-summary-view.html` | Bar chart of sentiment distribution and coverage. |
| **God File** | `/god-file-view.html` | All events in one scrollable timeline. Filter by type. Deep-link via `#e-{index}`. |

## Timeline View (combined)

**http://localhost:5173/timeline-view.html**

- **Shared x-axis:** Time (single brush zooms both charts)
- **Top:** MD edits by file (same as MD edits view)
- **Bottom:** User sentiment (same as sentiment view)
- **Click:** Opens god file at that event in new tab
- **Hover:** Shows @username when available (Discord)

## MD Edits View

**http://localhost:5173/md-edits-view.html**

- **X-axis:** Time (brush to zoom)
- **Y-axis:** SOUL.md, AGENTS.md, IDENTITY.md, USER.md, MEMORY.md, HEARTBEAT.md
- **Dots:** Size = bytes written. Color per file.
- **Hover:** Shows `modSummary`. Click opens full-edit modal.
- **Modal:** Prior context + full edit content. Jump to edit in god file.

## User Sentiment View

**http://localhost:5173/user-sentiment-view.html**

- **X-axis:** Time (brush to zoom)
- **Y-axis:** very_delighted, delighted, neutral, upset, very_upset
- **Dots:** Size = message length. Color by sentiment.
- **Hover:** Shows @username (Discord) when available.
- **Click:** Opens god file at that event in new tab.
- **Requires:** `npm run annotate:sentiment` for labels. Without it, all show as neutral.

## God File View

**http://localhost:5173/god-file-view.html**

- All events in chronological order with timestamps and session IDs
- Filter by event type (User, Assistant, MD write, Tool, etc.)
- Deep-link: `#e-{index}` scrolls to event (e.g. from sentiment click)
- Shows @username for Discord user messages when available

## Static deploy (GitHub Pages, etc.)

```bash
npm run deploy
```

Outputs `deploy/` with `index.html` and `events-slim.json` — pure HTML/JS, no server. Redacts secrets (Discord tokens, GitHub PATs, API keys) before deploy.

## Parser: Discord & sentiment

- **Discord bot filter:** Messages from other Discord bots (detected via `[from: ...]` with `bot`/`is_bot`) are excluded from user_message events.
- **Discord usernames:** When `[from: ...]` or `Name (handle):` format is present, `userName` is extracted and stored on user_message events. Shown in god file and dot tooltips.
- **Sentiment preservation:** Re-running `npm run parse` merges sentiment from the existing events.json into the new output. No need to re-annotate after parse.

## Deprecated views

The old dashboard (bar charts, timeline, semantic search) remains in `src/` but is not served by default.

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
| `parse` | Parse logs → events.json. Preserves sentiment from existing file. |
| `summarize:mods` | Add modSummary (OpenRouter) |
| `annotate:sentiment` | Add sentiment to user_message (OpenRouter) |
| `slim` | Generate events-slim.json |
| `mods-then-slim` | summarize:mods && slim |
| `deploy` | Build standalone deploy/ with redacted events |
| `copy-logs` | Copy from ~/.openclaw, /tmp/openclaw |
| `sample` | Generate demo logs |
