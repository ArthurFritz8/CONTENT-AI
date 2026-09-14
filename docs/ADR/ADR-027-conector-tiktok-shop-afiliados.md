# ADR-027 — Conector TikTok Shop para catálogo de afiliados

## Objetivo

Preparar a descoberta e a geração automática de links de produtos do TikTok Shop sem colocar credenciais no modelo, no Telegram ou no Git.

## Contexto

O Partner Center documenta a Creator Affiliate API para buscar produtos em colaboração aberta e gerar links gerais/publicadores. O acesso não é público por padrão: exige aplicativo de parceiro aprovado, autorização da conta de criador, escopos e tokens próprios. A assinatura usa `app_secret + path + query ordenada + body + app_secret` com HMAC-SHA256. A conta atual ainda não possui essa aprovação.

## Solução

- Adicionar cliente Deno assinado, com timeout, validação de página, envelope `code/request_id` e mensagens que nunca incluem token ou segredo.
- Implementar a busca de colaborações abertas (`affiliate_creator/202405/open_collaborations/products/search`) e a geração geral de links (`affiliate_creator/202505/affiliate_sharing_links/general_publishers/generate_batch`).
- Ler `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET` e `TIKTOK_SHOP_CREATOR_ACCESS_TOKEN` apenas do ambiente seguro. Ausência retorna `TIKTOK_SHOP_NOT_CONFIGURED`; não cai silenciosamente em HTTP público.
- Manter a pauta manual como fallback até a aprovação do Partner Center. A próxima etapa, depois do primeiro smoke real, será persistir snapshot do produto/link/comissão e conectar a seleção ao Telegram/orchestrator.

## Impacto e limites

Este commit não faz chamadas reais nem altera o pipeline pausado. Os endpoints e escopos podem variar por região/versão; a versão e o caminho permanecem configuráveis no cliente. A busca só retorna oportunidades de colaboração aberta da região autorizada e não garante aprovação, estoque, comissão ou conversão. Link promocional não substitui anexar o produto ao conteúdo quando o TikTok exigir showcase/shoppable content.

## Prevenção e rollback

Testes cobrem assinatura, ordenação, token no header, payload, paginação inválida e envelopes de erro sem vazamento. Reverter o commit remove o cliente sem modificar episódios ou links manuais. Antes de ativar, validar com conta de desenvolvimento e uma única consulta de catálogo.
