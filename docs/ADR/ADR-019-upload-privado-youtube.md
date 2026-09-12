# ADR-019 — Upload privado no YouTube com retomada e aprovação por versão

Data: 2026-09-12. Status: implementado; validação real pendente.

## Objetivo

Enviar um vídeo horizontal aprovado para um canal YouTube explicitamente configurado, em modo privado, preservando metadados, disclosures e bytes do render. Primeiro validar um episódio real; publicação pública e Shorts ficam para uma etapa posterior.

## Contexto

ADR-018 já fornece snapshot editorial, identidade do aprovador e hash do arquivo no caminho do render. A tabela `publishes` existe, mas não possuía variante, sessão retomável ou proteção contra uploads concorrentes. Não há um uploader existente para reescrever.

O usuário aprovou começar pela publicação privada enquanto configura a Supabase. Fazer upload de vídeo em uma Edge Function aumentaria a exposição aos limites de memória/tempo do runtime. Reutilizamos o Node e o GitHub Actions já presentes, sem infraestrutura ou biblioteca nova. A Edge Function `publish-youtube` autentica e despacha; o runner faz a transferência. Esta escolha complementa o desenho de publicação original.

## Solução

- Migração aditiva de `publishes`: variante, privacidade, snapshot/revisão, configuração congelada, canal, sessão, hash/tamanho, lease e contadores de início de sessão. Índice único por episódio/plataforma/variante, preservando linhas históricas. Linhas YouTube legadas sem variante exigem reconciliação antes de um piloto.
- Somente `landscape` implementado. Somente `private`; nenhuma opção permite `public`, `unlisted` ou agendamento. O workflow é disparado explicitamente pelo operador/API autenticada. O orchestrator continua até a revisão, sem disparar publicação automaticamente.
- `claim_youtube_upload` serializa concorrentes, verifica aprovação vigente e concede lease de 20 minutos; o job tem teto de 15 minutos. Uma nova tentativa após expiração usa o mesmo registro/sessão. Cada consulta/chunk verifica lease, aprovação, fingerprint e flag atual.
- Plano reutiliza o validador do dossiê e QA existentes. Título, descrição e tags permanecem iguais aos aprovados. Categoria editorial usa mapeamento explícito; categoria ausente, descrição maior que 5.000 bytes ou título/descrição com caracteres incompatíveis interrompem o envio, sem alteração silenciosa.
- Download restrito ao Storage HTTPS configurado, sem redirects, com limite de bytes e SHA-256 comparado ao caminho do render. OAuth confere o canal configurado. `containsSyntheticMedia=true`, conteúdo comercial mapeado para `hasPaidProductPlacement`, público infantil configurado explicitamente e notificações de inscritos desativadas.
- POST de início nunca é repetido automaticamente. Reserva diária atômica antes desse POST: três inícios/dia por padrão, incluindo tentativas que falham. Sessão confirmada no banco antes de transmitir mídia. Chunk de 8 MiB, consulta de progresso após falha, backoff limitado e respeito a `Retry-After`. Sessão expirada interrompe para reconciliação; não cria outro vídeo automaticamente.
- A confirmação externa é persistida mesmo se a aprovação tiver sido revogada durante a última chamada de rede. Isso preserva o ID para investigação. Não é possível recolher bytes de uma requisição já em trânsito; a cópia permanece privada e o próximo chunk é bloqueado. Não editar/revogar durante o piloto normal.
- `publishes.status=published` significa upload privado aceito e ID persistido, **não processamento audiovisual concluído**. `privacy=private` distingue o resultado. O episódio permanece `review`. Repetir uma execução concluída retorna o mesmo ID sem rede. Verificação visual, processamento remoto, analytics e promoção pública continuam separados.

## Prevenção

Testes Node/HTTP simulam hash divergente, canal errado, perda da resposta final, Range de retomada, sessão expirada, falha no checkpoint, limite diário e repetição sem rede. PostgreSQL verifica approval/lease/RLS, imutabilidade da sessão, limite diário e conclusão idempotente. CI executa 12 clientes concorrentes para comprovar uma única reserva. Credenciais OAuth e URI da sessão não entram nos logs; scan inclui padrões OAuth.

Rollback operacional: `youtube.enabled=false`; interrompe novas transferências nos próximos guards. Preservar `publishes` e sessões para reconciliação; não remover ledger para tentar novamente. Flags novas são insert-only e inicialmente desativadas.

## Fontes e limites

- [Protocolo retomável oficial](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol): sessão, Range, consulta após interrupção e expiração.
- [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) e [recurso video](https://developers.google.com/youtube/v3/docs/videos): campos graváveis e privacidade.
- [OAuth](https://developers.google.com/identity/protocols/oauth2/web-server): refresh token e acesso offline.

Sem chamada real ao YouTube nesta implementação. OAuth, canal, quotas disponíveis, processamento e fidelidade audiovisual precisam ser validados no piloto do [guia operacional](../youtube-private-pilot.md). Limites oficiais devem ser conferidos no projeto; não assumir cotas históricas de outra conta. QA audiovisual, apresentação dedicada do grounding, publicação pública/Shorts, analytics e retenção continuam pendentes.
