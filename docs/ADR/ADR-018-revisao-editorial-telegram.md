# ADR-018 — Revisão editorial pelo Telegram vinculada ao conteúdo

## Objetivo

Entregar revisão humana com título, conteúdo, vídeos, fontes, licenças e alertas; registrar decisão idempotente sobre a versão apresentada. Sem publisher, serviço pago ou mudança dos estados existentes.

## Contexto

ADR-016/017 entregam validação automática e evidências. Faltavam apresentação e gate humano utilizável. `approval_user/date` sozinhos não impedem aprovação obsoleta após alteração de roteiro, assets ou política.

## Solução

- Ficha Telegram com título, resumo, natureza comercial/sintética, links vertical/horizontal e documento UTF-8 com roteiro, descrições, fontes, licenças e limitações. Documento e botões são enviados numa única chamada `sendDocument`; não dividir a autorização entre mensagens parcialmente enviadas.
- Ações: aprovar versão, refazer apenas render (`review → assets`, preservando assets) e reprovar (`review → failed`). Aprovar mantém `review`, registra identidade/data/fingerprint e evento; não publica. Geração de novas ideias via chat e edição de roteiro ficam fora desta entrega.
- Snapshot transacional de dados editoriais, render, pesquisa/evidência, assets e política. SHA-256 calculado no PostgreSQL; aprovação, estado e eventos atualizados na mesma transação. Botões carregam somente ação e UUID da revisão, abaixo do limite Telegram.
- Webhook `telegram-bot` usa `secret_token`, chat e usuário permitidos; JWT desabilitado somente nesse endpoint. Workers permanecem service-only. Updates mutáveis deduplicados por `update_id` no banco. Callback deve vir da mensagem, chat e usuário vinculados à revisão.
- Ledger `review_requests` com snapshot/fingerprint, destinatário, estado de entrega e decisão. Reservar antes do POST externo. Timeout/resultado ambíguo não é repetido automaticamente; `/revisar <UUID do episódio>` permite recuperar por solicitação do operador, invalidando botões anteriores. Entrega incerta nunca libera aprovação sem `message_id` confirmado.
- Orchestrator prioriza entregar uma revisão pendente antes de avançar geração, evitando que um job demorado atrase a ficha. `telegram.enabled=false` por padrão; ausência de configuração não deve enviar mensagens. Revisões aprovadas ou já enviadas não são reenviadas a cada tick nem bloqueiam a fila de geração.
- Gate de publicação exige fingerprint atual e decisão aprovada correspondente, inclusive se assets ou política mudarem. Alterações editoriais invalidam os campos de aprovação. URLs finais do renderer recebem SHA-256 dos bytes do vídeo no caminho; outro arquivo não substitui o vídeo apresentado. O hash é calculado por streaming, sem carregar todo o MP4 em memória.
- Comandos `/start`, `/ajuda` e `/revisar UUID`. Configuração de webhook será feita pelo operador; desenvolvimento e CI usam HTTP simulado, sem mensagens reais.

## Impacto e reversibilidade

Migration aditiva: tabelas privadas por RLS, funções restritas ao service_role e coluna `approval_fingerprint`. Migrations históricas preservadas. Aprovações legadas sem ledger não autorizam novas transições de publicação; reconciliar administrativamente antes de ativar publishers. Desativar `telegram.enabled` pausa envios; reverter workers preservando ledger e gate. Não remover o gate para contornar divergência.

As citações continuam sujeitas a revisão factual humana. O anexo não executa o HTML de Search Suggestions; apresentação dedicada das evidências e requisitos do provedor permanece uma entrega antes de exposição pública. URLs em botões são HTTP(S) sem credenciais; sem parse HTML/Markdown de texto gerado pelo modelo.

## Prevenção

Testes de autenticação, payloads, identidade/chat, replay, mensagem errada, callbacks obsoletos, política/asset alterado, aprovação atômica, refação, RLS e bloqueio de publicação sem ledger. HTTP simulado testa timeout/entrega incerta sem repetir POST. CI mantém renderer real, PostgreSQL com concorrência e sintetizador Piper.

Referências: [Telegram Bot API](https://core.telegram.org/bots/api#setwebhook), [callbacks](https://core.telegram.org/bots/api#callbackquery), [documentos](https://core.telegram.org/bots/api#senddocument). Configuração e teste real do bot continuam necessários antes de operação.
