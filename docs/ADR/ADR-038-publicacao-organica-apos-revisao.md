# ADR-038 — Publicação orgânica após revisão, com autorização por destino

Data: 2026-09-25. Status: implementação YouTube preparada; ativação pública condicionada à auditoria da API. TikTok público pendente de app auditado e fluxo de exportação conforme as regras da plataforma.

## O — Objetivo

Automatizar o envio do Short orgânico aprovado no Telegram, sem CNPJ, sem link afiliado e sem duplicar vídeos quando houver falha ou resposta ambígua. Publicação pública no TikTok também é objetivo, mas depende de requisitos de outra API, não da TikTok Shop Partner API.

## C — Contexto

`telegram-bot` registra a aprovação, enquanto `orchestrator` terminava em `review`. `publish-youtube` já realiza upload horizontal **privado**, explicitamente acionado, com sessão retomável e ledger. Recriar esse uploader seria redundante. O renderer já entrega o arquivo vertical YouTube e a variante TikTok orgânica; o YouTube público exige a variante vertical. ADR-037 mantinha o calendário e a publicação públicos manuais.

Segundo o [YouTube videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert), uploads via projetos de API não auditados criados após 28/07/2020 ficam privados até auditoria. O upload privado já observado no projeto não comprova a aprovação. Segundo o [TikTok Content Posting API](https://developers.tiktok.com/docs/en/content-posting-api-get-started), Direct Post requer app TikTok for Developers, aprovação do escopo `video.publish`, OAuth do criador e auditoria para visibilidade pública. A [interface de exportação exigida](https://developers.tiktok.com/doc/content-sharing-guidelines) deve mostrar opções atuais de privacidade, permitir edição da legenda e colher consentimento explícito por post. Credenciais do TikTok Shop Partner Center não servem para isso; CNPJ do seller é um assunto distinto.

## S — Solução

1. Generalizar o plano e o cliente YouTube para aceitar `portrait/public`, mantendo `landscape/private` como caminho legado. Conferir o hash do arquivo aprovado, o canal OAuth, o status de privacidade retornado pelo Google e a sessão retomável antes de marcar `publishes` como concluído.
2. Criar RPCs separadas para a publicação pública, com `publishes.variant='portrait'`, `privacy='public'`, consentimento na revisão, fingerprint atual, CTA orgânico e ausência de link afiliado. Compartilhar o limite diário de sessões com uploads privados. O Google forçar privado causa falha de reconciliação, nunca registro falso de publicação pública.
3. Inserir `youtube_public_consent` em `review_requests`. A ficha Telegram exibe o destino público antes da aprovação apenas quando a configuração pública e a auditoria estão confirmadas. Revisões antigas não ganham consentimento retroativo. `orchestrator` verifica publicações aprovadas a cada tick, inclusive com geração pausada, e despacha o workflow com lease, espera entre tentativas e teto diário.
4. `youtube.public_shorts_enabled` e `youtube.api_audit_approved` começam `false`; `automatic_after` começa nulo. Ativar somente após confirmar a auditoria do projeto Google e instalar a migration. O episódio já aprovado antes da ativação precisa de nova ficha e nova aprovação.
5. Preparar um plano TikTok testado que aceita somente o render orgânico aprovado, valida a URL imutável, `creator_info` atualizado, privacidade/interações escolhidas, duração e consentimento com o uso de música; o payload usa `PULL_FROM_URL` e rótulo AIGC. Esse plano **não chama a API externa**. TikTok público não é ligado por uma flag improvisada nem recebe a chave TikTok Shop. O conector restante precisa de OAuth TikTok for Developers, URL de mídia verificada, tela de exportação com legenda editável e consentimento, consulta de status e ledger. Uma aprovação editorial antiga não é consentimento de exportação TikTok.

## P — Prevenção

- Não publicar automaticamente vídeos aprovados antes de `automatic_after`; não interpretar upload privado como post público.
- Não fazer novo `videos.insert` quando existir uma sessão cujo resultado seja incerto. O ledger e a lease impedem duplicação; o limite de três dispatches por dia impede loop sem controle.
- Não prometer TikTok público antes da auditoria nem contornar as diretrizes com scraping, emulador ou credenciais TikTok Shop.
- Testes verificam plano vertical orgânico, preservação do caminho privado, privacidade da confirmação e RPC com consentimento. A migração SQL precisa passar no job PostgreSQL da CI antes da ativação em produção.

Substitui apenas a decisão de publicação pública manual do ADR-037 para **YouTube orgânico após ativação**. O [ADR-039](ADR-039-buffer-tiktok-organico.md) acrescenta um caminho distinto para TikTok orgânico via Buffer, sem alterar a conclusão sobre a inelegibilidade do app administrativo privado para Direct Post próprio. As demais travas editoriais e a revisão humana continuam.
