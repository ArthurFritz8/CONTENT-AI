-- ADR-024: research uses the stable free Flash model when 3.6 is temporarily saturated.
update public.system_config
set value = jsonb_set(value, '{research_model}', '"gemini-3.5-flash"'::jsonb)
where key = 'gemini';

update public.system_config
set value = jsonb_set(value, '{gemini_models,gemini-3.5-flash}', '{"rpd":20,"rpm":5}'::jsonb, true)
where key = 'budget';
