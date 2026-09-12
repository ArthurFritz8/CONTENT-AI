-- ADR-017: preserve provider evidence atomically with research; legacy rows stay nullable.
alter table public.episodes add column research_evidence jsonb;
alter table public.episodes add constraint research_evidence_bounded
  check (research_evidence is null or (
    jsonb_typeof(research_evidence) = 'object' and
    octet_length(research_evidence::text) <= 262144
  ));
comment on column public.episodes.research_evidence is
  'ADR-017: Gemini visible parts and grounding metadata. Citation evidence, not human factual approval.';
