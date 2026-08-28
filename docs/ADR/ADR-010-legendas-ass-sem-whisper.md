# ADR-010 — Legendas .ass sem Whisper: boundaries do Edge TTS + alinhamento proporcional ponderado

## Objetivo

Definir e implementar o subsistema de legendas do renderer: timing word-level sem Whisper, formato .ass com estilo word-by-word (Shorts/TikTok) e campo editorial `highlight_words` no contrato.

## Contexto

- Nós geramos o áudio a partir de `narration_text` — transcrever com Whisper o que nós mesmos sintetizamos é redundante, pesado (~140MB de modelo, 5-15s/cena) e pode transcrever errado o texto que já temos exato.
- Edge TTS emite eventos `WordBoundary` com offset/duração exatos por palavra. Gemini TTS e Piper não emitem timestamps.
- Proposta externa pedia "deletar whisper.ts, atualizar render.ts e episode.ts" — **correção**: esses arquivos nunca existiram (`apps/local-renderer` é stub). O único artefato real do Whisper era `WHISPER_MODEL_PATH` no `.env.example` (removido). A decisão vale por matar a dependência antes de nascer — o momento mais barato.
- Proposta numerava como ADR-011 — **corrigido**: o anterior é o 009, este é o **010**.

## Solução

### Timing em 2 níveis por capacidade (não por nome de engine)
`resolveWordTimings()` decide por **capacidade**: se `word_boundaries` existirem (Edge TTS), usa timestamps exatos; senão (Gemini/Piper), alinhamento proporcional. Vantagem sobre decidir por nome do engine: se o fallback de voz (ADR-006) trocar o engine no meio do episódio, o método de timing se ajusta sozinho.

### Alinhamento proporcional PONDERADO (melhoria sobre a proposta)
A divisão uniforme proposta (`duração / nº palavras`) erra em palavras longas e pausas. Implementado peso por palavra = `chars + 1`, com `+3` se termina em pontuação (`,.;:!?…`) — aproxima a cadência real da fala com custo zero de dependência. Última palavra ancora em `audio_duration` exato (sem drift de float). O timing usa a **duração real do áudio** por cena (áudio-manda, ADR-006), nunca `duration_seconds` target.

### Formato .ass (veto ao .srt mantido)
`buildAssSubtitles()` em `packages/core/src/subtitles/` gera a track do episódio inteiro (offsets de cena aplicados):
- Estilos: `SUBTITLE_STYLE_PORTRAIT` (1080×1920, 72px, 3 palavras/grupo, marginV 400 acima da UI do TikTok) e `SUBTITLE_STYLE_LANDSCAPE` (1920×1080, 44px, 4 palavras/grupo, bottom).
- Word-by-word em grupos, branco com outline preto 3px + sombra, pop-in com bounce aproximado (`\t` de escala 112→100) + `\fad`.
- Highlight: palavras de `highlight_words` em amarelo `#FFD700` (BGR `&H00D7FF&`), match sem pontuação/caixa.
- Posição por cena: `bottom_center → \an2`, `bottom_left → \an1` (campo `subtitle_position` já existia).
- Texto sanitizado (chaves removidas) — impede injeção de override tags .ass vinda do modelo.
- FFmpeg queima a track com o filtro `subtitles=` (libass) — responsabilidade do renderer.

### Emenda de contrato (ADR-005)
`scenes[].highlight_words: string[]` (máx. 3, default `[]`), gerado pelo Gemini (1-2 palavras copiadas da narração — regra no prompt e no responseSchema). É conteúdo **editorial** → entra no `script_hash` naturalmente. A proposta de objeto aninhado `subtitle_style` foi achatada: `subtitle_position` já existia no topo da cena.

### Por que no core e não no renderer
Timing e .ass são lógica pura (string → string) — testável em Node (13 testes novos) e compartilhada pelos dois alvos de render (local e GitHub Actions usam o MESMO engine, ADR-004). O gerador retorna **conteúdo** .ass, não caminho de arquivo — quem escreve em disco é o renderer.

## Prevenção

- NUNCA reintroduzir transcrição (Whisper ou similar) para conteúdo cujo texto fonte já possuímos.
- Timing de legenda deriva SEMPRE da duração real do áudio TTS, nunca do target editorial.
- Todo texto renderizado em .ass passa por sanitização de chaves — texto do modelo é input não confiável.
- Funções do renderer que sejam lógica pura nascem em `packages/core` com testes Node; o renderer só orquestra I/O (FFmpeg, disco, rede).
- `render.ts`/renderer ainda não existem — próxima entrega; este ADR remove a última decisão em aberto do renderer.
