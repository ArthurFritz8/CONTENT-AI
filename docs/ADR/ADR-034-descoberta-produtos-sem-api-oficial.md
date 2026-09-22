# ADR-034 — Descoberta de candidatos a produto sem API oficial ativa

## Objetivo

Manter a descoberta automática de possíveis produtos para vídeos enquanto o aplicativo do TikTok Shop Partner Center não pode concluir a aprovação empresarial, sem fabricar elegibilidade afiliada e sem remover o conector oficial preparado no ADR-027.

## Contexto

- A documentação brasileira do TikTok Shop permite que o **criador afiliado** verifique identidade e tributação com CPF. CNPJ é opcional para criadores elegíveis que desejam migrar a verificação fiscal.
- A **Affiliate Creator API**, porém, não é liberada só porque o criador possui CPF: o aplicativo precisa existir no Partner Center, ter os escopos aprovados e ser liberado para creator authorization. A Affiliate API permanece inativa por padrão e depende da análise do parceiro/ISV.
- O cadastro empresarial disponível ao operador está inativo, bloqueando hoje a aprovação do aplicativo. Por isso, implementar o callback OAuth agora não produziria um token utilizável em produção.
- SocialCrawl documenta busca de produtos com `region=BR`, mas não confirma comissão, vínculo afiliado ou autorização do TikTok. Trends MCP fornece um quadro geral de produtos quentes, sem confirmar disponibilidade regional, estoque ou elegibilidade.
- SociaVault, Apify, scraping próprio e emuladores ficam excluídos porque dependem explicitamente de scraping ou automação não autorizada.

## Solução

1. Preservar `affiliate-catalog` e `_shared/tiktok-shop.ts` para reativação futura do caminho oficial.
2. Estender `discover-trends` com uma cascata de **sinais**, nesta ordem:
   - SocialCrawl (`region=BR`);
   - Trends MCP (`TikTok Shop Hot Products`);
   - Tavily/Hacker News, já aprovados no ADR-032.
3. Toda resposta externa entra apenas em `idea_queue` com `source='trend_discovery'`, prioridade 500 e texto explícito de que se trata de candidato não confirmado.
4. Não preencher `product_url` nem `product_image_url` a partir dessas fontes. No schema atual, `product_url` transforma a ideia em conteúdo comercial ao ser consumida; isso seria incorreto sem link afiliado oficial.
5. Exigir revisão humana para confirmar disponibilidade no Brasil, elegibilidade, comissão e vínculo afiliado antes da produção.
6. Controlar fontes em `system_config.trend_sources` e reservar quota diária atomicamente em `api_budget_usage` por meio de `reserve_trend_source_call`.
7. Falha, ausência de chave, quota esgotada ou retorno vazio em uma fonte aciona a próxima; nenhuma fonte isolada derruba a execução.

## Prevenção

- Os clientes validam respostas com Zod, aceitam somente URLs HTTPS e usam timeout de 20 segundos com retry limitado a falhas transitórias.
- Testes mockam todas as APIs e comprovam a ordem da cascata, o limite da fila e a ausência de `product_url`/`product_image_url` nas sugestões.
- `trend_discovery.enabled=false` permanece como trava global. Cotas por fonte são configuráveis e começam conservadoras.
- SocialCrawl é uma integração removível e não é considerada fonte oficial. Se os termos, a proveniência ou a cobertura BR deixarem de ser aceitáveis, basta desabilitá-la em `trend_sources` sem alterar o pipeline.
- Quando o cadastro empresarial puder ser aprovado, uma nova revisão deste ADR deve restaurar a API oficial como confirmação primária e implementar OAuth conforme o ADR-027.
