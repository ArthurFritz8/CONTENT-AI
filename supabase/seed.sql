-- CONTENT AI — seed de configuração (budget guard config-driven, zero hardcoded)
-- Valores conservadores; calibrar com números reais do AI Studio antes de produção.

insert into system_config (key, value) values
  ('budget', '{
    "gemini_requests_per_day_max": 100,
    "gemini_grounding_requests_per_day_max": 20,
    "gemini_research_requests_per_day_max": 20,
    "gemini_image_requests_per_day_max": 10,
    "gemini_tts_requests_per_day_max": 50,
    "tavily_search_requests_per_month_max": 100,
    "tavily_search_requests_per_minute_max": 5,
    "gemini_models": {
      "gemini-3.5-flash": {"rpd": 20, "rpm": 5},
      "gemini-3.6-flash": {"rpd": 20, "rpm": 5},
      "gemini-3.1-flash-lite": {"rpd": 20, "rpm": 5},
      "gemini-2.5-flash-preview-tts": {"rpd": 10, "rpm": 3}
    },
    "actions_minutes_per_month_max": 2500,
    "hard_stop_on_exceed": true
  }'::jsonb),
  ('gemini', '{
    "research_model": "gemini-3.1-flash-lite",
    "text_model": "gemini-3.6-flash",
    "research_max_claims": 12,
    "research_max_sources": 5,
    "script_temperature": 0.7
  }'::jsonb),
  ('assets', '{
    "image_generation_enabled": false,
    "image_model": "gemini-2.5-flash-image",
    "storage_bucket": "assets",
    "pexels_fallback_query": "technology gadget",
    "affiliate_image_max_bytes": 5242880,
    "affiliate_image_hosts": []
  }'::jsonb),
  ('spokesmodel', '{
    "enabled": false,
    "character_description": "Mulher jovem adulta, cabelo liso escuro comprido, aparelho dental discreto, regata bege neutra, fundo de estúdio bege claro, sorriso confiante e acolhedor.",
    "max_scenes_per_episode": 1,
    "fixed_photos": [
      {"pexels_id": 9774754, "landscape_url": "https://images.pexels.com/photos/9774754/pexels-photo-9774754.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", "portrait_url": "https://images.pexels.com/photos/9774754/pexels-photo-9774754.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800", "author": "SHVETS production", "pexels_url": "https://www.pexels.com/photo/smiling-woman-holding-aloft-cosmetic-container-9774754/"},
      {"pexels_id": 9774693, "landscape_url": "https://images.pexels.com/photos/9774693/pexels-photo-9774693.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", "portrait_url": "https://images.pexels.com/photos/9774693/pexels-photo-9774693.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800", "author": "SHVETS production", "pexels_url": "https://www.pexels.com/photo/smiling-woman-holding-container-of-cosmetic-product-9774693/"},
      {"pexels_id": 9774691, "landscape_url": "https://images.pexels.com/photos/9774691/pexels-photo-9774691.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", "portrait_url": "https://images.pexels.com/photos/9774691/pexels-photo-9774691.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800", "author": "SHVETS production", "pexels_url": "https://www.pexels.com/photo/smiling-woman-holding-aloft-cosmetic-9774691/"},
      {"pexels_id": 9775166, "landscape_url": "https://images.pexels.com/photos/9775166/pexels-photo-9775166.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", "portrait_url": "https://images.pexels.com/photos/9775166/pexels-photo-9775166.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800", "author": "SHVETS production", "pexels_url": "https://www.pexels.com/photo/woman-holding-cosmetic-products-9775166/"},
      {"pexels_id": 9774859, "landscape_url": "https://images.pexels.com/photos/9774859/pexels-photo-9774859.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", "portrait_url": "https://images.pexels.com/photos/9774859/pexels-photo-9774859.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800", "author": "SHVETS production", "pexels_url": "https://www.pexels.com/photo/smiling-woman-with-braces-holding-beauty-products-9774859/"},
      {"pexels_id": 9774679, "landscape_url": "https://images.pexels.com/photos/9774679/pexels-photo-9774679.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", "portrait_url": "https://images.pexels.com/photos/9774679/pexels-photo-9774679.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800", "author": "SHVETS production", "pexels_url": "https://www.pexels.com/photo/woman-with-braces-holding-plastic-box-of-cream-in-hand-9774679/"},
      {"pexels_id": 9774684, "landscape_url": "https://images.pexels.com/photos/9774684/pexels-photo-9774684.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", "portrait_url": "https://images.pexels.com/photos/9774684/pexels-photo-9774684.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800", "author": "SHVETS production", "pexels_url": "https://www.pexels.com/photo/woman-holding-plastic-container-for-cream-9774684/"}
    ]
  }'::jsonb),
  ('tts', '{
    "chain": ["gemini", "edge", "piper"],
    "voice_pt_br": "pt-BR-FranciscaNeural",
    "gemini_tts_model": "gemini-2.5-flash-preview-tts",
    "gemini_tts_voice": "Kore",
    "edge_endpoint_url": null,
    "piper_endpoint_url": null,
    "preflight_enabled": true,
    "preflight_text": "Teste de voz.",
    "gap_seconds_default": 0.5,
    "duration_deviation_warn_percent": 50
  }'::jsonb),
  ('render', '{
    "target": "github_actions",
    "fallback": "local_dev",
    "checkpoint_interval_percent": 10,
    "dispatch_ttl_minutes": 45
  }'::jsonb),
  ('trend_discovery', '{
    "enabled": false,
    "max_pending": 5,
    "query": null
  }'::jsonb),
  ('trend_sources', '{
    "primary": "trends_mcp",
    "socialcrawl": {
      "enabled": true,
      "region": "BR",
      "max_results": 5,
      "max_requests_per_day": 20
    },
    "trends_mcp": {
      "enabled": true,
      "max_results": 5,
      "max_requests_per_day": 3
    }
  }'::jsonb),
  ('amazon_associates', '{
    "enabled": false,
    "marketplace": "amazon.com.br",
    "link_mode": "manual_sitestripe",
    "associate_tag": null,
    "youtube_channel_url": null,
    "shorts_destination": "channel_profile",
    "require_manual_asin_validation": true,
    "require_disclosure": true
  }'::jsonb),
  ('pipeline', '{
    "enabled": false,
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
