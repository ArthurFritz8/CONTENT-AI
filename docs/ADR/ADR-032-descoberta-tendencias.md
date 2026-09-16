# ADR-032 — Descoberta automática de tendências (Tavily + Hacker News)

## Objetivo

Sugerir pautas automaticamente a partir de fontes gratuitas e sem restrição de uso comercial, sem substituir a curadoria humana decidida no ADR-007 ("fila curada via Telegram... trending-discovery fica como evolução futura, exigirá ADR próprio" — este é esse ADR).

## Contexto

Pesquisa de APIs gratuitas de "produtos em alta" (pedido do usuário) encontrou:
- **Product Hunt API**: gratuita, mas seus termos dizem explicitamente que **não pode ser usada para fins comerciais** sem contato prévio (`hello@producthunt.com`). Nosso canal é comercial (afiliados) — **vetado** até autorização explícita da Product Hunt.
- **Reddit API**: gratuita em baixo volume, mas zona cinzenta para conteúdo comercial pós-mudança de termos de 2023 — **deixado de fora** por decisão do usuário (optou pela combinação mais segura).
- **Hacker News (Algolia)**: gratuita, sem chave, sem restrição de uso comercial encontrada, 10.000 req/hora — **aprovada**.
- **Tavily**: já integrado e vetado para uso comercial (ADR-023) — **aprovada**, reaproveita client e orçamento existentes.

## Decisão

- Nova Edge Function `discover-trends`: intercala Tavily e Hacker News por dia (par/ímpar do dia UTC), sem gastar Gemini.
- **Nunca cria episódio diretamente.** Só insere sugestões em `idea_queue` com `source='trend_discovery'`, `priority=500` (pautas manuais usam o default 100 — humano sempre é consumido primeiro) e `dedupe_key` (evita redescobrir o mesmo link).
- `system_config.trend_discovery.enabled=false` por padrão — mesma disciplina do spokesmodel/pipeline: existir no código não significa estar ativo.
- Cap próprio (`max_pending`, default 5): não enche a fila além disso, independente do `telegram_queue.max_pending` (que rege só as inserções manuais via bot).
- Agendada 1x/dia via `configure_content_ai_scheduler` (mesma função que já agenda o `orchestrator-tick`), sempre que o operador rodar `deploy.sh`/reconfigurar o scheduler. Segura por padrão: com `enabled=false`, a chamada diária apenas retorna `{paused:true}`, sem custo.
- Toda sugestão nasce sem `product_url` (sem link de afiliado inventado) e com um briefing que pede explicitamente validação humana ("Validar se é mesmo um produto/gadget coerente com o canal antes de aprovar").

## Impacto e limites

- Continua exigindo `pipeline.enabled=true` para qualquer ideia (manual ou descoberta) virar episódio, e a revisão antes de publicar continua obrigatória — nenhuma trava existente foi enfraquecida.
- Product Hunt e Reddit ficam de fora da automação; se o usuário quiser reativá-los depois, Product Hunt exige e-mail de autorização comercial antes, e Reddit exigiria nova análise de volume/ToS.
- `/fila` do Telegram ainda não distingue visualmente pautas manuais de descobertas nesta entrega — próxima melhoria natural, não bloqueante.

## Prevenção

- Testes cobrem: `hackerNewsSearch` filtra itens sem título/URL/HTTPS e propaga erro HTTP; `discover-trends` não faz nada com a feature desligada e nunca excede `max_pending` nem cria com prioridade menor que pautas manuais.
- Qualquer nova fonte de tendência deve passar pelo mesmo crivo: ler os termos de uso reais antes de integrar, nunca assumir "gratuito = permitido para uso comercial".
