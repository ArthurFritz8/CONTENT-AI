// Fallbacks apenas — valores efetivos vêm de system_config (zero hardcoded em runtime).

export const DEFAULT_RENDER_DISPATCH_TTL_MINUTES = 45;
export const DEFAULT_RETRY_OPTIONS = {
  retries: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
} as const;
export const RENDER_WORKFLOW_FILE = "render.yml";
