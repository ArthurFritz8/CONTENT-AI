# ADR-054 — Atuação expressiva sem inflar FPS

Data: 2026-10-06. Status: teste técnico concluído; avanço visual parcial, revisão do operador pendente.

## O — Objetivo

Dar intenção, gestos e progressão emocional à conversa humanizada aprovada, preservando aparência, voz e sincronização. Não confundir quantidade de quadros interpolados com novas ações do personagem.

## C — Contexto

O operador aprovou qualidade visual e sincronização da conversa do ADR-053, mas considerou os movimentos engessados. Aprovação restrita ao arquivo entregue; não autoriza publicação nem habilita o produtor no Studio. O arquivo já tem 60 fps e 1.032 quadros em 17,2 s. Wan S2V gera a 16 fps nesta configuração; RIFE estima intermediários. A direção anterior pede câmera estável, atuação contida, inclinações sutis e gestos pequenos. Essa restrição permaneceria em capítulos maiores se os mesmos prompts fossem usados.

Isto já existe em `scripts/modal-speech-motion-probe.py`: geração condicionada ao WAV real, transporte com checksums e interpolação RIFE. Isto já existe em `scripts/audit-speech-motion-probe.py`: decode, contagem, origem temporal e comparação do áudio. Reutilizar. Não recriar produtor nem inserir estados de banco.

**Correção crítica:** aumentar FPS, duplicar quadros, fazer zoom ou acelerar o clipe não cria atuação motivada. Não mudar o FPS nativo do modelo sem validação. Não aumentar denoising steps supondo que sejam quadros. Uma imagem inicial mais dinâmica ou controle de pose são caminhos adicionais, mas `pose_video=None` continua nesta experiência; não anunciar controle corporal determinístico.

## S — Solução

Adicionar `--expressive` ao probe existente. Preparação em pasta separada `output/expressive-speech-motion-probe/`, preservando todos os arquivos aprovados. Reutilizar exatamente a referência de Malu, WAV de 3,737 s, seed 2007, 64 quadros nativos, 40 passos, pesos, resolução e RIFE a 60 fps. Alterar somente o prompt de atuação para tornar a comparação interpretável.

Três momentos orientados pelas frases: aproximação do tronco/sobrancelhas e palma aberta durante a pergunta; recolhimento da mão e olhar incrédulo entre frases; endireitar-se e um gesto enfático na frase final, seguido de recuperação. A mão já visível atua; a outra permanece na cintura. Boca desobstruída, interlocutor desfocado e eixo de diálogo preservado. Texto guia probabilisticamente a geração; não é uma timeline de pose garantida.

Uma nova chamada GPU, timeout de 2.100 s, sem retries. Reserva local exclusiva antes de criar o app; falha ou reserva pendente impedem reexecução até inspeção. Manifesto/prompt e integridade do áudio conferidos antes da chamada. Nenhuma nova API TTS, imagem ou serviço. Teto estimado somente do worker: US$ 2,712 (H100 + 4 CPU + 64 GiB, tarifas do teste anterior); exclui build/startup/idle. Não é saldo nem fatura. Não alterar limites do provedor nem assumir aprovação de créditos acadêmicos.

Sem episódio, DB, consumo de candidato, mensagem Telegram, publicação ou habilitação no Studio. O renderer de produção segue seu contrato de 30 fps; o teste curto não substitui o mínimo de 60 s de episódio. Promover a direção expressiva para capítulos somente após verificar a nova amostra; manter a alternativa aprovada se expressão piorar anatomia ou sincronização.

## P — Prova

- Rodar os dez testes de integridade e sincronização temporal existentes antes de alocar GPU.
- Confirmar mesmo WAV/referência/seed/configuração e comparar somente a mudança de direção.
- Decode integral, 64 quadros nativos e 237 interpolados, áudio/vídeo com origem zero e correlação PCM/atraso pelo auditor existente.
- Inspecionar início, ação e recuperação: palma, dedos, cotovelo, boca, cabelo, figurino e identidade. Aprovação anterior de sincronização não valida automaticamente esta nova geração.
- Comparar lado a lado no mesmo timestamp. Métricas de diferença de pixels podem aumentar por tremor/deformação; não classificar atuação como melhor só pelo número.
- Registrar duração, custo de worker e app encerrado/zero tarefas, resultado e limitações. Sem repetir silenciosamente se não melhorar.

Fontes primárias: [Wan S2V e controle de pose](https://github.com/Wan-Video/Wan2.2), [implementação fixada usada no teste](https://github.com/Wan-Video/Wan2.2/blob/1ea34ff48f87168174e12956e200b1d908b1c5ff/wan/speech2video.py), [RIFE](https://github.com/hzwer/Practical-RIFE), [preços Modal](https://modal.com/pricing).

## Resultado

Uma inferência concluída, sem retry. `output/expressive-speech-motion-probe/malu-fluid.mp4`: **3,950 s, 704 × 1280, 60 fps, 237 quadros**, SHA-256 `d3ab7e38b424a1bb33b48206d72c855b82bc758fffe7b3fd494e65db3328d408`. Nativo: 64 quadros a 16 fps; quantidade de quadros e FPS iguais ao controle. A mudança foi de atuação, não aumento artificial de FPS. `comparacao-gestos.mp4` apresenta as duas versões no mesmo timestamp, com a mesma voz, sem zoom, aceleração ou interpolação extra. SHA-256 `57e76896bb2edb4c4c71b4a9552aaefb1c6f409e4d56db0e81fe7b71b0018307`.

Referência, WAV, seed, passos, pesos, dimensões e parâmetros de quadros coincidem com o teste aprovado. Decode aprovado nas duas versões e na comparação; áudio/vídeo em zero e atraso PCM medido de 0 s. Correlação 0,999938. O baseline histórico não tinha `acting_prompt` no QA: o comparador identifica explicitamente que sua direção vem de `input.json`, preservado junto do teste; não fabrica um campo histórico de telemetria.

Inspeção dos quadros nativos/interpolados: no trecho final Malu movimenta mais ombros/tronco, ergue as duas mãos e muda expressão/olhar. Aparência e cenário permanecem reconhecíveis. **Avanço parcial:** a primeira metade ainda fica próxima da pose inicial; o modelo não executa precisamente os três momentos pedidos e levanta também a mão que deveria permanecer na cintura. Não declarar controle corporal determinístico, melhoria universal de atuação ou sincronização fonética perfeita. Os flags automáticos de validação de atuação/boca permanecem falsos; a nova amostra exige reprodução pelo operador. Não promover automaticamente esse prompt para todos os capítulos. Controle de pose oficial é uma alternativa a investigar se a densidade de gestos ainda não satisfizer, mas não foi implementado ou validado aqui.

Variação média de pixels entre quadros a 128 × 224: 0,5633 no controle e 0,8345 na variante. Isso indica mudança visual maior, não uma pontuação de qualidade; os quadros mostram que o movimento extra se concentra no final.

Worker: 1.413,642 s; estimativa **US$ 1,826** somente de compute, excluindo build/startup/imports/idle, sem consulta à fatura/saldo. App `ap-B8jaV7BQU8B489X7LdDKes` confirmado parado com zero tarefas. Onze testes locais passaram, incluindo cinco casos de rejeição antes de criar app (prompt/seed alterados, resultado concluído, falha e reserva pendente). Comparador executado com vídeos reais e decode/timing aprovados. Sem CI remoto, deploy, banco, episódio, mensagem Telegram, publicação ou habilitação no Studio. A conversa aprovada permanece intacta; aprovação anterior registrada por hash em `operator-review.json` ao lado dela.
