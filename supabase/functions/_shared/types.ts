// Tipos compartilhados entre Edge Functions — espelham os CHECKs do schema (ADR-002).

export type EpisodeStatus =
  | "idea"
  | "research"
  | "script"
  | "assets"
  | "rendered"
  | "review"
  | "published"
  | "analyze"
  | "failed";

export type JobEventType =
  | "script_generated"
  | "assets_generated"
  | "render_started"
  | "render_completed"
  | "render_checkpoint_saved"
  | "qa_passed"
  | "qa_failed"
  | "publish_started"
  | "publish_completed"
  | "analyze_completed"
  | "heartbeat_sent"
  | "budget_exceeded"
  | "failed"
  | "tts_fallback_triggered"
  | "state_transition"
  | "approval_received"
  | "approval_rejected"
  | "tts_engine_selected"
  | "tts_consistency_regeneration"
  | "research_completed"
  | "gemini_call";

export interface JobEventInsert {
  episode_id?: string;
  event_type: JobEventType;
  model_used?: string;
  prompt_version?: string;
  cost_estimate?: number;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

export interface RenderDispatchMeta {
  dispatched_at: string;
  attempt: number;
  target: "github_actions";
}
