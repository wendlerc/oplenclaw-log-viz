import * as d3 from "d3";
import type { LogEvent } from "./types";

const LANE_HEIGHT = 28;
const DOT_R_MIN = 2;
const DOT_R_MAX = 12;
const MAX_FILES = 20; // Top N files by edit count for timeline; rest in "Other"

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d3.timeFormat("%b %d %H:%M:%S")(d);
}

export function renderMdEditsPanel(
  container: HTMLElement,
  mdEvents: LogEvent[],
  timeDomain?: [Date | null, Date | null],
  allMdEvents?: LogEvent[],
  onRangeChange?: (start: Date | null, end: Date | null) => void
) {
  container.innerHTML = "";

  if (mdEvents.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No MD edits in logs.</p>
      </div>
    `;
    return;
  }

  // Sort by count desc for lane order; top N files + "Other" for the rest
  const byFile = d3.rollup(mdEvents, (v) => v.length, (e) => e.category);
  const filesByCount = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
  const topFiles = filesByCount.slice(0, MAX_FILES).map(([f]) => f);
  const otherFiles = new Set(mdEvents.map((e) => e.category).filter((f) => !topFiles.includes(f)));
  const timelineFiles = topFiles.length > 0
    ? [...topFiles, ...(otherFiles.size > 0 ? ["Other"] : [])]
    : [...new Set(mdEvents.map((e) => e.category))];

  const panel = document.createElement("div");
  panel.className = "md-edits-panel";

  // Controls
  const controls = document.createElement("div");
  controls.className = "md-edits-controls";
  controls.innerHTML = `
    <label>
      <span>Filter by file</span>
      <select id="md-edits-filter">
        <option value="">All files</option>
        ${timelineFiles.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("")}
      </select>
    </label>
    <span class="md-edits-count">${mdEvents.length} edits</span>
  `;
  panel.appendChild(controls);

  // Timeline
  const timelineWrap = document.createElement("div");
  timelineWrap.className = "md-edits-timeline-wrap";
  const timelineEl = document.createElement("div");
  timelineEl.id = "md-edits-timeline";
  timelineWrap.appendChild(timelineEl);
  panel.appendChild(timelineWrap);

  // Edit list: one row per file
  const listWrap = document.createElement("div");
  listWrap.className = "md-edits-list-wrap";
  listWrap.innerHTML = `
    <h3 class="md-edits-list-title">Edits by file</h3>
    <div id="md-edits-list" class="md-edits-list"></div>
  `;
  panel.appendChild(listWrap);

  container.appendChild(panel);

  let filtered = [...mdEvents];
  const allFiles = [...new Set(mdEvents.map((e) => e.category))];
  const fileColors = d3.schemeTableau10 as string[];
  const colorScale = d3.scaleOrdinal([...allFiles, "Other"], fileColors.concat(["#6b7a8f"]));

  function render() {
    const filterEl = document.getElementById("md-edits-filter") as HTMLSelectElement;
    const fileFilter = filterEl?.value || "";
    filtered = fileFilter
      ? mdEvents.filter((e) =>
          fileFilter === "Other" ? otherFiles.has(e.category) : e.category === fileFilter
        )
      : mdEvents;
    filtered.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    const listEl = document.getElementById("md-edits-list");
    if (listEl) {
      const byFile = d3.rollup(
        filtered,
        (v) => {
          const sorted = [...v].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
          const last = sorted[0];
          return {
            count: v.length,
            lastTime: d3.max(v, (e) => e.time)!,
            lastMsg: last?.message ?? "",
            lastSummary: last?.summary ?? "",
          };
        },
        (e) => e.category
      );
      const rows = [...byFile.entries()].sort((a, b) => b[1].count - a[1].count);
      listEl.innerHTML = rows
        .map(([file, { count, lastTime, lastMsg, lastSummary }]) => {
          const display = lastSummary || lastMsg.slice(0, 60) + (lastMsg.length > 60 ? "…" : "");
          const title = lastSummary ? `${lastSummary}\n\n---\n${lastMsg}` : lastMsg;
          return `
          <div class="md-edit-row md-edit-row-file">
            <span class="md-edit-file" style="color:${colorScale(file) ?? "#6b7a8f"}">${escapeHtml(file)}</span>
            <span class="md-edit-count">${count}</span>
            <span class="md-edit-time">${formatTime(lastTime)}</span>
            <span class="md-edit-msg" title="${escapeHtml(title)}">${escapeHtml(display)}</span>
          </div>
        `;
        })
        .join("");
    }

    // Draw timeline: map "Other" files to single lane for events not in topFiles
    const timelineEvents = filtered.map((e) => ({
      ...e,
      _lane: otherFiles.has(e.category) ? "Other" : e.category,
    }));
    renderMdTimeline(timelineEl, timelineEvents, timelineFiles, colorScale, timeDomain, allMdEvents, onRangeChange);
  }

  const filterEl = document.getElementById("md-edits-filter");
  filterEl?.addEventListener("change", render);

  render();
}

const BRUSH_HEIGHT = 36;

function renderMdTimeline(
  container: HTMLElement,
  events: (LogEvent & { _lane?: string })[],
  files: string[],
  colorScale: d3.ScaleOrdinal<string, string, never>,
  timeDomain?: [Date | null, Date | null],
  allEvents?: LogEvent[],
  onRangeChange?: (start: Date | null, end: Date | null) => void
) {
  container.innerHTML = "";

  if (events.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No edits in selected range.</p></div>';
    return;
  }

  const width = Math.max(800, container.clientWidth || 800);
  const hasBrush = onRangeChange && allEvents && allEvents.length > 0;
  const chartHeight = Math.min(400, files.length * LANE_HEIGHT + 80);
  const height = chartHeight + (hasBrush ? BRUSH_HEIGHT : 0);

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`)
    .style("max-width", "100%");

  const margin = { top: 16, right: 16, bottom: 36, left: 120 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const dataExtent = d3.extent(events, (e: LogEvent) => new Date(e.time)) as [Date, Date];
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
    .domain(files)
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

  g.selectAll(".grid-line")
    .data(xScale.ticks(8))
    .join("line")
    .attr("class", "grid-line")
    .attr("x1", (d) => xScale(d))
    .attr("x2", (d) => xScale(d))
    .attr("y1", 0)
    .attr("y2", innerHeight)
    .attr("stroke", "#1e2530")
    .attr("stroke-dasharray", "2,2");

  const lane = (d: LogEvent & { _lane?: string }) => d._lane ?? d.category;

  // Size: bytes if available, else message length as proxy
  const getSize = (d: LogEvent & { _lane?: string }) => d.bytes ?? (d.message.length || 1);
  const sizeExtent = d3.extent(events, getSize) as [number, number];
  const lo = Math.max(1, sizeExtent[0] ?? 1);
  const hi = Math.max(lo + 1, sizeExtent[1] ?? 100);
  const rScale = d3.scaleSqrt().domain([lo, hi]).range([DOT_R_MIN, DOT_R_MAX]);

  const dots = g
    .selectAll(".md-edit-dot")
    .data(events)
    .join("g")
    .attr("class", "md-edit-dot")
    .attr("transform", (d: LogEvent & { _lane?: string }) => {
      const y = yScale(lane(d));
      const x = xScale(new Date(d.time));
      return `translate(${x},${y !== undefined ? y + yScale.bandwidth() / 2 : 0})`;
    });

  dots
    .append("circle")
    .attr("r", (d: LogEvent & { _lane?: string }) => rScale(getSize(d)))
    .attr("fill", (d: LogEvent & { _lane?: string }) => colorScale(lane(d)) ?? "#6b7a8f")
    .attr("stroke", "#0d0f14")
    .attr("stroke-width", 1.5);

  const HOVER_DELAY_MS = 600;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let currentD: LogEvent | null = null;

  const tooltip = d3
    .select("body")
    .append("div")
    .attr("class", "tooltip md-edit-tooltip")
    .style("position", "absolute")
    .style("visibility", "hidden")
    .style("background", "#141922")
    .style("border", "1px solid #1e2530")
    .style("border-radius", "8px")
    .style("padding", "8px 12px")
    .style("font-size", "11px")
    .style("font-family", "JetBrains Mono, monospace")
    .style("max-width", "400px")
    .style("pointer-events", "none")
    .style("z-index", "1000");

  const popup = d3
    .select("body")
    .append("div")
    .attr("class", "event-popup")
    .style("position", "absolute")
    .style("visibility", "hidden")
    .style("background", "#141922")
    .style("border", "1px solid #1e2530")
    .style("border-radius", "12px")
    .style("padding", "16px 20px")
    .style("font-size", "13px")
    .style("font-family", "JetBrains Mono, monospace")
    .style("max-width", "560px")
    .style("max-height", "420px")
    .style("overflow", "auto")
    .style("box-shadow", "0 8px 32px rgba(0,0,0,0.4)")
    .style("z-index", "1001");

  function showPopup(d: LogEvent, event: MouseEvent) {
    currentD = d;
    const sizeInfo = d.bytes != null ? `${d.bytes} bytes` : `~${d.message.length} chars`;
    const summaryBlock = d.summary
      ? `<div style="color:#5eb9ff;font-size:12px;margin-bottom:8px;font-weight:500">${escapeHtml(d.summary)}</div>`
      : "";
    popup
      .style("visibility", "visible")
      .html(
        `<div style="color:#6b7a8f;font-size:11px;margin-bottom:8px">${escapeHtml(d.category)} • ${sizeInfo}</div>
         ${summaryBlock}
         <div style="white-space:pre-wrap;word-break:break-word;line-height:1.5">${escapeHtml(d.message)}</div>
         <div style="color:#6b7a8f;font-size:11px;margin-top:12px">${formatTime(d.time)}${d.sessionId ? ` • ${d.sessionId}` : ""}</div>`
      );
    const rect = (popup.node() as HTMLElement).getBoundingClientRect();
    let left = event.pageX + 16;
    let top = event.pageY + 16;
    if (left + rect.width > window.innerWidth) left = event.pageX - rect.width - 16;
    if (top + rect.height > window.innerHeight) top = event.pageY - rect.height - 16;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    popup.style("left", left + "px").style("top", top + "px");
  }

  dots
    .on("mouseenter", (event: MouseEvent, d: LogEvent) => {
      const sizeInfo = d.bytes != null ? `${d.bytes} bytes` : `~${d.message.length} chars`;
      const msgPreview = d.message.length > 300 ? d.message.slice(0, 300) + "…" : d.message;
      const preview = d.summary ? `${escapeHtml(d.summary)}\n\n${escapeHtml(msgPreview)}` : escapeHtml(d.message);
      tooltip
        .style("visibility", "visible")
        .html(
          `<div style="color:#6b7a8f">${escapeHtml(d.category)} • ${sizeInfo}${d.summary ? " • Summary" : ""}</div>
           <div style="margin-top:4px">${preview}</div>
           <div style="margin-top:4px;color:#6b7a8f;font-size:10px">${formatTime(d.time)} ${d.sessionId ? `• ${d.sessionId}` : ""}</div>`
        );
      hoverTimer = setTimeout(() => {
        tooltip.style("visibility", "hidden");
        showPopup(d, event);
      }, HOVER_DELAY_MS);
    })
    .on("mousemove", (event: MouseEvent, d: LogEvent) => {
      tooltip
        .style("top", event.pageY + 12 + "px")
        .style("left", Math.min(event.pageX + 12, window.innerWidth - 420) + "px");
      if (currentD === d && popup.style("visibility") === "visible") {
        const rect = (popup.node() as HTMLElement).getBoundingClientRect();
        let left = event.pageX + 16;
        let top = event.pageY + 16;
        if (left + rect.width > window.innerWidth) left = event.pageX - rect.width - 16;
        if (top + rect.height > window.innerHeight) top = event.pageY - rect.height - 16;
        popup.style("left", left + "px").style("top", top + "px");
      }
    })
    .on("mouseleave", () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = null;
      currentD = null;
      tooltip.style("visibility", "hidden");
      popup.style("visibility", "hidden");
    });

  // Brush with d3.brushX for reliable interaction
  if (hasBrush && onRangeChange) {
    const fullExtent = d3.extent(allEvents!, (e: LogEvent) => new Date(e.time)) as [Date, Date];
    const [domainStart, domainEnd] = timeDomain ?? [null, null];
    const selStart = domainStart ?? fullExtent[0];
    const selEnd = domainEnd ?? fullExtent[1];

    const brushG = svg
      .append("g")
      .attr("class", "brush-group")
      .attr("transform", `translate(${margin.left},${chartHeight + 4})`);

    const brushXScale = d3
      .scaleTime()
      .domain(fullExtent)
      .range([0, innerWidth]);

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
