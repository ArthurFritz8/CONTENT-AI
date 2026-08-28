-- CONTENT AI — Schema inicial
-- Decisões documentadas em: ADR-001 (arquitetura), ADR-002 (máquina de estados)

-- ============================================================
-- TABELA: episodes — entidade central da máquina de estados
-- ============================================================
create table episodes (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'idea'
    check (status in ('idea','research','script','assets','rendered','review','published','analyze','failed')),
  failure_reason text,
  briefing jsonb,
  research_data jsonb,
  product_image_url text,
  script_json jsonb,
  script_hash text unique,
  metadata jsonb,
  render_url text,
  render_progress int not null default 0 check (render_progress >= 0 and render_progress <= 100),
  qa_score float,
  product_compliance jsonb,
  approval_user text,
  approval_date timestamptz,
  prompt_version text,
  tts_engine text check (tts_engine in ('gemini','edge','piper')),
  analytics_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- impossivel marcar failed sem justificar (auditabilidade)
  constraint failed_requires_reason check (status <> 'failed' or failure_reason is not null)
);

-- ============================================================
-- TABELA: assets — mídia com rastreio de licença (compliance)
-- ============================================================
create table assets (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  type text not null check (type in ('image','audio','subtitle','music','video_clip')),
  url text not null,
  license text not null check (license in ('pexels','generated','youtube_audio_library','own')),
  source text not null check (source in ('gemini','edge','piper','pexels','youtube_audio','manual','affiliate','system')),
  author text,
  hash text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- TABELA: publishes — 1 episódio pode publicar em N plataformas
-- ============================================================
create table publishes (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  platform text not null check (platform in ('youtube','tiktok','tiktok_shop')),
  external_id text,
  status text not null default 'pending'
    check (status in ('pending','processing','published','failed')),
  commercial_disclosure boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- TABELA: job_events — trilha de auditoria (logger estruturado grava aqui)
-- ============================================================
create table job_events (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid references episodes(id) on delete cascade,
  event_type text not null check (event_type in (
    'script_generated','assets_generated','render_started','render_completed',
    'render_checkpoint_saved','qa_passed','qa_failed','publish_started',
    'publish_completed','analyze_completed','heartbeat_sent','budget_exceeded',
    'failed','tts_fallback_triggered',
    'state_transition','approval_received','approval_rejected',
    'tts_engine_selected','tts_consistency_regeneration',
    'research_completed','gemini_call',
    'images_generated','tts_generated','subtitles_generated'
  )),
  model_used text,
  prompt_version text,
  cost_estimate float,
  error_message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- TABELA: prompt_versions — semver de prompts (A/B + reprodutibilidade)
-- ============================================================
create table prompt_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  content text not null,
  changelog text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, version)
);

-- ============================================================
-- TABELA: system_config — budget guard e flags (zero hardcoded)
-- ============================================================
create table system_config (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- ÍNDICES
-- ============================================================
create index idx_episodes_status on episodes(status);
create index idx_episodes_script_hash on episodes(script_hash);
create index idx_assets_episode_id on assets(episode_id);
create index idx_publishes_episode_id on publishes(episode_id);
create index idx_job_events_episode_id on job_events(episode_id);
create index idx_job_events_created_at on job_events(created_at);
-- no máximo UMA versão ativa por prompt (evita ambiguidade no runtime)
create unique index idx_prompt_versions_one_active on prompt_versions(name) where is_active;

-- ============================================================
-- TRIGGER: updated_at automático
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger episodes_updated_at before update on episodes
for each row execute function update_updated_at();

create trigger system_config_updated_at before update on system_config
for each row execute function update_updated_at();

-- ============================================================
-- TRIGGER: máquina de estados imposta pelo banco (ADR-002)
-- Transições legais:
--   idea→research→script→assets→rendered→review→published→analyze
--   review→script|assets (botão "Refazer" do Telegram)
--   qualquer→failed | failed→qualquer estado do pipeline (retry)
-- ============================================================
create or replace function validate_episode_transition()
returns trigger as $$
declare
  allowed text[];
begin
  if old.status = new.status then
    return new;
  end if;

  allowed := case old.status
    when 'idea'      then array['research','failed']
    when 'research'  then array['script','failed']
    when 'script'    then array['assets','failed']
    when 'assets'    then array['rendered','failed']
    when 'rendered'  then array['review','failed']
    when 'review'    then array['published','script','assets','failed']
    when 'published' then array['analyze','failed']
    when 'analyze'   then array['failed']
    when 'failed'    then array['idea','research','script','assets','rendered','review']
    else array[]::text[]
  end;

  if not (new.status = any(allowed)) then
    raise exception 'Transicao de estado invalida: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger episodes_validate_transition before update of status on episodes
for each row execute function validate_episode_transition();

-- ============================================================
-- SEGURANÇA: RLS em todas as tabelas, sem policies.
-- Somente service_role (Edge Functions) acessa; anon key fica bloqueada.
-- ============================================================
alter table episodes enable row level security;
alter table assets enable row level security;
alter table publishes enable row level security;
alter table job_events enable row level security;
alter table prompt_versions enable row level security;
alter table system_config enable row level security;
