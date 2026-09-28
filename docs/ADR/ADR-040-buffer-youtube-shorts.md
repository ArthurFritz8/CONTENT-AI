# ADR-040 — YouTube Shorts públicos pelo Buffer

Data: 2026-09-25. Status: implementação preparada; ativação condicionada à conexão do canal YouTube pelo operador.

## O — Objetivo

Oferecer na ficha Telegram escolhas independentes para publicar o vídeo orgânico no TikTok, no YouTube ou em ambos, preservando aprovação humana e publicação automática sem CNPJ ou custo adicional.

## C — Contexto

O renderer já produz Short vertical com CTA orgânico e QA. `youtube-plan.ts`, o uploader direto e o ledger de `publishes` já existem: recriar vídeo ou um uploader direto seria redundante. O uploader próprio não pode prometer vídeo público enquanto a auditoria do projeto Google não for confirmada: [o YouTube restringe uploads `videos.insert` de projetos não auditados ao modo privado](https://developers.google.com/youtube/v3/docs/videos/insert). O Buffer [oferece publicação automática de Shorts](https://support.buffer.com/en-us/articles/using-youtube-shorts-with-buffer-Jl8iR6jIck) em um canal conectado, inclusive no plano gratuito com limite de canais. A conexão Google exige uma ação do proprietário da conta.

## S — Solução

1. Novo `buffer_youtube` inicia desligado. `BUFFER_YOUTUBE_CHANNEL_ID` fica apenas nos secrets do servidor. A validação confere que o canal Buffer é YouTube; a chave pessoal já usada para TikTok é reutilizada.
2. A ficha Telegram oferece aprovação só TikTok, só YouTube ou ambos quando os canais estiverem prontos. A decisão grava apenas os consentimentos escolhidos, vinculados ao fingerprint da revisão. Aprovações antigas não ganham YouTube retroativamente.
3. O Short usa o render orgânico vertical aprovado, URL pública imutável, proporção exata 9:16, duração de até 180 segundos, título/descrição validados, categoria e declaração de conteúdo sintético. `createPost` pede `automatic`, `addToQueue`, `privacy=public`; a resposta deve confirmar `schedulingType=automatic`.
4. Uma reserva única por episódio/YouTube/portrait antecede a chamada externa. Sem retry automático após resposta ambígua. O ledger só marca `published` quando Buffer informar `sent`, sujeito a conferência visual no YouTube.
5. O uploader direto e o caminho Buffer são mutuamente exclusivos. O upload privado horizontal histórico segue separado. O orquestrador agenda Shorts aprovados mesmo quando a geração de pautas está pausada.

## P — Prevenção

- Sem canal YouTube conectado, flag e botão de publicação ficam desligados. O primeiro envio real precisa ser testado.
- Notificação do Buffer não equivale a publicação automática e deve ser rejeitada no checkpoint.
- O limite gratuito de dez posts pendentes por canal pode impedir novo agendamento; falhas ficam no ledger para conciliação.
- Um estado `sent` do Buffer não é prova isolada de visibilidade pública. Conferir o Short no canal.
- Não publicar por esse fluxo uma versão comercial ou link afiliado sem contrato e revisão próprios.
