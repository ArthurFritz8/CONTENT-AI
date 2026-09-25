# Ativação da publicação orgânica

O botão de aprovação do Telegram só autoriza upload público do Short se a ficha disser **“Aprovar + YouTube público”**. Fichas antigas continuam editoriais; peça uma nova com `/revisar UUID_DO_EPISODIO` após ativar o serviço. Cada upload é registrado em `publishes` com `variant=portrait` e `privacy=public`.

## YouTube

1. Confirme no Google Cloud/YouTube API Services que **o projeto OAuth usado pelo `YOUTUBE_CLIENT_ID` concluiu a auditoria que libera `videos.insert` público**. Um vídeo privado no Studio não é prova. Se a auditoria estiver pendente, mantenha as flags desligadas.
2. Instale a migration e o código da Edge Function, publique o workflow `publish-youtube-shorts.yml` na branch configurada e confirme os secrets GitHub Actions existentes do uploader privado.
3. Defina no banco `system_config.youtube` os campos `api_audit_approved=true`, `public_shorts_enabled=true`, `automatic_after=<instante UTC atual>`, mantendo `enabled=true`. Faça isso somente após a auditoria e um teste controlado.
4. Solicite nova ficha no Telegram, confira vídeo, roteiro e fontes, e aprove. O cron do `orchestrator` despacha o Short vertical em até um minuto. Verifique `publishes`, `job_events` e o YouTube Studio. Se o Google devolver privacidade privada, o ledger **não** declara publicação pública; reconcilie a sessão no Studio.

O botão de aprovação não ativa geração de novas pautas. `pipeline.enabled` continua sendo um controle separado.

## TikTok

A [Content Posting API](https://developers.tiktok.com/docs/en/content-posting-api-get-started) direta exige app público auditado; um utilitário privado para as próprias contas não é elegível pelas [diretrizes do TikTok](https://developers.tiktok.com/docs/en/content-sharing-guidelines). O [ADR-039](ADR/ADR-039-buffer-tiktok-organico.md) usa o Buffer, que já suporta [TikTok automático](https://support.buffer.com/en-us/articles/using-tiktok-with-buffer-oGEroY9Of2) e oferece [API para automações pessoais](https://developers.buffer.com/guides/authentication.html). **CNPJ e app TikTok próprio não são exigidos para este caminho.**

1. Crie conta no [Buffer](https://buffer.com/) no plano Free e conecte sua conta TikTok em **Channels**. Na configuração do canal, deixe **Automatic** ativo e desative a opção padrão de notificações. Faça um teste na interface do Buffer com um vídeo não comercial antes de ativar o pipeline. O Free permite até **3 canais**, **10 posts pendentes por canal** (vagas renovadas ao publicar) e **3.000 chamadas API/mês**; confira os [limites atuais](https://buffer.com/pricing).
2. Em **Settings → API**, crie uma chave pessoal. Coloque-a em `BUFFER_API_KEY` no `.env.cloud` ignorado pelo Git; não coloque no Telegram, frontend ou commit. Descubra o ID do canal TikTok pela API/Explorer do Buffer e defina `BUFFER_TIKTOK_CHANNEL_ID`. O [guia de autenticação](https://developers.buffer.com/guides/authentication.html) e o [guia de canais](https://developers.buffer.com/guides/your-first-post.html) descrevem as chamadas.
3. Aplique a migration `20260925010000_buffer_tiktok.sql` e implante as Edge Functions. `deploy.sh` transfere as duas variáveis opcionais para os secrets Supabase se elas existirem no `.env.cloud`. A mídia é servida pela URL pública e imutável do Storage: o Buffer precisa conseguir baixá-la até o horário de publicação. [Hospedagem de mídia](https://developers.buffer.com/guides/hosting-media.html).
4. Depois de conferir o canal e um agendamento manual de teste, defina `system_config.buffer_tiktok` como `{ "enabled": true, "automatic_after": "<instante UTC de ativação>" }`. Peça **nova** ficha Telegram com `/revisar UUID_DO_EPISODIO`; fichas anteriores não autorizam TikTok retroativamente. O botão passa a indicar **TikTok automático**. Aprovar reserva o vídeo orgânico e o `orchestrator` o envia à fila automática do Buffer, mesmo com a geração de novas ideias pausada.
5. Acompanhe `publishes`: `processing` significa agendado ou enviando; somente `published` após o Buffer informar `sent`. Uma resposta incerta da API deixa a reserva para conciliação manual, impedindo duplicata. Confira também o post no perfil TikTok: o estado `sent` do Buffer indica entrega ao serviço, mas não garante sozinho visibilidade final. [Status do Buffer](https://support.buffer.com/en-us/articles/troubleshooting-video-uploads-in-buffer-LK0CldlFNB).

O vídeo TikTok é vertical, orgânico, sem link comercial e marcado como gerado com IA no Buffer. O modo automático não adiciona música, efeitos ou tags de produto do TikTok Shop. Se a conta/arquivo não aceitar auto-publicação, o Buffer pode exigir modo de notificação; esse modo **não conta como publicação automática**. Este conector usa a conta do operador no Buffer, não um app TikTok for Developers privado.
