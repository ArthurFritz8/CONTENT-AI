-- CONTENT AI — seed de configuração (budget guard config-driven, zero hardcoded)
-- Valores conservadores; calibrar com números reais do AI Studio antes de produção.

insert into system_config (key, value) values
  ('budget', '{
    "gemini_requests_per_day_max": 100,
    "gemini_grounding_requests_per_day_max": 20,
    "gemini_image_requests_per_day_max": 10,
    "actions_minutes_per_month_max": 2500,
    "hard_stop_on_exceed": true
  }'::jsonb),
  ('gemini', '{
    "research_model": "gemini-2.5-flash",
    "text_model": "gemini-2.5-flash",
    "research_max_claims": 12,
    "script_temperature": 0.7
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
  }'::jsonb),
  ('niche', '{
    "name": "gadgets_produtos_inovadores",
    "categories": ["tech_gadgets", "home_innovations", "productivity_tools"],
    "focus": "produtos que resolvem um problema real de forma criativa",
    "editorial_angle": ["hook_voce_nao_vai_acreditar", "demonstracao", "comparacao", "cta"],
    "risk_level": "low_medium"
  }'::jsonb),
  ('fact_check', '{
    "risk_level": "low_medium",
    "blocked_patterns": {
      "medical": ["\\mtrata\\M", "\\mcura\\M", "\\mprevine\\M", "\\memagrece\\M"],
      "financial": ["melhor investimento", "garante retorno", "renda garantida"],
      "absolute_superlatives": ["o melhor do mundo", "unico no mercado", "único no mercado"]
    },
    "allowed_categories": ["comparacoes_relativas", "claims_funcionalidade", "opinioes_qualificadas"],
    "require_source_per_claim": true
  }'::jsonb)
on conflict (key) do nothing;
