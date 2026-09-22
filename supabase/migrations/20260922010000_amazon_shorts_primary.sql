-- ADR-035 — Amazon Best Sellers como fonte primária de candidatos para Shorts.
-- A monetização começa desativada e só pode ser habilitada após validação manual
-- do ASIN e criação do link especial no SiteStripe do Programa de Associados.

update system_config
set value = jsonb_set(value, '{primary}', '"trends_mcp"'::jsonb, true)
where key = 'trend_sources';

insert into system_config (key, value) values
  ('amazon_associates', '{
    "enabled": false,
    "marketplace": "amazon.com.br",
    "link_mode": "manual_sitestripe",
    "associate_tag": null,
    "youtube_channel_url": null,
    "shorts_destination": "channel_profile",
    "require_manual_asin_validation": true,
    "require_disclosure": true
  }'::jsonb)
on conflict (key) do nothing;
