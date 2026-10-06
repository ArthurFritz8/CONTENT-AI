# ADR-051 — Piloto humanizado com diálogo e várias tomadas

Data: 06/10/2026. Status: capítulo local gerado, QA técnico aprovado; revisão artística do operador pendente. Recurso de animação do Studio continua sem habilitação.

## O — Objetivo

Responder à aprovação da amostra do ADR-049 com um capítulo local completo. Avaliar continuidade visual, atuação, vozes, legendas e ritmo durante uma cena, em vez de extrapolar dois segundos para uma novela pronta. Nenhuma publicação automática.

## C — Contexto

O operador considerou os dois segundos aceitáveis e solicitou ver uma cena/episódio. Isto já existe: `scripts/modal-wan-probe.py` gera movimento da referência e `clip-render.ts` monta clipes medidos com áudio/legendas (ADR-050). Reutilizar esses caminhos e os schemas/helpers do core; não criar outro renderer ou estados editoriais.

Wan TI2V não condiciona a boca ao áudio. Acrescentar TTS não valida fonemas; o piloto deve apresentar essa limitação explicitamente. A imagem da sessão também não é uma API instalada no produto. Não habilitar a geração no painel apenas por causa deste capítulo.

## S — Solução

Roteiro original versionado em `docs/stories/pilot-01-malu-laranjito.json`: uma cobrança cômica do biscoito revela que o irmão de Malu voltou. Seis blocos narrativos e um CTA orgânico, 19 tomadas. Referência geral do ADR-046 e dois closes derivados pela ferramenta integrada de imagens, mantendo identidade, figurino, rua e eixo de diálogo. Hashes fechados em whitelist no worker; prompts/proveniência nos arquivos do piloto.

`prepare-story-pilot.py` reutiliza `synthesize-edge.py`, mede as duas vozes existentes e usa word boundaries reais. Primeira versão tinha 141,454 s; o diálogo foi enxugado para 101,590 s medidos, incluindo pausas de 0,25 s. Não acelerar ou repetir clipes para alcançar o mínimo.

`render-story-pilot.py` reutiliza o worker Wan fixado por modelo/revisão, 30 steps, 704 × 1248, 24 fps. H100 80 GB é usado neste piloto para tempo/capacidade de tomadas maiores, mantendo o caminho L40S do teste original. Um contêiner por função, sem retries automáticos, sem volumes, rede bloqueada e acesso Modal restrito. Até 241 quadros por chamada, timeout de 900 s; nenhuma nova chamada se o tempo de sessão mais startup/timeout possível ultrapassar 7.200 s. Reuso dos pesos na memória entre tomadas; app encerra ao final. O contador de sessão não é uma reserva multiusuário de produção.

Cada tomada é transmitida em blocos de 128 KiB, gravada atomicamente após hash e decode, com checkpoint que inclui referência, prompt, seed, dimensões, steps e revisão. Retomada ignora somente arquivos íntegros com fingerprint idêntico. Falha preserva os clipes completos, sem refazer todos ou trocar de qualidade silenciosamente.

`assemble-story-pilot.mts` reutiliza `buildStoryScript`, schemas de ficção, builders ASS, word timing, filtro de clipes, mixer com ducking e QA audiovisual. Os diálogos possuem falas curtas em duas vozes dentro dos sete blocos; esse plano experimental não altera o TTS de produção por cena. Uma trilha procedural original muda de curiosidade para mistério; sem samples externos. Final vertical 1080 × 1920 a 30 fps, com upscaling declarado da fonte 704 × 1248. Não chamar o upscaling de geração nativa Full HD.

O UUID do roteiro local é uma referência de prévia, não linha criada no banco. Nenhuma pauta existente é consumida, nenhum episódio/publish/review criado e nenhuma mensagem enviada durante este piloto. O cliente futuro continuará usando navegador; geração roda na nuvem e a montagem local deste experimento não define requisito de hardware do cliente.

## P — Prevenção e validação

- Validar roteiro no core e duração real >=60 s antes de gastar compute de vídeo.
- Conferir primeira tomada maior antes de seguir com o capítulo.
- Inspecionar início/meio/fim de cada tomada e cortes entre planos: rosto, cabelo, roupa, mãos, cookie, lado de diálogo e fundo.
- Reprovar falta de cobertura da faixa de vídeo; não reutilizar um clipe de dois segundos em loop.
- Verificar narração, legendas, mix, duração, resolução/FPS, codecs, hash e decode integral do final. Medir loudness/picos/silêncio; escuta humana e aprovação artística são verificações separadas e permanecem para a revisão do operador.
- A conta mantém limite de uso US$ 30 e gasto US$ 0. Compute utiliza créditos; carga, CPU, memória, idle e tentativas também contam. Não considerar pedido de créditos extra como aprovado.
- A listagem de preço consultada em 06/10 informa H100 a US$ 0,001097/s, CPU a US$ 0,0000131/core/s e memória a US$ 0,00000222/GiB/s. Tempo é estimativa de consumo, não fatura ou saldo disponível.
- Registrar limitações da boca e consistência, e não anunciar que a geração automática do Studio já foi modificada.

Fontes: [Modal preços e medição](https://modal.com/pricing), [Wan oficial](https://github.com/Wan-Video/Wan2.2).

## Resultado e correção editorial

As 19 tomadas completaram em H100 80 GB. Os checkpoints passaram por hash, cobertura da fala, decode integral e contagem de quadros distintos. Foram inspecionados início/meio/fim das 19 tomadas, além de amostras do final com legendas. Aparência, figurino e ambiente permaneceram reconhecíveis nos quadros amostrados. Há mudanças espontâneas de olhar e gesto; nas tomadas 04 e 14 Laranjito se vira durante a fala. Isso não é controle de atuação exato, inspeção contínua de todo o movimento ou aprovação artística automática.

A primeira montagem tinha 101,723 s. A medição do diálogo detectou 19 caudas silenciosas de cerca de 1,2 s entre cortes. Correção: o assembler mede somente silêncio final, preserva todas as word boundaries e acrescenta 0,15 s após o último som/palavra, mantendo a pausa editorial de 0,25 s. Pausas dentro da fala e sua velocidade não mudam. Foram removidos 13,146 s de silêncio; nenhum clipe precisou de nova inferência. O compositor original recalcula a trilha e o fade a partir desses tempos editados. Original e medidas anteriores ficaram preservados na pasta `review/`.

Final: `output/humanized-story-pilot/episodio-01-o-biscoito-e-o-segredo.mp4`, 88,552 s, 1080 × 1920, média 29,978 fps, H.264 yuv420p/AAC, 103.673.614 bytes. SHA-256 `fe42d10b213c98288e2641efac53b023ca744868865b77369fb2e7852b31723c`. QA audiovisual e decode integral passaram, sem warnings. Loudness medido -16,22 LUFS, pico verdadeiro -1,47 dBTP, LRA 3,8 LU; o diálogo editado não apresentou silêncio >=1 s pelo detector -45 dB. Isso não verifica fonemas nem substitui ouvir o mix.

Prévia para revisão em conexão móvel: `episodio-01-previa-leve.mp4`, 720 × 1280, mesmos 88,552 s, 30.495.802 bytes. Hash, codecs, dimensões, duração e decode integral também passaram. Não foi enviada ao Telegram nem publicada.

Tempo agregado dos workers: 2.850,068 s. Estimativa apenas desse tempo para H100 + 4 cores + 24 GiB: US$ 3,428 em compute; exclui preparação/startup fora do cronômetro, idle, transferências, falhas anteriores e arredondamento da fatura. Saldo e fatura não foram consultados. A listagem autenticada confirmou os apps da primeira tomada e do lote parados, zero tarefas. Não houve volume, endpoint pago, publicação ou acesso ao banco.

Validação local adicional: TypeScript do assembler, `py_compile` dos cinco scripts Python e verificação offline dos fingerprints/checksums e escrita atômica. Uma alteração de seed invalida o checkpoint; clipe sem checkpoint interrompe a retomada para evitar refazer compute silenciosamente. CI remoto não foi executado por este experimento.

A boca continua sem condicionamento ao áudio. Referências foram criadas pela ferramenta integrada `image_gen` da sessão, não por uma API conectada ao produto. O renderer sabe montar clipes, mas produtor durável, imagens automatizadas, orçamento por workspace e progresso integrado ao Studio ainda precisam de implementação/validação. O capítulo não habilita automaticamente o modo animado para os clientes.
