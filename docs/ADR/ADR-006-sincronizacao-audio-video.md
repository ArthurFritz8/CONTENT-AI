# ADR-006 — Sincronização Áudio-Vídeo: Áudio Manda + Consistência de Voz

## Objetivo
Eliminar dessincronização entre narração e imagem sem degradar áudio (`atempo`) nem queimar quota com reescritas (negociação com o Gemini), mantendo voz consistente no episódio inteiro.

## Contexto
- `duration_seconds` é escrito pelo Gemini como estimativa, mas a duração real de fala só é conhecida após o TTS. Estratégias avaliadas: (a) áudio manda, (b) vídeo manda com `atempo`, (c) negociação com o Gemini. Decisão: **(a)**, com TTS por cena (N chamadas) — dá durações reais por cena de graça e simplifica legendas.
- Risco introduzido pelo TTS por cena: queda de engine no meio do episódio geraria vozes misturadas (inaceitável em qualidade).

## Solução
### Decisões aceitas
1. **Áudio manda**: duração da cena no render = duração real do áudio + `gap_seconds`. `duration_seconds` vira TARGET (estimativa para o Gemini mirar e QA comparar), nunca constraint de render.
2. **Consistência de voz**: a engine da primeira cena define a de TODAS; se qualquer cena cair de camada, TODAS regeneram na camada inferior. NUNCA misturar engines no mesmo episódio.
3. **Pre-flight check**: antes da primeira cena, teste curto com a engine preferida; falhou → pula direto para a próxima engine para todas as cenas. Caveat registrado: pre-flight não imuniza contra rate limit no meio das N chamadas — a regra 2 cobre esse caso (mecanismos complementares).
4. **Warning de desvio**: desvio real vs. target > 50% → `job_events` warning para revisão no gate humano. Implementado como helper único `exceedsDurationDeviation()` em `packages/core/src/validators/duration.ts` — renderer e QA usam a mesma função.
5. **Checkpoint por cena**: cada áudio salvo individualmente no Storage (`scene_001.mp3`…); render que cai na cena 5 não regenera as cenas 1–4 (economiza quota TTS em retries).

### Mudanças implementadas agora
- `script-json.ts`: campo `gap_seconds` (0–5, default 0.5) no nível do episódio; constante `TOTAL_DURATION_TARGET_SECONDS`; **regra 9**: soma dos targets entre 60–600s. **Nota matemática**: com os constraints atuais (máx. 8×45s), o teto efetivo é 360s — 600 é à prova de futuro, não alcançável hoje.
- `gap_seconds` fica FORA do hash editorial (parâmetro de render, como music/assets) — teste garante.
- `job_events`: novos event_types `tts_engine_selected` (engine escolhida pós pre-flight) e `tts_consistency_regeneration` (regeneração total por queda de engine). Migration inicial editada diretamente — nunca foi aplicada (Supabase não provisionado), portanto seguro; após o primeiro deploy, mudanças de schema exigirão migrations novas.
- `system_config.tts`: `preflight_enabled`, `gap_seconds_default`, `duration_deviation_warn_percent` (config-driven).

### Especificação vinculante para o futuro `tts.ts` (ainda não implementado)
1. Pre-flight → grava `tts_engine_selected`. 2. N chamadas (1/cena) com retry+backoff por cena ANTES de cair de camada. 3. Queda de camada → regenera todas → grava `tts_consistency_regeneration` + `tts_fallback_triggered`. 4. Upload de cada áudio ao Storage como checkpoint. 5. Grava duração real por cena para o render e o warning de desvio.

## Prevenção
- Testes: regra 9, default e range de `gap_seconds`, exclusão do hash, simetria/threshold do desvio (32 testes no CI).
- `episodes.tts_engine` (ADR-002) registra a engine final — auditável por episódio.
- Threshold de warning configurável em `system_config` — calibrável sem deploy.
