# ADR-003 — Cadeia de TTS com Fallback em 3 Camadas

## Objetivo
Garantir que a narração de vídeos nunca seja um ponto único de falha nem gere custo, mesmo se serviços gratuitos mudarem de política ou saírem do ar.

## Contexto
- TTS é etapa obrigatória de todo episódio; sem áudio, o pipeline inteiro para.
- Pesquisa validada em docs oficiais (2026-08):
  - **Gemini TTS**: free tier confirmado na página de preços, mas com rate limits baixos e sujeito a mudança de política.
  - **edge-tts**: engenharia reversa não-oficial do TTS do Microsoft Edge (CLI Python, ~11.8k stars, manutenção ativa). Qualidade alta, custo zero, mas pode quebrar a qualquer momento por ser não-oficial.
  - **Piper**: TTS 100% local/offline. **Atenção**: o repo original `rhasspy/piper` foi ARQUIVADO (out/2025); usar o sucessor `OHF-Voice/piper1-gpl`. Licença do sucessor deve ser verificada antes do uso (nome sugere GPL — aceitável para projeto pessoal sem distribuição).

## Solução
Cadeia de fallback com degradação graciosa: **Gemini TTS → edge-tts → Piper (local)**.
- Ordem configurável via `system_config.tts` (`seed.sql`) — zero hardcoded, trocar de engine não exige deploy.
- Coluna `episodes.tts_engine` registra qual engine narrou cada episódio (auditoria + comparação de qualidade).
- Evento `tts_fallback_triggered` em `job_events` registra toda queda de camada, com `error_message` — se o Gemini TTS começar a falhar sistematicamente, o heartbeat/analytics expõe o padrão.
- Piper como última camada garante que o pipeline NUNCA trava por TTS: é offline, sem quota, sem rede.
- Voz pt-BR padrão para edge-tts definida em config (`pt-BR-FranciscaNeural`), modelo Piper via `PIPER_MODEL_PATH` no `.env`.

## Prevenção
- Cada chamada TTS terá retry + exponential backoff antes de cair de camada (Regra D) — falha transitória não queima a camada preferida.
- Teste unitário futuro: simular falha das camadas 1 e 2 e verificar que a 3 assume e o evento de fallback é gravado.
- Modelos Piper/Whisper ficam em `models/` (gitignored) — binários nunca inflam o repo.
- Se `edge-tts` quebrar definitivamente (risco conhecido), remoção da camada 2 será registrada em novo ADR.
