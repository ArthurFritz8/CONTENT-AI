-- ADR-045: compact fiction uses the already budgeted free text model; factual research stays unchanged.
update public.system_config
set value = value || '{"gemini_model":"gemini-3.1-flash-lite"}'::jsonb
where key='story_production' and not (value ? 'gemini_model');
