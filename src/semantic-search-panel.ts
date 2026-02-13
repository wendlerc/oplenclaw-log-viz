import * as d3 from "d3";
import type { LogEvent } from "./types";

const LANE_HEIGHT = 32;
const DOT_R = 5;
const BRUSH_HEIGHT = 36;

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d3.timeFormat("%b %d %H:%M:%S")(d);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export interface SemanticPrompt {
  id: string;
  text: string;
  embedding: number[] | null;
  color: string;
}

const PROMPT_COLORS = [
  "#5eb9ff", "#a78bfa", "#34d399", "#f59e0b", "#f472b6",
  "#4ade80", "#f87171", "#22c55e", "#eab308", "#06b6d4",
];

export function renderSemanticSearchPanel(
  container: HTMLElement,
  events: LogEvent[],
  prompts: SemanticPrompt[],
  setPrompts: (prompts: SemanticPrompt[]) => void,
  timeDomain?: [Date | null, Date | null],
  allEvents?: LogEvent[],
  onRangeChange?: (start: Date | null, end: Date | null) => void
) {
  const prevThresholdEl = document.getElementById("semantic-threshold") as HTMLInputElement | null;
  const threshold = prevThresholdEl ? parseFloat(prevThresholdEl.value) : 0.6;

  container.innerHTML = "";

  const eventsWithEmbeddings = events.filter((e) => e.embedding && e.embedding.length > 0);
  const userEvents = eventsWithEmbeddings.filter((e) => e.role === "user");
  const assistantEvents = eventsWithEmbeddings.filter((e) => e.role === "assistant");
  const hasEmbeddings = userEvents.length > 0 || assistantEvents.length > 0;

  const panel = document.createElement("div");
  panel.className = "semantic-search-panel";

  const controls = document.createElement("div");
  controls.className = "semantic-search-controls";
  controls.innerHTML = `
    <div class="semantic-search-add">
      <input type="text" id="semantic-prompt-input" placeholder="Add prompt (e.g. email, deployment, error)" />
      <button type="button" id="semantic-add-btn">Add</button>
      <span id="semantic-error" class="semantic-error" style="display:none"></span>
    </div>
    <div class="semantic-search-threshold">
      <label>
        <span>Similarity threshold</span>
        <input type="range" id="semantic-threshold" min="0.3" max="0.95" step="0.05" value="${threshold}" />
        <span id="semantic-threshold-value">${threshold.toFixed(2)}</span>
      </label>
    </div>
  `;
  panel.appendChild(controls);

  const promptList = document.createElement("div");
  promptList.className = "semantic-prompt-list";
  promptList.id = "semantic-prompt-list";
  panel.appendChild(promptList);

  const timelineWrap = document.createElement("div");
  timelineWrap.className = "semantic-timeline-wrap";

  const userSection = document.createElement("div");
  userSection.className = "semantic-section";
  const userHeading = document.createElement("h4");
  userHeading.textContent = "User messages";
  userSection.appendChild(userHeading);
  const userTimelineEl = document.createElement("div");
  userTimelineEl.id = "semantic-timeline-user";
  userSection.appendChild(userTimelineEl);
  timelineWrap.appendChild(userSection);

  const assistantSection = document.createElement("div");
  assistantSection.className = "semantic-section";
  const assistantHeading = document.createElement("h4");
  assistantHeading.textContent = "Assistant messages";
  assistantSection.appendChild(assistantHeading);
  const assistantTimelineEl = document.createElement("div");
  assistantTimelineEl.id = "semantic-timeline-assistant";
  assistantSection.appendChild(assistantTimelineEl);
  timelineWrap.appendChild(assistantSection);

  panel.appendChild(timelineWrap);

  const resetWrap = document.createElement("div");
  resetWrap.className = "timeline-brush-controls";
  resetWrap.style.marginTop = "0.5rem";
  resetWrap.innerHTML = '<button type="button" class="btn-reset btn-reset-semantic">Reset to global view</button>';
  panel.appendChild(resetWrap);

  container.appendChild(panel);

  async function embedText(text: string): Promise<number[]> {
    const res = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Embed failed");
    }
    const data = await res.json();
    if (!Array.isArray(data.embedding)) throw new Error("Invalid embed response");
    return data.embedding;
  }

  function getMatchesForPrompt(p: SemanticPrompt, thresh: number, eventPool: LogEvent[]): { event: LogEvent; score: number }[] {
    if (!p.embedding) return [];
    const matches: { event: LogEvent; score: number }[] = [];
    for (const e of eventPool) {
      const emb = e.embedding!;
      const score = cosineSimilarity(p.embedding!, emb);
      if (score >= thresh) matches.push({ event: e, score });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches;
  }

  function render() {
    const thresholdEl = document.getElementById("semantic-threshold") as HTMLInputElement;
    const thresholdVal = document.getElementById("semantic-threshold-value");
    const currentThreshold = thresholdEl ? parseFloat(thresholdEl.value) : threshold;
    if (thresholdEl && thresholdVal) {
      thresholdVal.textContent = currentThreshold.toFixed(2);
    }

    const filteredEvents = events.filter((e) => {
      const t = new Date(e.time).getTime();
      const [start, end] = timeDomain ?? [null, null];
      if (start && t < start.getTime()) return false;
      if (end && t > end.getTime()) return false;
      return true;
    });
    const filteredUser = filteredEvents.filter((e) => e.role === "user" && e.embedding && e.embedding.length > 0);
    const filteredAssistant = filteredEvents.filter((e) => e.role === "assistant" && e.embedding && e.embedding.length > 0);

    if (!hasEmbeddings) {
      userTimelineEl.innerHTML = `
        <div class="empty-state">
          <p>No embeddings found. Run <code>npm run parse</code> then <code>npm run embed</code>.</p>
        </div>
      `;
      assistantTimelineEl.innerHTML = `
        <div class="empty-state">
          <p>No embeddings found. Run <code>npm run parse</code> then <code>npm run embed</code>.</p>
        </div>
      `;
      return;
    }

    if (prompts.length === 0) {
      userTimelineEl.innerHTML = `
        <div class="empty-state">
          <p>Add a prompt above to search user messages.</p>
        </div>
      `;
      assistantTimelineEl.innerHTML = `
        <div class="empty-state">
          <p>Add a prompt above to search assistant messages.</p>
        </div>
      `;
      return;
    }

    const userPromptRows = prompts.map((p) => ({
      prompt: p,
      matches: getMatchesForPrompt(p, currentThreshold, userEvents).filter((m) =>
        filteredUser.some((e) => e === m.event)
      ),
    }));

    const assistantPromptRows = prompts.map((p) => ({
      prompt: p,
      matches: getMatchesForPrompt(p, currentThreshold, assistantEvents).filter((m) =>
        filteredAssistant.some((e) => e === m.event)
      ),
    }));

    renderSemanticTimeline(
      userTimelineEl,
      userPromptRows,
      timeDomain,
      allEvents ?? events,
      onRangeChange
    );
    renderSemanticTimeline(
      assistantTimelineEl,
      assistantPromptRows,
      timeDomain,
      allEvents ?? events,
      onRangeChange
    );
  }

  document.getElementById("semantic-add-btn")?.addEventListener("click", async () => {
    const input = document.getElementById("semantic-prompt-input") as HTMLInputElement;
    const text = input?.value?.trim();
    if (!text) return;

    const addBtn = document.getElementById("semantic-add-btn") as HTMLButtonElement;
    addBtn.disabled = true;
    addBtn.textContent = "Embedding…";

    try {
      const embedding = await embedText(text);
      const next = [
        ...prompts,
        {
          id: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          text,
          embedding,
          color: PROMPT_COLORS[prompts.length % PROMPT_COLORS.length],
        },
      ];
      setPrompts(next);
      input!.value = "";
      addBtn.textContent = "Add";
      document.getElementById("semantic-error")?.style.setProperty("display", "none");
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unrecognized token '<'")) {
        msg += " — Try clearing site data (DevTools → Application → Storage) or Cache Storage → transformers-cache.";
      }
      console.error("Semantic embed error:", e);
      addBtn.textContent = "Add";
      const errEl = document.getElementById("semantic-error");
      if (errEl) {
        errEl.textContent = msg;
        errEl.style.display = "inline";
      }
    } finally {
      addBtn.disabled = false;
      render();
    }
  });

  document.getElementById("semantic-prompt-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("semantic-add-btn")?.click();
    }
  });

  document.getElementById("semantic-threshold")?.addEventListener("input", () => render());

  // Prompt list with remove buttons
  function renderPromptList() {
    promptList.innerHTML = prompts
      .map(
        (p) => `
      <div class="semantic-prompt-chip" data-id="${p.id}">
        <span class="semantic-prompt-chip-color" style="background:${p.color}"></span>
        <span class="semantic-prompt-chip-text">${escapeHtml(p.text)}</span>
        <button type="button" class="semantic-prompt-remove" data-id="${p.id}">×</button>
      </div>
    `
      )
      .join("");

    promptList.querySelectorAll(".semantic-prompt-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).dataset.id;
        setPrompts(prompts.filter((p) => p.id !== id));
        renderPromptList();
        render();
      });
    });
  }


  renderPromptList();
  render();
}

function renderSemanticTimeline(
  container: HTMLElement,
  promptRows: { prompt: SemanticPrompt; matches: { event: LogEvent; score: number }[] }[],
  timeDomain?: [Date | null, Date | null],
  allEvents?: LogEvent[],
  onRangeChange?: (start: Date | null, end: Date | null) => void
) {
  container.innerHTML = "";

  const allMatches = promptRows.flatMap((r) => r.matches);
  const events = [...new Set(allMatches.map((m) => m.event))];
  if (events.length === 0 && promptRows.every((r) => r.matches.length === 0)) {
    container.innerHTML = '<div class="empty-state"><p>No matches above threshold.</p></div>';
    return;
  }

  const width = Math.max(800, container.clientWidth || 800);
  const hasBrush = onRangeChange && allEvents && allEvents.length > 0;
  const chartHeight = Math.min(400, promptRows.length * LANE_HEIGHT + 80);
  const height = chartHeight + (hasBrush ? BRUSH_HEIGHT : 0);

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`)
    .style("max-width", "100%");

  const margin = { top: 16, right: 16, bottom: 36, left: 160 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const dataExtent = events.length
    ? (d3.extent(events, (e) => new Date(e.time)) as [Date, Date])
    : ([new Date(), new Date()] as [Date, Date]);
  const fullExtent = allEvents?.length
    ? (d3.extent(allEvents, (e) => new Date(e.time)) as [Date, Date])
    : dataExtent;
  const [domainStart, domainEnd] = timeDomain ?? [null, null];
  const useDomain = domainStart || domainEnd;
  const extentStart = useDomain && domainStart ? domainStart : dataExtent[0];
  const extentEnd = useDomain && domainEnd ? domainEnd : dataExtent[1];
  const padding = (extentEnd.getTime() - extentStart.getTime()) * 0.02 || 86400000;
  const xScale = d3
    .scaleTime()
    .domain([
      new Date(extentStart.getTime() - padding),
      new Date(extentEnd.getTime() + padding),
    ])
    .range([0, innerWidth]);

  const yScale = d3
    .scaleBand()
    .domain(promptRows.map((r) => r.prompt.text))
    .range([0, innerHeight])
    .padding(0.15);

  g.append("g")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale).ticks(8).tickFormat((d) => d3.timeFormat("%b %d %H:%M")(d as Date)))
    .selectAll("text")
    .attr("fill", "#6b7a8f")
    .style("font-size", "10px");

  g.append("g")
    .call(d3.axisLeft(yScale).tickSize(0))
    .selectAll("text")
    .attr("fill", "#6b7a8f")
    .style("font-size", "10px")
    .text((d: unknown) => String(d));

  const existingTooltip = d3.select("body").select(".semantic-tooltip");
  const semanticTooltip = existingTooltip.empty()
    ? d3
        .select("body")
        .append("div")
        .attr("class", "tooltip semantic-tooltip")
        .style("position", "absolute")
        .style("visibility", "hidden")
        .style("background", "#141922")
        .style("border", "1px solid #1e2530")
        .style("border-radius", "8px")
        .style("padding", "8px 12px")
        .style("font-size", "11px")
        .style("max-width", "560px")
        .style("max-height", "80vh")
        .style("overflow", "hidden")
        .style("display", "flex")
        .style("flex-direction", "column")
        .style("z-index", "1000")
    : existingTooltip;

  const hideTooltip = () => semanticTooltip.style("visibility", "hidden");
  semanticTooltip.on("mouseleave", hideTooltip);

  // Dots per prompt row
  for (const row of promptRows) {
    const laneY = yScale(row.prompt.text);
    if (laneY === undefined) continue;

    const dots = g
      .selectAll(`.semantic-dot-${row.prompt.id}`)
      .data(row.matches)
      .join("g")
      .attr("class", `semantic-dot semantic-dot-${row.prompt.id}`)
      .attr("transform", (m) => {
        const x = xScale(new Date(m.event.time));
        return `translate(${x},${laneY + yScale.bandwidth()! / 2})`;
      });

    dots
      .append("circle")
      .attr("r", (m) => 4 + (m.score - 0.5) * 8)
      .attr("fill", row.prompt.color)
      .attr("stroke", "#0d0f14")
      .attr("stroke-width", 1);

    dots
      .on("mouseenter", (event: MouseEvent, m) => {
        semanticTooltip
          .style("visibility", "visible")
          .style("pointer-events", "auto")
          .html(
            `<div style="color:#6b7a8f">Similarity: ${(m.score * 100).toFixed(1)}%</div>
             <div class="semantic-tooltip-content" style="margin-top:4px;max-height:500px;overflow-y:auto;white-space:pre-wrap;word-break:break-word">${escapeHtml(m.event.message || "")}</div>
             <div style="margin-top:4px;color:#6b7a8f;font-size:10px">${formatTime(m.event.time)}</div>`
          );
      })
      .on("mousemove", (event: MouseEvent) => {
        semanticTooltip
          .style("top", event.pageY + 12 + "px")
          .style("left", Math.min(event.pageX + 12, window.innerWidth - 580) + "px");
      })
      .on("mouseleave", (event: MouseEvent) => {
        const target = event.relatedTarget as Node | null;
        const tooltipEl = semanticTooltip.node() as Element | null;
        if (target && tooltipEl?.contains(target)) return;
        hideTooltip();
      });
  }

  // Brush with d3.brushX for reliable interaction
  if (hasBrush && onRangeChange) {
    const brushG = svg
      .append("g")
      .attr("class", "brush-group")
      .attr("transform", `translate(${margin.left},${chartHeight + 4})`);

    const brushXScale = d3.scaleTime().domain(fullExtent).range([0, innerWidth]);
    const selStart = domainStart ?? fullExtent[0];
    const selEnd = domainEnd ?? fullExtent[1];

    const brush = d3
      .brushX<unknown>()
      .extent([
        [0, 0],
        [innerWidth, BRUSH_HEIGHT],
      ])
      .on("end", (event) => {
        const sel = event.selection;
        if (sel) {
          onRangeChange!(brushXScale.invert(sel[0]), brushXScale.invert(sel[1]));
        }
      });

    brushG.call(brush);
    brushG.call(
      brush.move,
      [brushXScale(selStart), brushXScale(selEnd)] as [number, number]
    );

    brushG.selectAll(".selection").attr("stroke", "rgba(94, 185, 255, 0.4)").attr("fill", "rgba(94, 185, 255, 0.15)");
    brushG.selectAll(".handle").attr("fill", "#5eb9ff").attr("stroke", "#2d5a84");
  }
}
