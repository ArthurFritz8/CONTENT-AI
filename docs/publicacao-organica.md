# Ativação da publicação orgânica

O botão de aprovação do Telegram só autoriza upload público do Short se a ficha disser **“Aprovar + YouTube público”**. Fichas antigas continuam editoriais; peça uma nova com `/revisar UUID_DO_EPISODIO` após ativar o serviço. Cada upload é registrado em `publishes` com `variant=portrait` e `privacy=public`.

## YouTube

1. Confirme no Google Cloud/YouTube API Services que **o projeto OAuth usado pelo `YOUTUBE_CLIENT_ID` concluiu a auditoria que libera `videos.insert` público**. Um vídeo privado no Studio não é prova. Se a auditoria estiver pendente, mantenha as flags desligadas.
2. Instale a migration e o código da Edge Function, publique o workflow `publish-youtube-shorts.yml` na branch configurada e confirme os secrets GitHub Actions existentes do uploader privado.
3. Defina no banco `system_config.youtube` os campos `api_audit_approved=true`, `public_shorts_enabled=true`, `automatic_after=<instante UTC atual>`, mantendo `enabled=true`. Faça isso somente após a auditoria e um teste controlado.
4. Solicite nova ficha no Telegram, confira vídeo, roteiro e fontes, e aprove. O cron do `orchestrator` despacha o Short vertical em até um minuto. Verifique `publishes`, `job_events` e o YouTube Studio. Se o Google devolver privacidade privada, o ledger **não** declara publicação pública; reconcilie a sessão no Studio.

O botão de aprovação não ativa geração de novas pautas. `pipeline.enabled` continua sendo um controle separado.

## TikTok

A Content Posting API é diferente da TikTok Shop Partner API. Para postar publicamente, o operador precisa de app em [TikTok for Developers](https://developers.tiktok.com/docs/en/content-posting-api-get-started) com Direct Post e `video.publish` aprovados, auditoria concluída, conta TikTok autorizada via OAuth e domínio/URL do Storage verificado. A plataforma exige interface de exportação com privacidade escolhida manualmente, legenda editável, configurações de interação e consentimento por vídeo. Até esses pré-requisitos serem atendidos e o fluxo de consentimento ser implementado, a variante TikTok continua pronta para publicação manual; o sistema não a marca como publicada.
