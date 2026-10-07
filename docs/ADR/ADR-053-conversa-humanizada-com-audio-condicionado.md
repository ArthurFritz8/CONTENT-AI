# ADR-053 — Conversa humanizada com áudio condicionado

Data: 06/10/2026. Status: conversa gerada e QA técnico aprovado; revisão artística/fonética do operador pendente. Experimento isolado, sem habilitação no Studio.

## O — Objetivo

Ampliar a amostra visual aprovada do ADR-052 para uma conversa de 15–20 s entre Malu e Laranjito. Demonstrar identidade dos dois personagens, duas vozes, alternância de fala, legendas e fluidez antes de gastar compute em outro capítulo completo.

## C — Contexto

Isto já existe em `scripts/modal-speech-motion-probe.py`: S2V recebe o áudio real e gera articulação, seguido de RIFE. Isto já existe em `packages/core/src/subtitles/ass-builder.ts` e `subtitle-timing.ts`: legendas e marcações nativas. Reutilizar esses módulos. O renderer de produção permanece a 30 fps e o contrato de episódio continua exigindo 60 s; este teste curto não cria episódio, asset, pauta ou estado novo no banco.

O operador aprovou a amostra de Malu e autorizou a conversa. Aprovação restrita à amostra; não implica aprovação das novas cenas ou autorização para publicação. Não afirmar sincronização fonética perfeita a partir de correlação de áudio ou contagem de quadros.

## S — Solução

`render-story-conversation.py` seleciona falas próprias 06–09 do piloto e reutiliza integralmente o clipe aprovado 07 com hashes verificados. Três novas tomadas de 80 quadros a 16 fps usam closes aprovados por whitelist: o enquadramento aberto anterior da fala 06 é substituído pelo close de Laranjito, para manter somente o rosto falante em foco. Atuação, direção do olhar e personagens preservados por referência e prompt; o rosto do interlocutor permanece desfocado. Não anunciar uma cena contínua de dois rostos falando simultaneamente.

Mesmos pesos/revisões, H100, resolução/área e 40 passos do teste aprovado. Não mudar silenciosamente para uma rota de menor qualidade. RIFE produz 297 timestamps a 60 fps por nova tomada, sem interpolação entre cortes. Áudio PCM16 mono 16 kHz medido, integridade verificada, nenhuma palavra cortada ou aceleração. Caudas de silêncio são retiradas com margem após a última palavra e pausa editorial de 250 ms. As duas vozes são os TTS já existentes, sem nova API.

`assemble-story-conversation.mts` reutiliza word boundaries e helpers ASS do core, escape de caminhos do renderer, preserva 60 fps, corta somente excesso silencioso na duração coberta e monta os quatro clipes. Sem música para mascarar avaliação da boca. Vídeo concatenado por cópia de pacotes com duração explícita por tomada, sem uma segunda compressão com perda. Áudio reconstruído dos PCM originais, com duração explícita e concat por filtro, evita acumular padding AAC entre cortes. Arquivo local para revisão artística; não contorna o mínimo de 60 s de episódio. O modo `--available` prepara apenas tomadas verificadas, sem anunciar um arquivo final incompleto.

Cada chamada tem timeout de 2.100 s e nenhuma repetição automática. A sessão sequencial tem no máximo 7.200 s com reserva antes de iniciar chamada. No máximo três novas chamadas, sem rede, volumes, credenciais de terceiros no worker ou funções permanentes. O timeout maior também passa a valer no probe compartilhado; o teste anterior já encerrado não é regenerado.

Após medir aproximadamente 40 s por passo, preparar continuação em duas chamadas paralelas para reduzir espera, sem reduzir passos/resolução ou aumentar quantidade de inferências. Preservar primeiro o checkpoint completo da fala 06, encerrar seu cliente/app entre tomadas e continuar somente 08 e 09 em dois clientes/apps isolados, cada qual com um contêiner H100 e no máximo uma chamada pendente. `--remaining-parallel` exige primeiro checkpoint e não reexecuta tomadas verificadas. Logs/estados/falhas separados por fala evitam corrida entre clientes. No máximo duas GPUs simultâneas na continuação; o teto de worker permanece 6.300 s agregados. Prazo de 3.000 s dos dois clientes paralelos; falha não provoca retries. Encerrar/verificar apps se houver interrupção de cliente.

Estimativa máxima somente dos três workers: 6.300 s × US$ 0,00129148/s = **US$ 8,136**. Não inclui build/startup/idle ou outros encargos e não representa fatura nem saldo. Permanecem os limites anteriormente configurados de uso US$ 30 e gasto US$ 0. Não alterar orçamento, assumir concessão acadêmica ou anunciar gerações gratuitas ilimitadas. Ao rejeitar consumo por limite da conta, preservar checkpoints e parar, sem trocar conta ou fazer retries.

## P — Prevenção e validação

- Validar hashes de referência, voz e resultados, parâmetros de checkpoint e cobertura antes de GPU ou reaproveitamento. Rejeitar arquivo sem checkpoint, checkpoint alterado e falha anterior sem inspeção.
- A continuação exige consulta autenticada confirmando app anterior parado/zero tarefas. Reservas exclusivas por arquivo impedem duas inferências da mesma fala no computador operador; bloqueio/falha exige inspeção, não retry. Isso não substitui locks de banco/jobs duráveis do futuro produtor multiusuário.
- Dez testes locais: referência/voz alteradas, truncamento, taxa de amostragem, extensão explicitamente limitada, segundo personagem, ausência de cauda congelada, atraso artificial de áudio de 200 ms e vídeo deslocado em 64 ms com voz em zero.
- Decode integral, origem temporal, FPS e contagem por tomada; comparar voz recebida com a usada na geração. Isso verifica transporte, não alinhamento de fonemas.
- Conferir também o arquivo montado e os cortes: AAC pode acrescentar amostras de padding, portanto validar o diálogo final contra a sequência PCM esperada.
- Conferir timestamp de cada quadro contra `índice / 60`, não somente FPS médio, para rejeitar lacunas/duplicatas temporais nos cortes.
- As tomadas prontas mediram −20,7 e −19,0 LUFS. Normalizar somente o master para −16 LUFS e peak alvo −1,8 dBFS, sem música ou deslocamento temporal. Conferir a voz normalizada contra a sequência PCM de entrada; rejeitar atraso/correlação inadequada. Medir loudness/true peak da prévia e rejeitar clipping ou nível fora de −18 a −14 LUFS / peak acima de −0,5 dBFS. Essa prévia de 15–20 s não é o QA/DoD de um episódio publicável de 60 s.
- Inspecionar começo, meio, final e bocas/cabelo/roupas/mãos; entregar para revisão humana. Preservar `lip_sync_validated=false` até validação suficiente.
- Registrar tempos/custo medidos, arquivos e apps encerrados ao finalizar. Nenhuma mensagem Telegram ou publicação autorizada por este teste.

Fontes: [Wan S2V](https://github.com/Wan-Video/Wan2.2), [RIFE](https://github.com/hzwer/Practical-RIFE), [preços Modal](https://modal.com/pricing), [limites Modal](https://modal.com/docs/guide/budgets), [timestamps FFmpeg](https://ffmpeg.org/ffmpeg.html#Advanced-options).

## Resultado medido

`output/audio-driven-conversation/malu-laranjito-conversa.mp4`: **17,200 s, 704 × 1280, 60 fps, 1.032 quadros**, H.264/AAC, 8.717.169 bytes. SHA-256 `5ec4800c4f4c7d2e4d06cb0a57320cad1364228bb84482314397c3e0ba579e03`. Falas 06/07/08/09, duas vozes e quatro tomadas. Reutilização da tomada aprovada 07, sem nova TTS ou inferência para ela. Legendas preservam timestamps e restauram a pontuação apenas quando os tokens correspondem ao roteiro; grupos não atravessam fim de frase/pausa.

Decode integral aprovado. Áudio/vídeo em zero; erro máximo dos timestamps de cada quadro em relação a `índice / 60`: 0,000000333 s. Correlação PCM depois da normalização 0,994924; atraso medido 0 s. Master −15,9 LUFS e true peak −1,8 dBFS. Essa verificação mede transporte/edição, não alinhamento fonético das bocas. `lip_sync_validated=false` e revisão humana obrigatória permanecem.

O QA inicialmente reprovou o master por um deslocamento de 63,021 ms somente no vídeo. O AAC não usado do concat demuxer apresentava timestamp negativo de priming, e a normalização automática de timestamps pelo FFmpeg afetou o vídeo copiado. Corrigir preservando os PTS originais com `-copyts` e `-avoid_negative_ts disabled`, sem deslocar voz por tentativa. Verificar ambos os inícios e todos os timestamps; a prévia reprovada/manifest ficaram arquivados em `assembled/`. O pré-teste anterior verificava áudio e contagem, porém não verificava origem do vídeo: por isso não demonstrava sozinho sincronismo A/V. Adicionar regressão real de vídeo deslocado com voz em zero. AAC mono 16 kHz solicitado a 96 kbps, evitando o pedido anterior de 192 kbps que o encoder limitava silenciosamente.

Inspeção de início/meio/final das quatro tomadas e contact sheets nativos/interpolados: identidade, cabelo, bigode, figurino, cenário e eixo do diálogo reconhecíveis; boca, sobrancelhas, mãos e expressões variam. Legendas legíveis sem cobrir rostos. Essa inspeção por imagens não substitui reprodução e avaliação de todos os fonemas pelo operador.

Worker 06: 1.766,086 s; 08: 1.762,841 s; 09: 1.835,621 s. Total novo **5.364,549 s / estimativa US$ 6,928 de compute**, sem build/startup/idle e sem consulta à fatura ou saldo. Três inferências concluídas, sem retries. Encerrar o cliente sequencial somente após checkpoint completo da primeira tomada, antes da próxima inferência, e confirmar app parado/zero tarefas. As duas restantes rodaram simultaneamente em clientes/apps isolados; todos os três apps foram confirmados parados/zero tarefas ao final. O parâmetro `--shot 06` permite essa separação com saída normal em próximas execuções.

Dez testes locais passaram; seis scripts Python compilados e assembler TypeScript executado com os arquivos reais. Não houve CI remoto, deploy, episódio/asset no banco, consumo de candidato, mensagem ou publicação. Nenhuma habilitação automática no Studio.

## Revisão posterior do operador

O operador aprovou a qualidade visual e a sincronização das falas no arquivo completo de 17,2 s, mas pediu mais gestos, movimentação e sentimento. Registrar essa aprovação humana com escopo artístico do arquivo entregue, sem converter métricas de áudio em certificação fonética ou autorizar publicação. A atuação contida permanece uma limitação; a comparação isolada de direção está documentada no ADR-054. Não presumir que um capítulo maior automaticamente resolva a rigidez.
