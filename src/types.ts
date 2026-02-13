export interface LogEvent {
  time: string;
  type: string;
  category: string;
  message: string;
  level?: string;
  subsystem?: string;
  runId?: string;
  sessionId?: string;
  /** Size of write in bytes (for md_write events) */
  bytes?: number;
  /** Precomputed summary (from summarize-events script) */
  summary?: string;
  /** Precomputed embedding (from embed-events script) for semantic search */
  embedding?: number[];
  /** For user_message/assistant_message events: "user" | "assistant" */
  role?: "user" | "assistant";
  /** Clean text used for embedding (overrides message when present) */
  embeddingText?: string;
}

export interface Summary {
  mdWriteCounts: Record<string, number>;
  mdWriteBytes: Record<string, number>;
  activityCounts?: { email_sent: number; moltbook_post: number; moltbook_comment: number };
  totalEvents: number;
  eventTypes: string[];
  timeRange: { start: string; end: string } | null;
}

export interface EventsData {
  events: LogEvent[];
  summary: Summary;
}
