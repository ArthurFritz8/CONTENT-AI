# ADR-011 — Renderer por cena com checkpoints e concatenação final

## Objetivo

Implementar o renderer final (`assets → rendered`) usando arquivos intermediários por cena, checkpoints em Storage e concatenação final por orientação (`landscape` e `portrait`).

## Contexto

- O workflow de render ainda falhava de propósito; o pipeline só estava completo até `assets`.
- O renderer precisa usar o mesmo engine no GitHub Actions e no dev local (ADR-004), respeitando o contrato render-ready (ADR-005), a regra áudio-manda (ADR-006), os assets por role (ADR-009) e as legendas .ass sem Whisper (ADR-010).
- A opção de filtergraph único é mais rápida, mas é tudo-ou-nada: uma falha aos 90% refaz o episódio inteiro. O custo extra de encodar por cena é aceitável frente ao orçamento de Actions e compra isolamento de falha.
- A numeração solicitada como ADR-012 foi corrigida: o repositório tem ADR-010 como último ADR; pular o 011 criaria buraco documental.

## Solução

### Estratégia por cena

`apps/local-renderer/src/render.ts` implementa um CLI Node:

```bash
npm run render --workspace @content-ai/local-renderer -- --episode-id "$EPISODE_ID"
```

Para cada cena, o renderer:

1. Valida `status='assets'` e `script_json` com `scriptJsonSchema` + `isRenderReady`.
2. Resolve áudio por convenção (`episodes/{id}/audio/scene_000.mp3`) ou linha `assets.type='audio'` que contenha o número da cena.
3. Usa `ffprobe` para obter a duração real do áudio; `duration_seconds` continua sendo apenas target editorial.
4. Busca boundaries opcionais (`scene_000_word_boundaries.json`); se não existirem, cai no alinhamento proporcional ponderado do ADR-010.
5. Gera `.ass` por orientação: portrait usa `subtitle_position` da cena; landscape força `bottom_left`.
6. Renderiza `scene_000_landscape.mp4` e `scene_000_portrait.mp4` com FFmpeg: Ken Burns (`zoompan`), legendas burned-in, AAC 192k/44.1kHz, H.264, 30fps.
7. Sobe intermediários em Storage (`episodes/{id}/render/intermediate/...`), atualiza `render_progress` e grava `render_checkpoint_saved` com `{scene,total,skipped,progress}`.

### Retomada

Antes de renderizar uma cena, o CLI verifica se os dois intermediários já existem no Storage. Se existirem, baixa para concatenação e pula o encode. Se faltar uma orientação, renderiza só a faltante. Isso permite retry parcial sem rerender completo.

### Concatenação final

Depois dos checkpoints:

1. Cria `concat_landscape.txt` e `concat_portrait.txt`.
2. Usa concat demuxer com `-c copy` para juntar cenas sem re-encode.
3. Se `script.music` existir, faz mixagem final com `amix=inputs=2:duration=first:dropout_transition=0` e volume 0.1 (-20dB). Sem música, apenas copia o concat.
4. Sobe `episode_landscape.mp4` e `episode_portrait.mp4` para Storage.
5. PATCH em `episodes`: `status='rendered'`, `render_progress=100`, `render_url=portrait` (Shorts é o produto primário), e `metadata.render_outputs` com as duas URLs.
6. Grava `render_completed`.

### Workflow

O GitHub Actions deixa de marcar `rendered` por fora. O CLI passa a ser o dono da transição `assets → rendered`; o workflow só valida input/estado, instala dependências e executa o renderer. O step de falha continua como rede de segurança.

## Prevenção

- Nunca fazer render final com filtergraph único sem checkpoints; isso elimina a retomada por cena.
- `render_progress` é atualizado apenas pelo renderer; Edge Functions anteriores usam `job_events`.
- URLs finais e intermediárias são URLs públicas canônicas do Storage, nunca signed URLs.
- `render_url` guarda portrait por ser o alvo primário de Shorts; landscape fica em `metadata.render_outputs.landscape`.
- O concat demuxer exige cenas com parâmetros idênticos; qualquer mudança de codec/fps/resolução deve ser feita em `renderSceneOrientation` para todas as cenas.
- O CLI não inventa áudio: se `scene_000.mp3` não existir no Storage nem em `assets`, o render falha cedo e preserva os checkpoints já existentes.