-- ADR-024 follow-up: Flash-Lite is the available low-latency research model.
update public.system_config
set value = jsonb_set(value, '{research_model}', '"gemini-3.1-flash-lite"'::jsonb)
where key = 'gemini';

update public.system_config
set value = jsonb_set(value, '{gemini_models,gemini-3.1-flash-lite}', '{"rpd":20,"rpm":5}'::jsonb, true)
where key = 'budget';
