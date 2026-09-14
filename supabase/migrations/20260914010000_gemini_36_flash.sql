-- Gemini 2.5 Flash is unavailable to new API users as of 2026-09-14.
-- Preserve conservative local limits while moving text and grounding to 3.6 Flash.

update public.system_config
set value = jsonb_set(
  jsonb_set(value, '{research_model}', '"gemini-3.6-flash"'::jsonb),
  '{text_model}', '"gemini-3.6-flash"'::jsonb
)
where key = 'gemini';

update public.system_config
set value = jsonb_set(
  value #- '{gemini_models,gemini-2.5-flash}',
  '{gemini_models,gemini-3.6-flash}',
  '{"rpd":20,"rpm":5}'::jsonb,
  true
)
where key = 'budget';
