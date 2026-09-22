# ADR-036 — Monetização como afiliado com link por plataforma

## Objetivo

Representar o operador como afiliado de produtos de terceiros, sem loja, estoque, emissão de nota ou CNPJ, e garantir que cada publicação utilize apenas o link afiliado válido para a própria plataforma.

## Contexto

- O candidato descoberto pelo pipeline continua sendo apenas uma pauta até a validação humana definida nos ADR-034/035.
- Links afiliados não são intercambiáveis. YouTube Shorts pode usar Amazon Associates, Shopee ou Hotmart; TikTok usa o vínculo do TikTok Shop.
- A [política oficial de elegibilidade de criadores](https://seller-br.tiktok.com/university/essay?knowledge_id=1396756526679824) exige ao menos 1.000 seguidores e dados pessoais, inclusive CPF. As [diretrizes de verificação](https://seller-br.tiktok.com/university/essay?knowledge_id=1415000913184513) confirmam que criadores afiliados individuais usam verificação de identidade e CPF; CNPJ aparece como opção posterior de verificação fiscal, não como requisito do criador individual. A entrada do operador está bloqueada pelo número de seguidores. O conector de Partner Center não será tratado como requisito para esse fluxo de criador.
- O schema antigo tinha `idea_queue.product_url` e `episodes.product_compliance.affiliate_link`, criados quando o YouTube era o único publicador automatizado. Eles precisam continuar legíveis durante a migração.
- `publishes.platform` já identifica o destino. A publicação precisa registrar o URL exato aprovado e usado, para auditoria e retomada idempotente.

## Solução

1. Adicionar `idea_queue.affiliate_links JSONB`, restrito às chaves `youtube` e `tiktok`, com URLs HTTPS sem credenciais. JSONB evita uma coluna nova para cada programa afiliado; a chave representa o destino, enquanto Amazon/Shopee/Hotmart continuam sendo provedores do mesmo destino YouTube.
2. Preservar `product_url` somente para compatibilidade. Um valor antigo é mapeado para YouTube conforme `system_config.affiliate_monetization.legacy_product_url_platform`; novos cadastros do painel gravam apenas `affiliate_links`.
3. Transferir o mapa validado para `episodes.product_compliance.affiliate_links` quando a pauta for consumida. O gerador injeta em cada descrição somente o link daquele destino e mantém o disclosure comercial do roteiro.
4. Adicionar `publishes.affiliate_url` como snapshot imutável do link efetivamente reservado para a publicação. O claim do YouTube rejeita episódios comerciais sem link de YouTube e nunca aceita um link TikTok como fallback.
5. Expor no painel campos separados para YouTube e TikTok e mostrar o link associado a cada publicação. O operador localiza o produto, confirma campanha/destino e cola manualmente o URL correto.
6. Centralizar disponibilidade, provedores, requisito mínimo do TikTok e regra de compatibilidade em `system_config.affiliate_monetization`. TikTok inicia desativado e YouTube habilitado.

## Prevenção

- A descoberta automática nunca preenche links nem afirma que há comissão; toda afiliação exige validação humana.
- Validação no frontend, RPC e banco rejeita protocolo inseguro, credenciais embutidas e chaves de plataforma desconhecidas.
- Links não atravessam plataformas. Uma publicação comercial só pode ser reservada quando existir link para seu destino; futuros publicadores TikTok devem aplicar a mesma regra antes do upload.
- A revisão humana mostra os links separados e exige conferir produto, campanha e validade antes da aprovação.
- O projeto não exige CNPJ, loja, estoque ou scraping. Integrações permanecem em free tiers e respeitam os termos de cada programa.
- Disclosure de possível comissão permanece no CTA e nos metadados comerciais aprovados. O link exato fica fora do texto gerado pelo modelo e é anexado pelo sistema.
