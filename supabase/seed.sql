-- CONTENT AI — seed de configuração (budget guard config-driven, zero hardcoded)
-- Valores conservadores; calibrar com números reais do AI Studio antes de produção.

insert into system_config (key, value) values
  ('budget', '{
    "gemini_requests_per_day_max": 100,
    "gemini_image_requests_per_day_max": 10,
    "actions_minutes_per_month_max": 2500,
    "hard_stop_on_exceed": true
  }'::jsonb),
  ('tts', '{
    "chain": ["gemini", "edge", "piper"],
    "voice_pt_br": "pt-BR-FranciscaNeural",
    "preflight_enabled": true,
    "gap_seconds_default": 0.5,
    "duration_deviation_warn_percent": 50
  }'::jsonb),
  ('render', '{
    "target": "github_actions",
    "fallback": "local_dev",
    "checkpoint_interval_percent": 10,
    "dispatch_ttl_minutes": 45
  }'::jsonb),
  ('pipeline', '{
    "max_episodes_per_day": 1,
    "auto_publish": false,
    "require_human_approval": true
  }'::jsonb)
on conflict (key) do nothing;
