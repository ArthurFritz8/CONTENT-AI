-- ADR-031: personagem fixo via pool curado de fotos Pexels (mesma pessoa, fotoshoot
-- único, fotógrafo "SHVETS production") — substitui a proposta de geração paga do
-- ADR-030 (usuário optou por não gastar). Hotlink direto do CDN, mesma convenção
-- do ADR-009; nenhuma chamada Gemini nem orçamento envolvidos neste recurso.

insert into public.system_config (key, value) values
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
  }'::jsonb)
on conflict (key) do nothing;
