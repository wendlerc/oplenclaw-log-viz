import * as d3 from "d3";
import type { LogEvent } from "./types";

const EVENT_TYPES = ["md_write", "tool_call", "heartbeat", "cron", "email_sent", "moltbook_post", "moltbook_comment", "run_lifecycle", "success", "failure"];
const LANE_HEIGHT = 36;
const DOT_R = 5;
const BRUSH_HEIGHT = 36;

export function renderTimeline(
  container: HTMLElement,
  events: LogEvent[],
  colors: Record<string, string>,
  timeDomain?: [Date | null, Date | null],
  allEvents?: LogEvent[],
  onRangeChange?: (start: Date | null, end: Date | null) => void
) {
  container.innerHTML = "";

  if (events.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No events to display.</p>
        <p>Run <code>npm run sample && npm run parse</code> for demo data.</p>
      </div>
    `;
    return;
  }

  const width = Math.max(800, container.clientWidth);
  const typeOrder = [...EVENT_TYPES];
  const presentTypes = [...new Set(events.map((e: LogEvent) => e.type))];
  presentTypes.sort((a, b) => {
    const ia = typeOrder.indexOf(a);
    const ib = typeOrder.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const hasBrush = onRangeChange && allEvents && allEvents.length > 0;
  const chartHeight = presentTypes.length * LANE_HEIGHT + 80;
  const height = chartHeight + (hasBrush ? BRUSH_HEIGHT : 0);

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`)
    .style("max-width", "100%");

  const margin = { top: 20, right: 20, bottom: 40, left: 140 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

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
    .domain(presentTypes)
    .range([0, innerHeight])
    .padding(0.2);

  // X axis
  g.append("g")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale).ticks(8).tickFormat((d) => d3.timeFormat("%b %d %H:%M")(d as Date)))
    .selectAll("text")
    .attr("fill", "#6b7a8f")
    .style("font-size", "11px");

  // Y axis
  g.append("g")
    .call(d3.axisLeft(yScale).tickSize(0))
    .selectAll("text")
    .attr("fill", "#6b7a8f")
    .style("font-size", "11px")
    .text((d: unknown) => String(d).replace("_", " "));

  // Grid
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

  // Data points
  const dots = g
    .selectAll(".event-dot")
    .data(events)
    .join("g")
    .attr("class", "event-dot")
    .attr("transform", (d: LogEvent) => {
      const y = yScale(d.type);
      const x = xScale(new Date(d.time));
      return `translate(${x},${y !== undefined ? y + yScale.bandwidth() / 2 : 0})`;
    });

  dots
    .append("circle")
    .attr("r", DOT_R)
    .attr("fill", (d: LogEvent) => colors[d.type] ?? "#6b7a8f")
    .attr("stroke", "#0d0f14")
    .attr("stroke-width", 2);

  const HOVER_DELAY_MS = 600;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let currentD: LogEvent | null = null;

  const tooltip = d3
    .select("body")
    .append("div")
    .attr("class", "tooltip")
    .style("position", "absolute")
    .style("visibility", "hidden")
    .style("background", "#141922")
    .style("border", "1px solid #1e2530")
    .style("border-radius", "8px")
    .style("padding", "8px 12px")
    .style("font-size", "12px")
    .style("font-family", "JetBrains Mono, monospace")
    .style("max-width", "320px")
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
    popup
      .style("visibility", "visible")
      .html(
        `<div style="color:#6b7a8f;font-size:11px;margin-bottom:8px">${d.type} • ${d.category}</div>
         <div style="white-space:pre-wrap;word-break:break-word;line-height:1.5">${escapeHtml(d.message)}</div>
         <div style="color:#6b7a8f;font-size:11px;margin-top:12px">${d.time}${d.sessionId ? ` • ${d.sessionId}` : ""}${d.runId ? ` • ${d.runId}` : ""}</div>`
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
      tooltip
        .style("visibility", "visible")
        .html(
          `<div style="color:#6b7a8f">${d.type} • ${d.category}</div>
           <div style="margin-top:4px">${escapeHtml(d.message)}</div>
           <div style="margin-top:4px;color:#6b7a8f;font-size:10px">${d.time}</div>`
        );
      hoverTimer = setTimeout(() => {
        tooltip.style("visibility", "hidden");
        showPopup(d, event);
      }, HOVER_DELAY_MS);
    })
    .on("mousemove", (event: MouseEvent, d: LogEvent) => {
      tooltip
        .style("top", event.pageY + 12 + "px")
        .style("left", Math.min(event.pageX + 12, window.innerWidth - 340) + "px");
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

    // Style brush elements to match our design
    brushG.selectAll(".selection").attr("stroke", "rgba(94, 185, 255, 0.4)").attr("fill", "rgba(94, 185, 255, 0.15)");
    brushG.selectAll(".handle").attr("fill", "#5eb9ff").attr("stroke", "#2d5a84");
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
