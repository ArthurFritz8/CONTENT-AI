# ADR-052 — Fala como entrada da animação e quadros intermediários

Data: 06/10/2026. Status: amostra curta aprovada pelo operador após reprodução; QA técnico aprovado. Sem habilitação automática no Studio ou validação fonética generalizada.

## O — Objetivo

Corrigir as duas reprovações do operador no capítulo do ADR-051: boca sem sincronização com as falas e movimento pouco fluido. Preservar identidade humanizada, figurino e cenário; comprovar uma tomada antes de refazer um capítulo inteiro.

## C — Contexto

Isto já existe em `scripts/modal-wan-probe.py`: animação TI2V da referência aprovada. Isto já existe em `apps/local-renderer/src/clip-render.ts`: montagem de clipes com áudio e legendas. Não recriar esses módulos nem inventar estados de episódio. Entretanto, TI2V não recebe áudio: mux ou deslocamento de TTS não resolve a articulação. As 19 tomadas têm 2.471 quadros nativos distintos a 24 fps; conversão para 30 fps duplica quadros. Quadros distintos e QA audiovisual aprovado não demonstram atuação ou sincronização fonética.

O operador reprovou o resultado artístico. A anterior aprovação de dois segundos não valida o capítulo. Uma amostra curta é um artefato experimental, sem mudar o mínimo de 60 s dos episódios.

## S — Solução

`modal-speech-motion-probe.py` adiciona um experimento independente de **Wan2.2-S2V-14B**, condicionando rosto/corpo à imagem e ao WAV real da fala 07 de Malu. Voz existente, sem nova chamada TTS. Preservar origem temporal zero, word boundaries e silêncio final editorial de 0,25 s; não deslocar a faixa por tentativa. `init_first_frame=True` usa a inicialização oficial com referência e evita o descarte padrão de três quadros iniciais. Isto não prova alinhamento fonético perfeito.

Uma H100 80 GB, 4 cores, 64 GiB de RAM, 40 passos, um único segmento de 64 quadros a **16 fps nativos**. Área máxima 720 × 1280; registrar dimensões realmente retornadas. Limite de 1.800 s, nenhum retry automático ou provedor alternativo silencioso. Construção/download de pesos públicos e imports preliminares acontecem em CPU antes de alocar GPU. Revisões fixadas, referência por whitelist, áudio PCM16 mono 16 kHz por fingerprint, tamanho/duração limitados, rede e acesso Modal bloqueados no worker. Sem volumes ou endpoints de inferência pagos.

S2V chama FlashAttention diretamente na atenção cruzada; o fallback SDPA encontrado no módulo geral do Wan não cobre essa chamada. Usar wheel oficial FlashAttention 2.8.3 para torch 2.8 / Python 3.11 / CUDA 12 / ABI TRUE, com SHA-256 verificado e import em CPU. Não substituir atenção mascarada por uma aproximação sem validação. O preflight de import do Wan em CPU fornece apenas o índice padrão de GPU em um mock temporário, porque o código upstream o consulta na definição das classes; não instancia modelos nem modifica a execução real em GPU.

**RIFE 4.26** do autor interpola a tomada única para **60 fps de saída**, com pesos e código fixados por revisão/hash. Timestamps racionais entre quadros vizinhos: não repetir quadro final, alterar velocidade, interpolar entre cortes ou chamar os quadros estimados de geração nativa 60 fps. Entregar também a versão nativa para comparação. Os 64 quadros fornecem 237 timestamps de saída, dos quais 221 requerem inferência intermediária; não são 237 estados independentes gerados pelo Wan.

O checkpoint do autor inclui as cabeças `teacher` e `caltime`, comentadas como treinamento no código de inferência. Excluir somente esses dois prefixos, normalizar `module.` e carregar todos os parâmetros ativos com `strict=True`, tanto no preflight CPU quanto no worker. Não ignorar genericamente chaves faltantes ou arquiteturas incompatíveis.

Correção crítica de licença: **TalkVerse** foi avaliado por ser menor, mas sua licença Snap Non-Commercial não atende ao produto comercial universal pretendido. Não integrá-lo como substituto gratuito comercial. Wan usa Apache-2.0; o autor RIFE informa MIT também para os modelos distribuídos. Interpolação pode produzir artefatos em mãos, cabelo ou boca; não corrige sozinha lip-sync nem direção artística.

## P — Prevenção e validação

- Contratos offline rejeitam referência alterada, WAV alterado/truncado, formato errado e fala sem cobertura, antes de criar app/GPU.
- Comparar hashes, decode integral, resolução, contagem/duplicatas, FPS e timestamps das duas versões. Mesma fala usada para condicionar e para mux, sem música para mascarar fonemas.
- Inspecionar boca durante palavras com fechamento labial e pausas, identidade, roupas, mãos e quadros interpolados. Condicionamento de áudio não equivale a aprovação fonética; `lip_sync_validated` permanece falso até evidência/revisão suficiente.
- Créditos da conta: limites anteriormente confirmados de uso US$ 30 e gasto US$ 0. Não assumir aprovação de créditos extras nem saldo restante. Modelos maiores e CPU/RAM/startup também consomem compute; não iniciar novo capítulo automaticamente.
- Estimativa de worker H100 + 4 CPU + 64 GiB: US$ 0,00129148/s, sem incluir build/startup/idle/outros encargos; não é fatura.
- App encerrado e tarefas verificadas ao final. Nenhuma inserção em banco, consumo de candidato, mensagem, publicação, alteração do renderer de produção ou anúncio de integração no Studio.

Fontes oficiais: [Wan código e S2V](https://github.com/Wan-Video/Wan2.2), [pesos S2V](https://huggingface.co/Wan-AI/Wan2.2-S2V-14B), [RIFE e licença dos modelos](https://github.com/hzwer/Practical-RIFE), [pesos RIFE do autor](https://huggingface.co/hzwer/RIFE), [licença TalkVerse](https://github.com/snap-research/TalkVerse), [preços Modal](https://modal.com/pricing).

## Alternativas pesquisadas, sem habilitação

A medição inicial em H100 nesta resolução é de aproximadamente 29 s por passo, além de carregar modelos/encoders e interpolar. Portanto S2V é uma referência de qualidade a comparar, não um caminho anunciado como produção gratuita ilimitada. O próximo lote depende de qualidade observada e orçamento disponível.

[EchoMimicV3-Flash](https://github.com/antgroup/echomimic_v3) é candidato à comparação por ser um modelo de 1,3B e possuir uma variante oficial de oito passos, sem máscara facial e com licença Apache-2.0. Seus pesos Flash estão na subpasta `echomimicv3-flash-pro` do repositório oficial `BadToBest/EchoMimicV3`; não assumir outro nome de repositório. Ainda exige avaliar o encoder chinês recomendado, todas as licenças/dependências, acesso aos pesos e fala portuguesa em personagens de fruta. Não foi integrado nem executado por esta pesquisa.

[MuseTalk 1.5](https://github.com/TMElyralab/MuseTalk) permite corrigir lábios de um vídeo já animado e informa uso comercial do código/modelo. Contudo, exige avaliar as licenças dos componentes usados, detecção/rastreamento dos rostos de fruta, máscara e preservação de boca/bigode/pele. A região facial do modelo é 256 × 256; o próprio autor registra limitações de identidade e jitter. Não tratá-lo como solução perfeita ou instalada apenas por ser mais rápido.

## Resultado medido

Uma tomada da fala 07 foi gerada: áudio PCM 3,737 s, incluindo pausa final de 0,25 s; todas as word boundaries e margem de 0,15 s preservadas. Origem do áudio SHA-256 `725ab2252fda9acab72315f15762c129f6965c5add1f758c33277e5c5a2d5bb3`. Referência aprovada e mesma fala usados na geração e no mux. Seed 2007, 40 passos, saída nativa real 704 × 1280.

- `output/audio-driven-motion-probe/malu-native.mp4`: 4,000 s / 16 fps / 64 quadros distintos, 1.914.739 bytes, SHA-256 `1cbd2bc5ee0a950d013f988943ff6f7ad1c9615761a587db97bade44ba925762`.
- `output/audio-driven-motion-probe/malu-fluid.mp4`: 3,950 s / 60 fps / 237 quadros distintos, 2.289.457 bytes, SHA-256 `964179ee3b10f75e259912b1a1d35029c9fba65aba6e89ca80e035f232e36454`. São 221 estimativas neurais intermediárias; não 60 fps nativos de S2V.
- H.264/AAC, decode integral, checksum, FPS/contagem e início zero de áudio/vídeo aprovados nas duas versões. Correlação entre voz decodificada e PCM de entrada 0,999938; atraso medido 0 s. O teste negativo com atraso artificial de 200 ms foi reprovado. Essa correlação verifica transporte de áudio, não boca/fonemas.
- Sete testes locais passaram: integridade/limites de imagem/voz, WAV truncado, cobertura, timestamps sem cauda congelada e AAC deslocado; quatro scripts passaram em `py_compile`. Não alterar renderer de produção nem executar CI remoto como se houvesse deploy.

Inspeção de 12 momentos de cada versão: rosto, cabelo, vestido floral, brincos e cenário permanecem reconhecíveis; a personagem modifica boca, sobrancelhas, inclinação da cabeça e gesto de mão. Sem deformação evidente nas amostras inspecionadas. A extração de quadros busca o quadro seguinte ao timestamp solicitado, com quantização diferente entre 16 e 60 fps; o contact sheet não é uma medição fonética quadro a quadro. Não foi realizada escuta humana contínua nem validação de todos os fonemas. `lip_sync_validated=false` e revisão do operador continuam obrigatórios.

Worker: 1.420,282 s; cliente: 1.447,608 s. Estimativa somente do worker: **US$ 1,834 de compute**, excluindo build/startup/idle e preparações/interrupções anteriores. Saldo/fatura não consultados. O custo observado reforça que não se deve lançar um novo capítulo completo nesta resolução sem reserva de crédito e medição de uma rota mais eficiente.

Preparação incluiu três falhas em CPU corrigidas (helper ausente, consulta de CUDA no import, cabeças RIFE exclusivas de treinamento), uma execução interrompida no carregamento antes de denoising para instalar FlashAttention, e dois preflights CPU concluídos. Seus logs ficaram preservados. Não houve retries automáticos de inferência. A listagem autenticada confirmou todos os sete apps desta etapa parados com zero tarefas; nenhuma publicação, mensagem, volume, pauta consumida ou alteração do banco.

## Revisão do operador

O operador assistiu à amostra e respondeu “ficou bom!!!”. Em seguida autorizou gerar a conversa de 15–20 s. Registrar aprovação humana desta amostra separadamente: não modificar `lip_sync_validated=false` do QA técnico, nem presumir aprovação das novas tomadas, do capítulo inteiro ou da publicação. A ampliação está documentada no ADR-053.
