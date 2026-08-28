# ADR-012 — generate-assets incorpora imagens, TTS e legendas com checkpoints internos

## Objetivo

Transformar `generate-assets` no dono completo da transição `script → assets`: imagens, áudio TTS por cena e legendas `.ass`. O estado `assets` passa a significar literalmente: tudo que o renderer precisa já existe.

## Contexto

A proposta de incorporar TTS ao `generate-assets` foi aceita porque criar `generate-audio` ou um novo state adicionaria complexidade sem ganho real. O ADR-006 já define consistência de engine TTS e áudio por cena; o ADR-011 espera áudio e legendas prontos antes do render.

Debate aplicado:

1. **Viabilidade:** checkpoint interno é viável, mas não por `SELECT type=$2` puro. Sem metadados, não dá para saber qual cena/orientação cada asset representa. Por isso `assets.metadata` foi adicionado com `scene_order`, `orientation`, `tts_engine`, `duration_seconds` e dados de auditoria.
2. **Veto:** Edge Functions não devem executar binários locais (`edge-tts`, Piper, FFmpeg). Gemini TTS é provider real imediato; Edge/Piper entram como endpoints HTTP opcionais (`edge_endpoint_url`, `piper_endpoint_url`). Isso preserva a cadeia de 3 camadas sem mentir sobre o ambiente de execução.
3. **Sim, e além disso:** legendas `.ass` são geradas no `generate-assets` e salvas como `assets.type='subtitle'`; o renderer consome essas legendas em vez de recriá-las. O render local mantém fallback de geração local só para episódios legados.
4. **Fusão estratégica:** nenhum novo state. A máquina continua `script → assets → rendered`; as etapas internas são checkpoints auditáveis via `job_events`.

## Solução

### Schema

- `assets.type` ganhou `subtitle`.
- `assets.source` ganhou `edge`, `piper` e `system`.
- `assets.metadata jsonb` registra cena/orientação/duração/engine/word boundaries.
- `job_events.event_type` ganhou `images_generated`, `tts_generated`, `subtitles_generated`.
- `budget.gemini_tts_requests_per_day_max` separa quota de Gemini TTS das chamadas de texto, grounding e imagem.
- `system_config.tts` ganhou `gemini_tts_model`, `gemini_tts_voice`, endpoints opcionais para Edge/Piper e `preflight_text`.

### Etapas internas

1. **Imagens:** reusa a cadeia do ADR-009. Se imagens para todas as cenas/orientações já existem em `assets`, pula. Se faltam, gera/busca apenas o necessário, salva `metadata.scene_order/orientation`, atualiza `script_json` como checkpoint e registra `images_generated`.
2. **Pre-flight TTS:** se não há áudio completo, testa a cadeia configurada. Gemini consome `call_type='tts'`; Edge/Piper são endpoints opcionais. A engine escolhida é gravada em `episodes.tts_engine` e `tts_engine_selected`.
3. **Áudio TTS:** gera um áudio por cena, salva no Storage e na tabela `assets` com `type='audio'`, `source` igual à engine, `duration_seconds` real e `word_boundaries` quando houver. Falha no meio da engine escolhida aciona fallback para a próxima camada, limpa áudio/legenda parciais e regenera tudo para manter consistência de voz (`tts_consistency_regeneration`).
4. **Legendas:** usa `word_boundaries` quando existem; senão usa alinhamento proporcional ponderado do ADR-010. Salva portrait e landscape como `.ass` em Storage + `assets.type='subtitle'`, `source='system'`, e registra `subtitles_generated`.

### Renderer

`render.ts` passa a buscar `assets.type='subtitle'` por `metadata.scene_order/orientation`. Se existir, baixa e usa diretamente no filtro `subtitles=`. O fallback local de geração `.ass` permanece apenas para compatibilidade com episódios antigos.

## Prevenção

- `assets` sem `metadata.scene_order` não conta como checkpoint interno válido.
- `assets` só muda para status final depois que imagem, áudio e legenda de todas as cenas existem.
- TTS com Gemini sempre passa por `assertGeminiBudget('tts')` + `recordGeminiCall('tts')`.
- Edge/Piper só rodam como serviços externos; nunca como binários dentro da Edge Function.
- Falha de TTS limpa áudio/legenda parciais antes de cair para a próxima engine, preservando a regra de voz única do ADR-006.
- `render_progress` continua exclusivo do renderer; `generate-assets` usa `job_events` como checkpoints internos.
