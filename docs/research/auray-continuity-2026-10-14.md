# Auray — sequência de continuidade entre Malu e Laranjito

Data: 14/10/2026. Resultado: sequência de revisão entregue; **continuidade visual reprovada na inspeção do take masculino**. Não liberar a fonte para capítulos por causa desta montagem.

## Pedido, história e orçamento

O usuário aprovou gerar uma sequência curta com nova fala de Malu e resposta de Laranjito. Manifesto: `docs/stories/auray-continuity-sequence.json`. Reutilizada integralmente a pergunta de Malu anteriormente aprovada; acrescentadas duas tomadas nativas de cinco segundos, sequenciais e sem reenvio. A nova fala de Malu manteve referência visual, seed, prompt de direção e descrição vocal da amostra aprovada, alterando a frase.

Ordem: Malu pergunta sobre as malas; Laranjito responde “Eu não ia sozinho. A outra passagem é sua.”; Malu pergunta “Minha? Então por que você escondeu isso de mim?”. Duas novas gerações concluídas/liquidadas por cinco créditos cada. Custo desta rodada: dez créditos gratuitos. Saldo observado após elas: 30, exclusivamente de plano Free. Nenhum consumo Modal ou API paga. ASR e montagem foram locais.

## Arquivos e verificação de transporte

- Pergunta aprovada: SHA-256 `4ddbdf6f7e236412b909fb86f27c05a45b95627059b11ed2bef9feacd402218d`.
- Resposta de Laranjito: SHA-256 `732a91de619d42330ea46c0251d18346ea04c8d430524e9d1f00466a9aa288f4`.
- Nova fala de Malu: SHA-256 `e18c5bbb3340ffe147938f3c5a82006138b0a2ea617ea12caaffd0b410a0871c`.
- Montagem: SHA-256 `612f7a3b969291cae1740982e25ac4506123ea99c9400b593211aa09b32d928a`; 15,5 s, 768 × 1344, 24 FPS e 372 quadros.

Entrega: `output/auray-dialogo-malu-laranjito-2026-10-14.mp4`. Recibos, QA, fontes e revisão ficam em `output/auray-continuity-preview/` e `output/auray-video-jobs/`, ignorados pelo Git. As imagens da montagem são cópias dos fluxos originais: igualdade de todos os hashes de quadros decodificados, ordem, duração e FPS confirmada. Não houve aumento de resolução, interpolação, troca de voz ou legenda substituindo fala incorreta.

Os arquivos nativos tinham origem de vídeo em cerca de 83,333 ms e lacunas/padding nos timestamps AAC. O montador normalizou a origem temporal de cada take, respeitando os tempos de áudio, e passou o áudio original por PCM antes de um único AAC final. A correlação do áudio montado com cada original normalizado foi 0,99992 / 0,98412 / 0,99990; maior desvio medido: um sample de 16 kHz (0,0625 ms). Isso verifica o transporte; não certifica fonemas/boca do material gerado.

ASR local com faster-whisper-base detectou português nas três falas. Na montagem reconheceu “Você fez as malas, e embora sem me contar? Eu não ia sozinho, a outra passagem é sua. Minha? Então, por que você escondeu isso de mim?”. A confusão “Ia/E” já ocorria no controle com a voz anterior; não atestar pronúncia literal por essa transcrição. Identidade vocal e sincronismo fino continuam pendentes da revisão do usuário.

## Falha encontrada e consequência

No bruto masculino, após os primeiros quadros corretos, a camisa de linho creme muda para xadrez verde; aparecem um caule/folhas na cabeça, mudam o enquadramento e o ambiente, e a fisionomia fica diferente. A alteração acontece **dentro da tomada original, antes de qualquer montagem**, apesar das instruções de preservar roupa/cenário e evitar cortes. Esse trecho foi mantido no teste de revisão, sem ocultar o erro ou gastar outra geração para substituí-lo.

As duas tomadas de Malu conservam de modo geral vestido, cabelo e ambiente; isso não prova estabilidade da voz entre frases ou consistência futura. A aprovação anterior se limita à primeira amostra, não à sequência nova. `production_ready` e aprovação de continuidade permanecem falsos; não houve alteração de carteiras, perfis ou roteamento no Studio.

Próximo problema a resolver: ancoragem visual durante todo o take masculino e avaliação da estabilidade das duas vozes. O modo de referências visuais do serviço é uma hipótese para uma avaliação futura, não uma correção já testada. Não repetir esta rodada nem consumir mais créditos automaticamente.
