# ADR-020 — Cadastro e gestão da fila de ideias pelo Telegram

Data: 2026-09-12. Status: implementado; ativação real depende da configuração do usuário.

## Objetivo

Permitir que o operador envie pautas, acompanhe a fila e retire ideias pendentes pelo mesmo bot usado para revisão. Fechar a entrada humana do fluxo ideia → episódio, sem depender do SQL Editor para o uso diário.

## Contexto

ADR-007 já definiu a fila curada `idea_queue`, os estados `pending|consumed|rejected`, a prioridade e o consumo atômico. ADR-018 implementou o webhook autenticado e a revisão, mas deixou o cadastro de ideias pendente. Não é necessário criar outra fila, outro bot ou outro serviço.

A referência histórica do ADR-007 a executar o bot em `apps/local-renderer` não se aplica à implementação hospedada consolidada pelo ADR-018. Os comandos rodam na Edge Function `telegram-bot`, mantendo o requisito de não depender de PC ligado. O formato livre com comando explícito substitui a sugestão histórica de exigir `PRODUTO | DESCRIÇÃO | NOTAS`.

## Solução

- `/ideia descrição`: entre 20 e 2.000 caracteres, preservando o texto editorial. Uma linha opcional `Afiliado: https://...` preenche `product_url`; não é incorporada ao briefing. O consumidor existente propaga esse campo para `product_compliance` e obriga disclosure comercial. Links em outras linhas são referências do briefing, sem classificação automática como afiliado.
- `/fila`: mostra até dez ideias pendentes por prioridade/chegada, com IDs completos, e os três episódios consumidos mais recentes com seus estados. Informa se a geração está pausada. Continua disponível com os comandos de mutação desativados.
- `/cancelar ID_DA_IDEIA`: muda somente uma ideia `pending` para `rejected`, sem exclusão física. A mesma linha é travada pelo cancelamento e pelo consumidor existente. Se já foi consumida, retorna o ID do episódio e não o altera. A revisão humana continua responsável por aprovar/reprovar o vídeo.
- Nicho vem de `system_config.niche.name`; prioridade usa o padrão existente. Limites em `system_config.telegram_queue`: 20 pendentes e dez adições/dia UTC, inicialmente habilitado para comandos explícitos autenticados. Limites aceitam 1–100; configuração inválida bloqueia novas entradas. Retirar uma ideia não restitui o limite diário. `pipeline.enabled` permanece independente e inicialmente desativado.
- RPC `telegram_queue_command` grava o comando, sua identidade/payload, a alteração na fila e o resultado em uma única transação. A chave `update_id` deduplica entregas; reuso com identidade ou payload diferentes é rejeitado. Advisory lock serializa o cálculo dos limites das entradas pelo bot. Inserções administrativas diretas no SQL não passam por esses limites.
- Resposta ao Telegram ocorre depois do commit, uma única vez. `reply_status` registra `sending|sent|uncertain|failed`; a ausência de confirmação não desfaz nem repete o cadastro. O operador consulta `/fila` antes de reenviar uma pauta. Duas mensagens novas com o mesmo texto são duas solicitações distintas; não há deduplicação semântica.
- Erros de sintaxe enviam orientação uma vez e confirmam o webhook sem executar uma ação. Secret do webhook, chat e usuário permitidos são validados antes de acessar o banco. Nenhum URL de afiliado é baixado por esses comandos. Respostas usam texto simples e prévias de links desativadas.

## Prevenção

Migração aditiva `20260912030000_telegram_idea_queue.sql`, preservando tabelas e migrações históricas. Amplia somente o CHECK dos comandos e adiciona payload/resultado/status de resposta. RPC restrita à service role; RLS existente permanece habilitada.

Testes Deno cobrem parser, afiliação, usuário não autorizado, mensagem repetida, confirmação incerta, falha no banco, orientação para argumentos inválidos e tamanho da resposta com emojis. Testes SQL cobrem atomicidade, limites, replay adulterado, cancelamento antes/depois do consumo, propagação da afiliação e permissões. Doze clientes concorrentes enviam o mesmo update e pautas distintas: uma cópia do update e nenhuma ultrapassagem do limite configurado.

Rollback operacional: definir `telegram_queue.enabled=false` para bloquear novas entradas/retiradas, mantendo a consulta. Não apagar `telegram_commands` para repetir ações. Nenhuma mensagem real é enviada durante os testes. Validação de bot/cloud e qualidade dos vídeos continua pendente; editor de roteiro, priorização pelo chat e coleta de analytics não integram esta entrega.

Referência: [Telegram Bot API — sendMessage](https://core.telegram.org/bots/api#sendmessage), para texto simples, limite da mensagem e `link_preview_options`.
