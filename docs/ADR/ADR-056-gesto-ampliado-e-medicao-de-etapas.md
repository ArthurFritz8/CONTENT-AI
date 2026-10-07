# ADR-056 — Gesto ampliado e medição de etapas

Data: 2026-10-06. Status: prévia gerada, aguardando revisão do operador; fora da produção.

## O — Objetivo

Testar outro gesto após o operador aceitar os movimentos do ADR-055, mas considerar a amplitude insuficiente. Explicar custo e demora com medições reais, sem prometer aceleração sem perda de qualidade.

## C — Contexto

Isto já existe em `scripts/prepare-stable-hand-guide.py`, `scripts/modal-speech-motion-probe.py`, `scripts/compare-story-acting.py` e `scripts/audit-stable-hand-probe.py`: guia próprio, áudio condicionado, comparação e inspeção de mãos. Reutilizar com um perfil opcional. A aprovação humana da amostra está vinculada ao SHA `f8be7c3937e1cf4806e779060c0c9b2062a26693b411c4e60483df6ea4489d2f`; não autoriza publicação.

O último teste durou 1.366,378 s no cliente, 1.328,406 s na região medida do worker; o log das 40 etapas marcou aproximadamente 1.156 s. Estimativa US$ 1,716 só da região medida, não da fatura inteira. O modelo não sintetiza vídeo em tempo real. Mais FPS interpolados não resolve pouca atuação. Gastos são consumo dos créditos disponíveis, não gratuidade ilimitada.

## S — Solução

Perfil `--arm-gesture`, pasta separada `output/arm-gesture-motion-probe/`. Comparar com a amostra guiada aprovada, preservando prompt, imagem, WAV, seed, pesos, sampler, 40 passos, resolução e FPS. Única variável artística: trajetória do braço visível. Durante o pulso existente de 2,25 a 3,60 s, transladar a palma mais 38 px para o corpo e 42 px para cima; cotovelo acompanha com 16/20 px. Sem rotação da mão ou flexão individual dos dedos. Outra mão e demais pontos do corpo seguem iguais. Preparação/ação/recuperação suaves; início/fim iguais ao controle. Guia é técnico e próprio, não nova imagem de personagem. Inspecionar alinhamento inicial e mapa do pico antes da GPU.

Preparador verifica revisão do controle/hash, rejeita guia igual e preserva pasta existente. Comparador rejeita mudança de prompt no experimento de trajetória; declara `pose_trajectory`. Auditor amplia a região de inspeção da palma para não perder o gesto maior. Nenhum novo schema/estado, banco, episode ou serviço.

Instrumentar durações de imports, validação, preparação, carregamento, geração/transferência de quadros, liberação/encode nativo, RIFE/encode suavizado e mux. Manter `worker_seconds` histórico; adicionar `worker_entry_seconds` e `stage_seconds` sem alterar precisão/sampler. Estimativa nova usa o tempo de entrada quando disponível. Medidas ainda excluem boot, imagem/build, transferência de resposta e ociosidade; não inferir saldo atual/fatura.

Correção operacional: a primeira inicialização falhou em 1,302 s por `UnicodeEncodeError` no Rich/terminal Windows cp1252, antes de entrar no corpo de `app.run` e antes de chamar o worker. App `ap-7Nn97NCxmaxMoy5nymUkYB` inspecionado com zero tarefas e encerrado; falha/reserva arquivadas em vez de apagadas. Configurar stdout/stderr UTF-8 no entrypoint e usar `python -X utf8`. Somente após auditoria do app vazio iniciar a única inferência. Isso é recuperação de inicialização sem worker, não retry de animação/GPU; artefatos `initialization-*.json` preservam a evidência.

Uma chamada H100/4 CPU/64 GiB, timeout 2.100 s, zero retries, sem aumentar limites da conta. Estimativa de teto só da execução US$ 2,712, excluindo custos externos ao cronômetro. Falha de limite do provedor encerra o teste. Não regenerar cenas já aprovadas.

Aceleração preservando parâmetros exige benchmark de carregamento/reuso, CPU/GPU transferências e eventualmente kernels/compilação. Já há pesos na imagem/cache e FlashAttention; não recriar essas otimizações. Reuso em lote pode reduzir carregamento, mas o worker atual reinstancia o modelo por chamada. Paralelizar cenas reduz espera do capítulo, não garante menor custo nem acelera cada cena. Snapshots requerem deploy e os de GPU são alpha; a documentação ressalva que não aceleram leitura de pesos. Não habilitar apenas com promessa de velocidade. Menos passos, resolução menor, quantização, modelos rápidos/destilados ou menos movimento alteram o experimento e exigem validação artística; não alegar “sem perder um pingo”.

No código upstream fixado, `guide_scale=4.5` executa uma passagem condicionada e outra não condicionada por etapa (80 avaliações em 40 etapas). Offload do modelo de ruído acontece depois do loop, não a cada etapa; não atribuir a demora observada a 40 transferências CPU/GPU inexistentes. Evitar prometer eliminar a maior parte da latência somente com cache/snapshot de inicialização.

Histórico local selecionado em `cost-history.json`: controle original US$ 1,834; teste expressivo rejeitado US$ 1,826; gesto estável US$ 1,716; conversa de 17,2 s US$ 6,928 em três tomadas novas, reutilizando uma antiga. Total selecionado US$ 12,304 só dos cronômetros históricos (seis inferências); não é consumo total da conta e exclui o piloto TI2V anterior. Exemplo de escala: quinze tomadas iguais à prévia estável para aproximadamente 60 s estimam US$ 25,734 só de worker. É hipótese ilustrativa, não preço fixo, orçamento validado ou quantidade de capítulos mensais garantida. Fonte pública confirma US$ 30/mês de créditos Starter, mas o saldo atual não foi consultado.

## P — Prova

Dezesseis testes locais passaram. Novos cenários verificam geometria dos dedos invariável, palma dentro do quadro/abaixo da face, âncoras, retorno da trajetória e bloqueio de comparação com prompt alterado, guia igual ou ausência de pose. Compilação Python passou. Inspeção do mapa inicial/pico antes da GPU. Após gerar: confirmar hash recebido, timestamps/decode/áudio, todos os 64 pares de mãos nativos e amostras interpoladas, app parado/zero tarefas e revisão do operador. QA técnico não certifica anatomia, emoção ou fonemas. Atualizar este ADR com resultado e tempos/custo reais; não publicar nem habilitar Studio.

### Resultado

Uma inferência concluída, amostra 3,950 s / 704 × 1280 / 237 quadros a 60 fps interpolados de 64 quadros a 16 fps. `malu-fluid.mp4` SHA `998a57bfccc5e7b5d9b72c3018c16161bf49b463312ba1ae59345d22696bf35d`; nativo SHA `a1f9249ebe4b2a168acf11b8d841adfcd6a4d9e25394bc3fc2799cfccfbbc6ad`. Guia efetivamente recebido pelo worker, SHA `177558de070fbda6b730ab9523bf466ef7bdbc6a195af87c6ae3b19669a5da83`. Comparação com o gesto aprovado: `comparacao-gestos.mp4`, SHA `8b77ea7e54fe48d16b38d0eec5ee6dde736dec53614a8e4f74288fcd5e83e7b3`. Comparador confirmou apenas `pose_trajectory` como variável artística.

Decode, hashes, áudio e grade temporal passaram: 0 s de deslocamento de áudio, correlação PCM 0,999937773, erro máximo 0 s no nativo / 0,000000333 s no interpolado. Inspeção de todos os 64 pares de mãos, 12 momentos completos de ambas as versões e quadros completos próximos ao pico: palma/antebraço sobem e se aproximam do corpo na segunda metade, retornando; mão na cintura fica estável. Não observada a deformação forte do experimento rejeitado; detalhe dos dedos ainda pode variar e não é certificado. Atuação global permanece moderada, não expressividade ampla validada. Boca e naturalidade completa aguardam reprodução/revisão do operador. `visual-review.json` não substitui aprovação humana.

Medição por etapa: imports 8,931 s; validação 0,420 s; preparação 0,369 s; carregamento 72,715 s; geração/preprocessamento interno/transferência de quadros 1.320,382 s; liberação/encode nativo 1,854 s; RIFE/encode 4,147 s; mux 0,436 s. Entrada do worker 1.409,254 s, região histórica 1.399,905 s, cliente 1.433,742 s (23 min 54 s). O bloco de geração ocupa aproximadamente 92% do tempo do cliente; seus 40 passos no log consumiram aproximadamente 19 min 51 s, com demais condicionamentos/decode dentro do mesmo bloco. Não atribuir toda essa etapa exclusivamente aos passos de denoising.

Estimativa nova US$ 1,820 só da entrada medida do worker, incluindo imports/validação. Não é fatura total ou saldo; boot/build/transporte/idle continuam fora desse escopo. Histórico selecionado atualizado US$ 14,124, incluindo esta tentativa, não todo o projeto. Sem aceleração demonstrada: configuração de qualidade foi preservada, adicionou-se medição. Cache/reuso de carregamento só ataca uma fração pequena do tempo observado; mudanças maiores exigem benchmark próprio, não apenas promessa.

App `ap-1TbytcTfzRfdHA3Pbc8DSw` confirmado parado, zero tarefas; app da inicialização vazia também parado. Dezesseis testes locais e QA real passaram, sem CI remota, banco, publicação ou ativação no Studio. Artefatos e relatórios ficam em `output/arm-gesture-motion-probe/`.

Fontes primárias: [preços e créditos Modal](https://modal.com/pricing), [cold starts](https://modal.com/docs/guide/cold-start), [limites de snapshots](https://modal.com/docs/guide/memory-snapshots), [Wan S2V fixado](https://github.com/Wan-Video/Wan2.2/blob/1ea34ff48f87168174e12956e200b1d908b1c5ff/wan/speech2video.py).
