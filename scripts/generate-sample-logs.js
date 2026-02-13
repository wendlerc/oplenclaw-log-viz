#!/usr/bin/env node
/**
 * Generate sample logs for demo. Run: node scripts/generate-sample-logs.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });

const now = Date.now();
const base = now - 24 * 60 * 60 * 1000;

function iso(offset) {
  return new Date(base + offset).toISOString();
}

const lines = [
  // MD writes
  JSON.stringify({ time: iso(0), level: "info", subsystem: "agent/embedded", message: "Written to MEMORY.md", 0: "Written to MEMORY.md" }) + "\n",
  JSON.stringify({ time: iso(60000), level: "info", subsystem: "agent/embedded", message: "Updated SOUL.md with persona", 0: "Updated SOUL.md with persona" }) + "\n",
  JSON.stringify({ time: iso(120000), level: "info", subsystem: "agent/embedded", message: "Edited AGENTS.md runId=run-1 sessionId=sess-a", 0: "Edited AGENTS.md runId=run-1 sessionId=sess-a" }) + "\n",
  JSON.stringify({ time: iso(180000), level: "info", subsystem: "gateway/heartbeat", message: "heartbeat run complete HEARTBEAT_OK", 0: "heartbeat run complete HEARTBEAT_OK" }) + "\n",
  JSON.stringify({ time: iso(240000), level: "info", subsystem: "agent/embedded", message: "embedded run tool start: runId=run-2 tool=search_replace toolCallId=tc-1", 0: "embedded run tool start: runId=run-2 tool=search_replace toolCallId=tc-1" }) + "\n",
  JSON.stringify({ time: iso(300000), level: "info", subsystem: "agent/embedded", message: "embedded run tool end: runId=run-2 tool=search_replace toolCallId=tc-1", 0: "embedded run tool end: runId=run-2 tool=search_replace toolCallId=tc-1" }) + "\n",
  JSON.stringify({ time: iso(360000), level: "info", subsystem: "agent/embedded", message: "Wrote 1024 bytes to HEARTBEAT.md", 0: "Wrote 1024 bytes to HEARTBEAT.md" }) + "\n",
  JSON.stringify({ time: iso(420000), level: "error", subsystem: "agent/embedded", message: "API call failed: rate limit", 0: "API call failed: rate limit" }) + "\n",
  JSON.stringify({ time: iso(480000), level: "info", subsystem: "agent/embedded", message: "embedded run agent start: runId=run-3 sessionId=sess-b", 0: "embedded run agent start: runId=run-3 sessionId=sess-b" }) + "\n",
  JSON.stringify({ time: iso(540000), level: "info", subsystem: "agent/embedded", message: "embedded run agent end: runId=run-3 sessionId=sess-b", 0: "embedded run agent end: runId=run-3 sessionId=sess-b" }) + "\n",
  JSON.stringify({ time: iso(600000), level: "info", subsystem: "agent/embedded", message: "Updated MEMORY.md with new context", 0: "Updated MEMORY.md with new context" }) + "\n",
  JSON.stringify({ time: iso(660000), level: "info", subsystem: "agent/embedded", message: "embedded run tool start: runId=run-4 tool=read_file toolCallId=tc-2 path=MEMORY.md", 0: "embedded run tool start: runId=run-4 tool=read_file toolCallId=tc-2 path=MEMORY.md" }) + "\n",
  JSON.stringify({ time: iso(720000), level: "info", subsystem: "agent/embedded", message: "Edited TOOLS.md in workspace", 0: "Edited TOOLS.md in workspace" }) + "\n",
  JSON.stringify({ time: iso(780000), level: "warn", subsystem: "gateway/heartbeat", message: "heartbeat skipped: HEARTBEAT.md empty", 0: "heartbeat skipped: HEARTBEAT.md empty" }) + "\n",
  JSON.stringify({ time: iso(840000), level: "info", subsystem: "agent/embedded", message: "embedded run tool start: runId=run-5 tool=memory_search toolCallId=tc-3", 0: "embedded run tool start: runId=run-5 tool=memory_search toolCallId=tc-3" }) + "\n",
  JSON.stringify({ time: iso(900000), level: "info", subsystem: "agent/embedded", message: "Data written to data/workspace/IDENTITY.md", 0: "Data written to data/workspace/IDENTITY.md" }) + "\n",
];

const out = path.join(logsDir, "openclaw-sample.log");
fs.writeFileSync(out, lines.join(""), "utf-8");
console.log("Generated:", out);
