# ADR-042 — Studio universal: contas isoladas e revisão dentro do painel

Data: 2026-09-29. Status: implementado; abertura pública condicionada à configuração OAuth e smoke de duas contas.

## O — Objetivo

Permitir que cada pessoa produza, revise e autorize publicação em seus canais, sem configurar APIs ou depender do Telegram. Preservar o pipeline do operador, seus episódios e seus consentimentos.

## C — Contexto

A tela de detalhe já tinha player, roteiro, fontes e licenças. A revisão já possuía snapshot, fingerprint e idempotência. Recriar esses contratos seria redundante. O painel usava consultas globais com service role, e os workers usavam credenciais globais: adicionar cadastro sem isolamento publicaria no canal errado. URLs antigas de mídia eram públicas. O esquema de episódios e o renderer de imagens continuam válidos.

## S — Solução

- Workspace e membership derivados de Supabase Auth no servidor; escopo obrigatório nas consultas e comandos, RLS de leitura e RPCs de escrita apenas para service role. Dados atuais pertencem ao workspace legado. Novas contas não herdam canais, tokens ou personagem do operador. Cadastro público nasce desligado, com teto inicial de dez workspaces para o piloto gratuito.
- Gerar vídeo é uma escolha explícita na pauta para novas contas. A chave legada de produção automática controla somente o consumo automático da fila antiga; um episódio iniciado manualmente continua avançando até a revisão quando essa chave está desligada. A descoberta diária adiciona sugestões, sem iniciar vídeos.
- A mesma `review_requests` atende painel e Telegram. Aprovação exige fingerprint atual; seleção de canais é explícita. Aprovar sem canais só salva a decisão. Reprovar, refazer render e solicitar ajuste são ações distintas. Ajuste cria episódio novo, referencia o anterior e invalida sua aprovação; não inventa estado na máquina existente. Cotas e locks continuam obrigatórios.
- Buffer OAuth Authorization Code + PKCE, state de uso único por usuário/workspace, credenciais no Vault. Refresh tokens são de uso único: claim durável impede refresh concorrente; falha ambígua exige reconexão. O callback registrado é `/api/buffer/callback`. Cadastro do cliente OAuth é uma dependência administrativa real, não responsabilidade do cliente final.
- Outbox própria liga episódio, revisão, canal e workspace por constraints compostas. Claim valida a versão e a conexão antes de enviar. Timeout de criação de post fica `uncertain`, sem reenvio automático. Fila padrão do Buffer ou horário específico em UTC. A agenda recorrente é editada no Buffer, pois não foi confirmado endpoint para alterá-la. Canais legados mantêm seus dispatchers, agora limitados ao workspace original também no banco.
- Mídias de novos workspaces ficam em `studio-private`, sem política pública; workers usam autenticação apenas no host Storage próprio. Preview autorizado recebe URL assinada de dez minutos. Depois da aprovação, o publisher verifica SHA-256 e disponibiliza somente a cópia do render aprovado em `studio-published` para o Buffer. O legado público não é movido nem tem fingerprint alterado.
- Telegram é opcional: deep link com nonce de dez minutos e uso único associa chat privado ao workspace. Bot próprio recebe validação e configuração guiada, sem substituir webhook de outro serviço. Novos clientes recebem link para revisar no painel; botões de aprovação do bot legado continuam funcionando. Notificações têm reserva durável e não se repetem após resposta incerta.

## P — Prevenção

Testes de duas contas cobrem RLS, comando/ideia/revisão/canal estrangeiros, replay, versão obsoleta, geração manual com automação desligada, cotas e refresh concorrente. Credenciais não entram nos payloads de assistência, logs, git ou navegador. Novas conexões não implicam autorização de publicação. Desconectar não cancela posts já aceitos pelo Buffer; a interface informa essa diferença. Não afirmar sucesso de postagem antes de confirmação do provedor. O free tier é limitado e compartilhado, sem fallback pago automático.

Fontes verificadas: [Buffer OAuth](https://developers.buffer.com/guides/authentication.html), [agendamento Buffer](https://developers.buffer.com/guides/posts-and-scheduling.html), [deep links Telegram](https://core.telegram.org/bots/features#deep-linking).
