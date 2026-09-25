# ADR-039 — Agendamento orgânico do TikTok pelo Buffer

Data: 2026-09-25. Status: código preparado, desligado até conectar o canal e validar um envio real.

## O — Objetivo

Publicar automaticamente no TikTok o vídeo orgânico aprovado pelo operador, sem CNPJ, sem app TikTok próprio e sem contornar os Termos do TikTok. Manter confirmação humana por versão e registro verificável do resultado.

## C — Contexto

O renderer já entrega uma variante TikTok vertical e testada; `tiktok-plan.ts` já valida a versão orgânica para Direct Post, mas não envia nada. Recriar render ou usar a API TikTok Shop é redundante. O app administrativo privado do CONTENT AI conflita com a [proibição do TikTok a utilitários para as próprias contas](https://developers.tiktok.com/docs/en/content-sharing-guidelines); ainda que existisse uma chave, posts públicos exigiriam auditoria. A [API pessoal do Buffer](https://developers.buffer.com/guides/authentication.html) permite automatizar a própria conta e o serviço [oferece auto-publicação TikTok](https://support.buffer.com/en-us/articles/using-tiktok-with-buffer-oGEroY9Of2). O [plano Free](https://buffer.com/pricing) inclui uma chave, 3.000 requisições mensais e até dez posts agendados por canal.

## S — Solução

1. Adicionar `buffer_tiktok` desativado em `system_config` e secrets de servidor `BUFFER_API_KEY`/`BUFFER_TIKTOK_CHANNEL_ID`. O canal é checado como TikTok antes de qualquer reserva.
2. Nova ficha Telegram registra consentimento explícito `buffer_tiktok_consent`. O texto identifica Buffer/TikTok, independente do YouTube. Apenas aprovação posterior a `automatic_after` pode disparar envio; nenhuma ficha anterior ganha consentimento retroativo.
3. Validar snapshot, QA, duração/tamanho, proporção vertical, legenda, ausência de comércio/link e URL imutável do Storage. Enviar `createPost` com `schedulingType=automatic`, `mode=addToQueue`, um vídeo e `isAiGenerated=true`.
4. Reservar no banco uma única publicação por episódio/plataforma/variante antes da chamada externa. A mutação do Buffer não recebe retry automático: timeout ou gravação incerta exigem conciliação humana, evitando duplicatas.
5. Conciliar `scheduled`/`sending`/`sent`/`error` pelo ID do post. Somente `sent` vira `publishes.status=published`; a validação visual no TikTok continua necessária. O `orchestrator` faz isso mesmo com geração pausada.

## P — Prevenção

- Nunca trocar `automatic` por `notification` sem avisar; notificação não publica sozinha.
- Nunca declarar agendamento como publicação final. Os registros em `job_events` separam reserva, agendamento e confirmação.
- Nunca publicar vídeo comercial ou com link TikTok Shop por este fluxo orgânico.
- Sem conta Buffer/canal TikTok/chave pessoal, a flag fica desligada. O código não prova uma publicação real nem contorna quota ou falha do serviço.
- O [guia de mídia do Buffer](https://developers.buffer.com/guides/hosting-media.html) exige URL pública estável até a publicação, verificada no teste real.
