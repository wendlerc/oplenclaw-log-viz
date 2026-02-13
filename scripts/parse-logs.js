#!/usr/bin/env node
/**
 * Parse openclaw logs and extract events for visualization.
 * Outputs: public/events.json
 * Run: node scripts/parse-logs.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const logsDir = path.join(projectRoot, "logs");
const publicDir = path.join(projectRoot, "public");
const outputPath = path.join(publicDir, "events.json");

// Workspace MD files we care about
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

function getLogFiles() {
  if (!fs.existsSync(logsDir)) return [];
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && (e.name.endsWith(".log") || e.name.endsWith(".jsonl"))) files.push(full);
    }
  }
  walk(logsDir);
  return files.sort();
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line.trim());
  } catch {
    return null;
  }
}

function getTimestamp(obj) {
  const t = obj?.time ?? obj?.date ?? obj?.timestamp ?? obj?.ts ?? obj?.runAtMs;
  if (typeof t === "string") return new Date(t).getTime();
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  return null;
}

function getMessage(obj) {
  if (typeof obj?.message === "string") return obj.message;
  if (typeof obj?.[0] === "string") return obj[0];
  if (Array.isArray(obj?.arguments) && obj.arguments[0]) return String(obj.arguments[0]);
  if (obj?.message?.content) {
    const parts = Object.values(obj.message.content)
      .filter((c) => c && typeof c === "object" && (c.text || c.thinking))
      .map((c) => c.text || c.thinking || "")
      .filter(Boolean);
    return parts.join(" ");
  }
  if (typeof obj?.summary === "string") return obj.summary;
  return "";
}

function getLevel(obj) {
  return obj?.level ?? obj?.logLevel ?? "info";
}

function getSubsystem(obj) {
  return obj?.subsystem ?? obj?.name ?? "";
}

function extractMdFile(text) {
  const upper = text.toUpperCase();
  for (const f of MD_FILES) {
    if (text.includes(f) || upper.includes(f.toUpperCase())) return f;
  }
  const match = text.match(/(?:[/\\]?)(?:data[/\\]workspace[/\\])?([A-Z][A-Za-z0-9_-]+\.md)/);
  return match ? match[1] : null;
}

function extractBytes(text) {
  const m =
    text.match(/(\d+)\s*bytes?|\b(\d+)\s*chars?|written\s*(\d+)|(\d+)\s*B\b|bytesWritten["\s:]+(\d+)/i) ||
    text.match(/"size"\s*:\s*(\d+)/);
  return m ? parseInt(m[1] || m[2] || m[3] || m[4] || m[5], 10) : null;
}

function extractToolName(text) {
  const m = text.match(/tool=([a-z_]+)/i) || text.match(/tool\s*[=:]\s*["']?([a-z_]+)/i);
  return m ? m[1] : null;
}

function extractRunId(text) {
  const m = text.match(/runId=([^\s,]+)/) || text.match(/runId["']?\s*[=:]\s*["']?([^\s"',]+)/);
  return m ? m[1] : null;
}

function extractSessionId(text) {
  const m = text.match(/sessionId=([^\s,]+)/) || text.match(/sessionId["']?\s*[=:]\s*["']?([^\s"',]+)/);
  return m ? m[1] : null;
}

function summarizePrompt(text) {
  const truncated = text.length > 120 ? text.slice(0, 120) + "…" : text;
  return truncated.replace(/\n/g, " ").trim();
}

/** For md_write: keep full content (up to 100k) so summarization and modal can use it. */
function fullContentForMdWrite(text) {
  const t = (text || "").trim();
  const max = 100_000;
  return t.length > max ? t.slice(0, max) + "\n…[truncated]" : t;
}

/** Extract the actual user message from Discord-style format: "[...] Name (handle): message" */
function extractUserMessageText(text) {
  const match = text.match(/\):\s*([^\n]+)/);
  if (match) {
    let msg = match[1].trim();
    msg = msg.replace(/\s*\[from:\s*[^\]]+\]\s*$/i, "").replace(/<@\d+>/g, "").trim();
    if (msg.length > 0) return msg;
  }
  const withoutBlocks = text.replace(/<<<EXTERNAL_UNTRUSTED_CONTENT>>>[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>/g, "").trim();
  const firstLine = withoutBlocks.split("\n")[0] || "";
  const m2 = firstLine.match(/\):\s*(.+)/);
  if (m2) return m2[1].trim();
  const lines = withoutBlocks.split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.startsWith("[") && !/message_id|^\[from:/i.test(t)) return t;
  }
  return text;
}

/** Build assistant content with actual response (text) first, then thinking - for better embedding quality */
function buildAssistantMessageText(content) {
  const textParts = [];
  const thinkingParts = [];
  for (const c of content || []) {
    if (c?.text) textParts.push(c.text);
    if (c?.thinking) thinkingParts.push(c.thinking);
  }
  const text = textParts.join(" ").trim();
  const thinking = thinkingParts.join(" ").trim();
  return text ? (text + (thinking ? " " + thinking : "")) : thinking;
}

const events = [];
const mdWriteCounts = Object.fromEntries(MD_FILES.map((f) => [f, 0]));
const mdWriteBytes = Object.fromEntries(MD_FILES.map((f) => [f, 0]));

function addEvent(ev) {
  events.push(ev);
}

function processJsonlEvent(obj, sessionId, isCron) {
  const ts = getTimestamp(obj);
  if (!ts) return;
  const tsDate = new Date(ts);

  if (isCron) {
    const msg = obj.summary || obj.action || "";
    addEvent({
      time: tsDate.toISOString(),
      type: "cron",
      category: obj.status === "ok" ? "success" : "failure",
      message: summarizePrompt(msg),
      level: obj.status === "ok" ? "info" : "warn",
      subsystem: "cron",
      runId: obj.jobId,
      sessionId: obj.jobId,
    });
    const ml = msg.toLowerCase();
    if (ml.includes("email") && (ml.includes("sent") || ml.includes("responded") || ml.includes("reply")) && !ml.includes("0 responded")) {
      addEvent({ time: tsDate.toISOString(), type: "email_sent", category: "email", message: summarizePrompt(msg), level: "info", subsystem: "cron", runId: obj.jobId, sessionId: obj.jobId });
    }
    if (ml.includes("moltbook") && (ml.includes("post") || ml.includes("browse"))) {
      if (ml.includes("posted") || ml.includes("created") || ml.includes("new post")) {
        addEvent({ time: tsDate.toISOString(), type: "moltbook_post", category: "post", message: summarizePrompt(msg), level: "info", subsystem: "cron", runId: obj.jobId, sessionId: obj.jobId });
      }
    }
    const mdFile = extractMdFile(msg);
    if (mdFile) {
      mdWriteCounts[mdFile] = (mdWriteCounts[mdFile] ?? 0) + 1;
      const bytes = extractBytes(msg);
      if (bytes) mdWriteBytes[mdFile] = (mdWriteBytes[mdFile] ?? 0) + bytes;
      addEvent({
        time: tsDate.toISOString(),
        type: "md_write",
        category: mdFile,
        message: fullContentForMdWrite(msg),
        level: "info",
        subsystem: "cron",
        runId: obj.jobId,
        sessionId: obj.jobId,
        ...(bytes != null && { bytes }),
      });
    }
    return;
  }

  // Session event
  const msg = obj.message;
  if (!msg) return;

  const content = msg.content || [];
  const fullText = content
    .map((c) => (c && typeof c === "object" ? (c.text || c.thinking || JSON.stringify(c)) : String(c)))
    .filter(Boolean)
    .join(" ");

  // Tool call (from content)
  for (const c of content) {
    if (c && c.type === "toolCall" && c.name) {
      addEvent({
        time: tsDate.toISOString(),
        type: "tool_call",
        category: c.name,
        message: summarizePrompt(JSON.stringify(c.arguments || {})),
        level: "info",
        subsystem: "session",
        runId: obj.id,
        sessionId,
      });
      const argsStr = JSON.stringify(c.arguments || {});
      const toolName = (c.name || "").replace(/^functions\./, "");
      if (toolName === "write" || toolName === "edit") {
        const path = c.arguments?.path ?? c.arguments?.file_path ?? c.arguments?.target;
        const mdFile = path ? extractMdFile(path) : extractMdFile(argsStr);
        if (mdFile) {
          const bytes = c.arguments?.content ? String(c.arguments.content).length : extractBytes(argsStr);
          mdWriteCounts[mdFile] = (mdWriteCounts[mdFile] ?? 0) + 1;
          if (bytes) mdWriteBytes[mdFile] = (mdWriteBytes[mdFile] ?? 0) + bytes;
          addEvent({
            time: tsDate.toISOString(),
            type: "md_write",
            category: mdFile,
            message: fullContentForMdWrite(c.arguments?.content || argsStr),
            level: "info",
            subsystem: "session",
            runId: obj.id,
            sessionId,
            ...(bytes != null && { bytes }),
          });
        }
      }
      if (c.name === "send_email" || c.name === "sessions_send") {
        addEvent({ time: tsDate.toISOString(), type: "email_sent", category: "email", message: summarizePrompt(argsStr), level: "info", subsystem: "session", runId: obj.id, sessionId });
      }
      if (c.name === "exec" && (argsStr.includes("moltbook") || argsStr.includes("moltbook.com"))) {
        if (/moltbook\.sh\s+create|moltbook\.sh\s+post|api\/posts.*POST|POST.*moltbook\.com\/api\/posts/i.test(argsStr)) {
          addEvent({ time: tsDate.toISOString(), type: "moltbook_post", category: "post", message: summarizePrompt(argsStr), level: "info", subsystem: "session", runId: obj.id, sessionId });
        }
        if (/moltbook\.sh\s+reply|api\/posts\/[^/]+\/comments|reply.*POST/i.test(argsStr)) {
          addEvent({ time: tsDate.toISOString(), type: "moltbook_comment", category: "comment", message: summarizePrompt(argsStr), level: "info", subsystem: "session", runId: obj.id, sessionId });
        }
      }
    }
  }

  // User message (for semantic search)
  if (msg.role === "user" && fullText.trim()) {
    const cleanText = extractUserMessageText(fullText);
    const displayMsg = cleanText.length > 1500 ? cleanText.slice(0, 1500) + "…" : cleanText;
    addEvent({
      time: tsDate.toISOString(),
      type: "user_message",
      category: "user",
      message: displayMsg,
      level: "info",
      subsystem: "session",
      runId: obj.id,
      sessionId,
      role: "user",
      embeddingText: cleanText.length > 512 ? cleanText.slice(0, 512) : cleanText,
    });
  }

  // Assistant message (for semantic search)
  if (msg.role === "assistant" && fullText.trim()) {
    const cleanText = buildAssistantMessageText(content);
    const displayMsg = cleanText.length > 1500 ? cleanText.slice(0, 1500) + "…" : cleanText;
    addEvent({
      time: tsDate.toISOString(),
      type: "assistant_message",
      category: "assistant",
      message: displayMsg,
      level: "info",
      subsystem: "session",
      runId: obj.id,
      sessionId,
      role: "assistant",
      embeddingText: cleanText.length > 512 ? cleanText.slice(0, 512) : cleanText,
    });
  }

  // Tool result (message.role === "toolResult")
  if (msg.role === "toolResult" && msg.toolName) {
    const resultText = (msg.content || []).map((x) => x?.text || "").join(" ");
    const isError = resultText.includes("error") || resultText.includes("Error") || msg.isError;
    addEvent({
      time: tsDate.toISOString(),
      type: isError ? "failure" : "success",
      category: msg.toolName,
      message: summarizePrompt(resultText || JSON.stringify(msg.details || {})),
      level: isError ? "error" : "info",
      subsystem: "session",
      runId: obj.id,
      sessionId,
    });
    const toolName = (msg.toolName || "").replace(/^functions\./, "");
    if ((toolName === "write" || toolName === "edit") && /successfully\s+(wrote|replaced|updated)/i.test(resultText)) {
      const mdFile = extractMdFile(resultText);
      if (mdFile) {
        const bytes = extractBytes(resultText);
        mdWriteCounts[mdFile] = (mdWriteCounts[mdFile] ?? 0) + 1;
        if (bytes) mdWriteBytes[mdFile] = (mdWriteBytes[mdFile] ?? 0) + bytes;
        addEvent({
          time: tsDate.toISOString(),
          type: "md_write",
          category: mdFile,
          message: fullContentForMdWrite(resultText),
          level: "info",
          subsystem: "session",
          runId: obj.id,
          sessionId,
          ...(bytes != null && { bytes }),
        });
      }
    }
    const rt = resultText.toLowerCase();
    const doneMatch = resultText.match(/Done:\s*(\d+)\s+unread,\s*(\d+)\s+responded/i);
    if ((msg.toolName === "process" || msg.toolName === "exec") && rt.includes("email") && (
      /sent\s+email|reply\s+sent|email\s+sent|responded\s+to/i.test(rt) ||
      (doneMatch && parseInt(doneMatch[2], 10) > 0)
    )) {
      addEvent({ time: tsDate.toISOString(), type: "email_sent", category: "email", message: summarizePrompt(resultText), level: "info", subsystem: "session", runId: obj.id, sessionId });
    }
    if ((msg.toolName === "process" || msg.toolName === "exec") && (rt.includes("moltbook") || rt.includes("moltbook.com")) && (/"success"\s*:\s*true|post\s+created|created\s+post/i.test(rt))) {
      addEvent({ time: tsDate.toISOString(), type: "moltbook_post", category: "post", message: summarizePrompt(resultText), level: "info", subsystem: "session", runId: obj.id, sessionId });
    }
    if ((msg.toolName === "process" || msg.toolName === "exec") && (rt.includes("moltbook") || rt.includes("moltbook.com")) && (/"success"\s*:\s*true|reply\s+posted|comment\s+posted|posted\s+reply/i.test(rt))) {
      addEvent({ time: tsDate.toISOString(), type: "moltbook_comment", category: "comment", message: summarizePrompt(resultText), level: "info", subsystem: "session", runId: obj.id, sessionId });
    }
  }

  // md_write now only from write/edit tool calls and results (not from assistant text mentions — that included reads)
}

function processLogFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  const isCron = filePath.includes("cron_snap");
  const sessionId = path.basename(filePath, path.extname(filePath));

  for (const line of lines) {
    const obj = parseJsonLine(line);
    if (!obj) continue;

    // Handle session/cron jsonl format
    if (obj.type === "message" || obj.type === "session" || (isCron && (obj.ts || obj.runAtMs))) {
      processJsonlEvent(obj, sessionId, isCron);
      continue;
    }

    const ts = getTimestamp(obj);
    const msg = getMessage(obj);
    const level = getLevel(obj);
    const subsystem = getSubsystem(obj);

    if (!ts || !msg) continue;

    const tsDate = new Date(ts);

    // MD file write / update (plain logs: only if message indicates write, not read)
    const ml = msg.toLowerCase();
    const isWrite = /\b(wrote|written|updated|edited|replaced)\b/i.test(ml) || extractBytes(msg) != null;
    const mdFile = extractMdFile(msg);
    if (mdFile && isWrite) {
      mdWriteCounts[mdFile] = (mdWriteCounts[mdFile] ?? 0) + 1;
      const bytes = extractBytes(msg);
      if (bytes) mdWriteBytes[mdFile] = (mdWriteBytes[mdFile] ?? 0) + bytes;
      addEvent({
        time: tsDate.toISOString(),
        type: "md_write",
        category: mdFile,
        message: fullContentForMdWrite(msg),
        level,
        subsystem,
        runId: extractRunId(msg),
        sessionId: extractSessionId(msg),
        ...(bytes != null && { bytes }),
      });
    }

    // Tool call
    const tool = extractToolName(msg);
    if (tool && (msg.includes("tool start") || msg.includes("run tool") || msg.includes("tool_call"))) {
      addEvent({
        time: tsDate.toISOString(),
        type: "tool_call",
        category: tool,
        message: summarizePrompt(msg),
        level,
        subsystem,
        runId: extractRunId(msg),
        sessionId: extractSessionId(msg),
      });
    }

    // Run lifecycle
    if (msg.includes("run agent start") || msg.includes("run agent end")) {
      addEvent({
        time: tsDate.toISOString(),
        type: "run_lifecycle",
        category: msg.includes("start") ? "start" : "end",
        message: summarizePrompt(msg),
        level,
        subsystem,
        runId: extractRunId(msg),
        sessionId: extractSessionId(msg),
      });
    }

    // Heartbeat
    if (msg.toLowerCase().includes("heartbeat") && !msg.includes("HEARTBEAT.md")) {
      addEvent({
        time: tsDate.toISOString(),
        type: "heartbeat",
        category: "heartbeat",
        message: summarizePrompt(msg),
        level,
        subsystem,
        runId: extractRunId(msg),
        sessionId: extractSessionId(msg),
      });
    }

    // Errors / failures
    if (level === "error" || level === "fatal" || msg.toLowerCase().includes("failed") || msg.toLowerCase().includes("error")) {
      addEvent({
        time: tsDate.toISOString(),
        type: "failure",
        category: "error",
        message: summarizePrompt(msg),
        level,
        subsystem,
        runId: extractRunId(msg),
        sessionId: extractSessionId(msg),
      });
    }

    // Success indicators (e.g. HEARTBEAT_OK, completion)
    if (msg.includes("HEARTBEAT_OK") || msg.includes("completed successfully") || msg.includes("run agent end")) {
      addEvent({
        time: tsDate.toISOString(),
        type: "success",
        category: "success",
        message: summarizePrompt(msg),
        level,
        subsystem,
        runId: extractRunId(msg),
        sessionId: extractSessionId(msg),
      });
    }
  }
}

// Run
const files = getLogFiles();
if (files.length === 0) {
  console.log("No log files in ./logs/. Run: node scripts/copy-logs.js");
  console.log("Or: node scripts/generate-sample-logs.js (for demo)");
  console.log("Writing empty events.json for demo UI.");
}

for (const f of files) {
  processLogFile(f);
}

// Ensure public exists and write output even when empty
fs.mkdirSync(publicDir, { recursive: true });

// Dedupe events (same time+type+category+message)
const seen = new Set();
const uniqueEvents = events.filter((e) => {
  const key = `${e.time}|${e.type}|${e.category}|${e.message}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

uniqueEvents.sort((a, b) => new Date(a.time) - new Date(b.time));

const activityCounts = {
  email_sent: uniqueEvents.filter((e) => e.type === "email_sent").length,
  moltbook_post: uniqueEvents.filter((e) => e.type === "moltbook_post").length,
  moltbook_comment: uniqueEvents.filter((e) => e.type === "moltbook_comment").length,
};

// Build summary
const summary = {
  mdWriteCounts,
  mdWriteBytes,
  activityCounts,
  totalEvents: uniqueEvents.length,
  eventTypes: [...new Set(uniqueEvents.map((e) => e.type))],
  timeRange: uniqueEvents.length
    ? {
        start: uniqueEvents[0].time,
        end: uniqueEvents[uniqueEvents.length - 1].time,
      }
    : null,
};

fs.writeFileSync(
  outputPath,
  JSON.stringify({ events: uniqueEvents, summary }, null, 2),
  "utf-8",
);

console.log(`Parsed ${files.length} log file(s) -> ${uniqueEvents.length} events`);
console.log(`Output: ${outputPath}`);
console.log("MD write counts:", summary.mdWriteCounts);
console.log("Activity:", summary.activityCounts);
