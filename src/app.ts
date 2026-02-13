import type { EventsData } from "./types";
import { renderMdBarChart } from "./md-bar-chart";
import { renderTimeline } from "./timeline";
import { renderMdEditsPanel } from "./md-edits-panel";
import { renderSemanticSearchPanel, type SemanticPrompt } from "./semantic-search-panel";

const MD_FILES = [
  "SOUL.md",
  "AGENTS.md",
  "MEMORY.md",
  "HEARTBEAT.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "BOOTSTRAP.md",
];

const EVENT_COLORS: Record<string, string> = {
  md_write: "#5eb9ff",
  tool_call: "#a78bfa",
  run_lifecycle: "#34d399",
  heartbeat: "#f59e0b",
  cron: "#f472b6",
  success: "#4ade80",
  failure: "#f87171",
  email_sent: "#22c55e",
  moltbook_post: "#eab308",
  moltbook_comment: "#06b6d4",
};

export async function renderApp() {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `<div class="loading-state">Loading events…</div>`;

  let data: EventsData;
  try {
    // Prefer slim file (no embeddings, truncated messages) for fast load
    const res = await fetch("/events-slim.json");
    if (res.ok) {
      data = await res.json();
    } else {
      const fullRes = await fetch("/events.json");
      data = await fullRes.json();
    }
  } catch (e) {
    console.error("Failed to load events:", e);
    data = {
      events: [],
      summary: {
        mdWriteCounts: {},
        mdWriteBytes: {},
        totalEvents: 0,
        eventTypes: [],
        timeRange: null,
      },
    };
  }

  const { events: allEvents, summary } = data;
  let events = [...allEvents];

  function filterByTimeRange(evs: typeof allEvents): typeof allEvents {
    const [start, end] = timeRange;
    if (!start && !end) return evs;
    return evs.filter((e) => {
      const t = new Date(e.time).getTime();
      if (start && t < start.getTime()) return false;
      if (end && t > end.getTime()) return false;
      return true;
    });
  }

  function render() {
    events = filterByTimeRange(allEvents);

    if (legend && events.length > 0) {
      const types = [...new Set(events.map((e) => e.type))];
      legend.innerHTML = types
        .map(
          (t) =>
            `<div class="legend-item"><span class="legend-dot" style="background:${EVENT_COLORS[t] ?? "#6b7a8f"}"></span><span>${t.replace("_", " ")}</span></div>`
        )
        .join("");
    }

    const mdEdits = events.filter((e) => e.type === "md_write");
    const allMdEdits = allEvents.filter((e) => e.type === "md_write");
    if (mdEditsPanel) renderMdEditsPanel(mdEditsPanel, mdEdits, timeRange, allMdEdits, (start, end) => {
      timeRange = [start, end];
      render();
    });
    if (timelineEl) renderTimeline(timelineEl, events, EVENT_COLORS, timeRange, allEvents, (start, end) => {
      timeRange = [start, end];
      render();
    });
    if (semanticPanel) renderSemanticSearchPanel(semanticPanel, events, semanticPrompts, (p) => {
      semanticPrompts = p;
      render();
    }, timeRange, allEvents, (start, end) => {
      timeRange = [start, end];
      render();
    });
  }

  let timeRange: [Date | null, Date | null] = [null, null];
  let semanticPrompts: SemanticPrompt[] = [];

  app.innerHTML = `
    <header>
      <h1>Bot Log Analysis</h1>
      <p class="subtitle">Workspace MD files, tool calls, and event timeline from OpenClaw logs</p>
    </header>

    <section class="section">
      <h2 class="section-title">Activity: Emails, Moltbook Posts & Comments</h2>
      <div id="activity-chart" class="activity-bar-grid"></div>
    </section>

    <section class="section">
      <h2 class="section-title">MD File Write Volume</h2>
      <div id="md-chart" class="bar-grid"></div>
    </section>

    <section class="section">
      <h2 class="section-title">MD Edits (finer granularity)</h2>
      <div id="md-edits-panel"></div>
      <div class="timeline-brush-controls" style="margin-top:0.5rem">
        <button type="button" class="btn-reset btn-reset-md">Reset to global view</button>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Semantic Search</h2>
      <p class="subtitle">Add prompts to find messages with similar meaning (BERT embeddings + cosine similarity)</p>
      <div id="semantic-search-panel"></div>
    </section>

    <section class="section">
      <h2 class="section-title">Event Timeline</h2>
      <div class="event-legend" id="legend"></div>
      <div class="timeline-with-controls">
        <div class="timeline-container">
          <div id="timeline"></div>
        </div>
        <div class="timeline-brush-controls">
          <button type="button" id="time-reset" class="btn-reset">Reset to global view</button>
        </div>
      </div>
    </section>
  `;

  // Activity chart (emails, moltbook posts, comments)
  const activityChart = document.getElementById("activity-chart");
  if (activityChart) {
    const counts = summary.activityCounts ?? { email_sent: 0, moltbook_post: 0, moltbook_comment: 0 };
    activityChart.innerHTML = `
      <div class="activity-bar-item">
        <div class="activity-bar-label">Emails sent</div>
        <div class="activity-bar-value">${counts.email_sent}</div>
      </div>
      <div class="activity-bar-item">
        <div class="activity-bar-label">Moltbook posts</div>
        <div class="activity-bar-value">${counts.moltbook_post}</div>
      </div>
      <div class="activity-bar-item">
        <div class="activity-bar-label">Moltbook comments</div>
        <div class="activity-bar-value">${counts.moltbook_comment}</div>
      </div>
    `;
  }

  // MD bar chart - include known files + any extras from logs
  const mdChart = document.getElementById("md-chart");
  if (mdChart) {
    const counts = summary.mdWriteCounts ?? {};
    const bytes = summary.mdWriteBytes ?? {};
    const extraFiles = Object.keys(counts).filter((k) => !MD_FILES.includes(k));
    const allFiles = [...MD_FILES, ...extraFiles];
    let items = allFiles.map((f) => ({
      file: f,
      count: counts[f] ?? 0,
      bytes: bytes[f] ?? 0,
    }));
    const hasAny = items.some((i) => i.count > 0 || i.bytes > 0);
    if (hasAny) items = items.filter((i) => i.count > 0 || i.bytes > 0);
    renderMdBarChart(mdChart, items);
  }

  const legend = document.getElementById("legend");
  const mdEditsPanel = document.getElementById("md-edits-panel");
  const semanticPanel = document.getElementById("semantic-search-panel");
  const timelineEl = document.getElementById("timeline");

  const resetTimeRange = () => {
    timeRange = [null, null];
    render();
  };
  document.getElementById("time-reset")?.addEventListener("click", resetTimeRange);
  document.querySelector(".btn-reset-md")?.addEventListener("click", resetTimeRange);
  document.querySelector(".btn-reset-semantic")?.addEventListener("click", resetTimeRange);

  render();
}
