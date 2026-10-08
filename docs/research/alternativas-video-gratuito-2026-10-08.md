# Alternativas ao Modal para a novela humanizada

Pesquisa: 08/10/2026. Escopo: documentação oficial, repositórios dos autores, metadados e schemas públicos de endpoints. Nenhuma inferência, nova conta, credencial, alteração de faturamento ou publicação nesta pesquisa.

**Decisão posterior do operador, ADR-066:** excluir créditos de entrada e ofertas sem recorrência comprovada. WaveSpeed, cotas iniciais Alibaba e créditos iniciais Lightning permanecem neste levantamento como histórico, sem recomendação de cadastro ou integração vigente. A ordem de testes abaixo foi substituída por Modal mensal + ZeroGPU diário; Kaggle depende de adequação demonstrada. [Política atual](gratuidade-recorrente-video-2026-10-08.md).

## Veredito e referência de qualidade

Há caminhos legítimos para ampliar a capacidade gratuita. Ainda não foi comprovado um conjunto que sustente capítulos novos ilimitados, automáticos e com a qualidade aprovada. Créditos de entrada ajudam agora; GPU gratuita recorrente exige adaptação, filas e avaliação artística. Quantidade de APIs não equivale a quantidade de franquias independentes.

A referência é a mini-história aceita pelo operador após o ADR-064: identidade, roupa, cabelo, cenário e voz preservados, fala sincronizada e entrega a 60 FPS. O arquivo de 17,13s combina três planos animados com três planos sobre imagens; sua cobertura de animação é 49,32%. Não usar essa aprovação como comprovação de um capítulo inteiramente animado. A fala nova usa Wan2.2-S2V-14B, 40 passos, 16 FPS nativos e RIFE na finalização. A execução observada chegou a aproximadamente 53 GB de VRAM e consumiu US$3,67 de créditos do workspace, incluindo ajustes de faturamento; isso não é preço universal de uma tomada.

**Recomendação:** avaliar primeiro um serviço com Wan S2V, outro executor do mesmo modelo e a composição ação + lipsync. Modelos diferentes só entram na rota de qualidade aprovada depois de avaliação com os mesmos personagens e vozes.

## Matriz de capacidade

| Caminho | Benefício gratuito documentado | Papel possível | Situação neste projeto |
| --- | --- | --- | --- |
| WaveSpeedAI | US$1 de boas-vindas para novos usuários elegíveis; não é renovação periódica | Wan2.2 Speech-to-Video e InfiniteTalk via API | Documentado; conta, saldo, preço da tomada e qualidade pendentes |
| Alibaba Model Studio | Cota inicial por modelo, válida por 90 dias; vários modelos Wan têm 50s | Ação, referência de imagem e avaliação de áudio condicionado | Documentado; Singapore/International, cota e modo sem cobrança pendentes |
| Lightning AI | Cinco créditos de entrada anunciados sem cartão | Hospedar o mesmo worker ou modelos de lipsync | GPU disponível, armazenamento e saldo da conta não conferidos |
| Hugging Face ZeroGPU | Cinco minutos de GPU/dia por conta gratuita | Ação I2V e lipsync em tarefas curtas | I2V já funcionou; S2V e MuseTalk anteriores falharam; outras rotas só inspecionadas |
| Kaggle Notebooks | GPU gratuita, sujeita à disponibilidade e cota da conta | Jobs de avaliação em lote, modelos menores/offload | Nenhum notebook executado; worker de 53 GB não cabe diretamente numa GPU de 16 GB |
| Colab gratuito | Recursos variáveis, sem quantidade fixa garantida | Experimentos interativos do operador | Não adequado como API automática do Studio |
| Space próprio elegível / bolsa de GPU | Hospedagem ZeroGPU para conta elegível ou concessão sujeita à aprovação | Modelo e versão controlados pelo projeto | Não provisionado; concessão não é saldo disponível |

Não há nova rota de diálogo aprovada apenas por esta pesquisa. Endpoints ativos significam que a interface responde, não que geram corretamente ou que a conta tem cota.

## 1. WaveSpeed: teste próximo do modelo atual

A [FAQ oficial](https://wavespeed.ai/docs/faq) informa US$1 para novos usuários genuínos elegíveis; novo endereço de e-mail não garante crédito. As saídas são temporárias e devem ser salvas. A API oferece [Wan2.2 Speech-to-Video](https://wavespeed.ai/docs/docs-api/wavespeed-ai/wan-2.2-speech-to-video) com imagem e áudio e também [InfiniteTalk](https://wavespeed.ai/infinitetalk-api).

Avaliação proposta: mesma referência e WAV de uma fala aprovada, uma tomada curta, resolução compatível e preço consultado antes do envio. A família Wan é próxima da atual, mas serviço, pesos, passos e pós-processamento podem diferir. Não afirmar equivalência a 40 passos ou sincronização aprovada antes de examinar o resultado.

O crédito é uma ponte de teste, não produção mensal gratuita. Custo depende de modelo, duração e resolução; não extrapolar valores publicitários de uma execução para um episódio. Exigir saldo suficiente, ausência de recarga automática e recuperação do mesmo identificador após envio.

## 2. Alibaba: cota inicial útil, com uma distinção essencial

A [tabela oficial](https://www.alibabacloud.com/help/en/model-studio/model-pricing) lista 50 segundos para modelos como `wan2.5-i2v-preview`, `wan2.6-i2v`, `wan2.6-i2v-flash`, `wan2.2-i2v-flash`, `wan2.2-kf2v-flash` e rotas animate. Também há modelos 2.7 mais novos; não tratá-los como troca já avaliada. **Wan2.2 S2V não tem cota gratuita nessa tabela.**

As [regras da cota](https://www.alibabacloud.com/help/pt-br/model-studio/new-free-quota) exigem Singapore/International e estabelecem validade de 90 dias. É benefício inicial por modelo, não reposição mensal. Ativar **Free Quota Only**: ao esgotar, o serviço deve recusar com `AllocationQuota.FreeTierOnly`, sem excedente pago. Conferir isso no console antes da primeira inferência.

O [I2V Wan2.5/2.6](https://www.alibabacloud.com/help/en/model-studio/legacy-image-to-video-api-reference/) aceita `audio_url`. Aceitar voz de entrada não comprova alinhamento labial nos nossos rostos de frutas; os exemplos incluem narração e música. Primeiro teste: plano único de 5s/720p, imagem própria, voz existente, sem pedir novo áudio automaticamente. Dez tomadas de 5s são apenas o máximo aritmético de uma cota de 50s, antes de retakes; não são dez episódios.

Animate-move pode servir para atuação corporal, mas exige referência de movimento com direito de uso. Não extrair performances dos TikToks de terceiros para dirigir o elenco.

## 3. Lightning: outro executor para preservar a técnica

A [página de preços](https://lightning.ai/pricing) anuncia cinco créditos ao registrar e mais 25 ao adicionar cartão. Não é necessário acrescentar cartão para esta proposta. A [documentação de faturamento](https://api.lightning.ai/docs/platform/overview/faq/billing) trata créditos gratuitos como promocionais, condicionais e alteráveis; armazenamento acima da franquia também consome saldo. Não assumir que textos antigos sobre 15 créditos mensais garantem essa reposição hoje.

Proposta: conferir a GPU realmente liberada e executar a versão fixada do worker em máquina com memória adequada. É o caminho conceitualmente mais próximo de preservar pesos, passos e direção; trocar a infraestrutura não garante o mesmo tempo ou custo. A100 de 80 GB é um candidato de capacidade, não uma reserva já obtida. Verificar armazenamento dos pesos, build, memória, inicialização e encerramento; manter tudo dentro do crédito elegível.

Não existe benchmark Lightning deste projeto nem saldo autenticado nesta pesquisa. Também não atribuir as horas promocionais de uma GPU pequena à execução do modelo grande.

## 4. ZeroGPU: recorrência real, cota compartilhada

A [documentação oficial](https://huggingface.co/docs/hub/spaces-zerogpu) informa cinco minutos diários na conta gratuita, reiniciados 24h após o primeiro uso; `xlarge` consome o dobro. Mudar de Space não cria uma nova franquia. Contas pessoais em boas condições, e-mail verificado e mais de 30 dias podem hospedar até dois Spaces gratuitos. Elegibilidade não foi autenticada aqui.

### Inspeção efetiva de endpoints

| Space inspecionado em 08/10 | Constatação | Consequência |
| --- | --- | --- |
| `zerogpu-aoti/wan2-2-fp8da-aoti-faster` | Endpoint I2V existente no adaptador | Já produziu ação no projeto; prévia 480p/16 FPS não equivale ao master de fala |
| `Wan-AI/Wan2.2-S2V` | Rodando, `/predict`; backend patrocinado, host CPU | Falha anterior de geração continua sem causa esclarecida; status ativo não a resolve |
| `henrybit/musetalk-1-5` | Interface de boca existente | Falha terminal anterior; não declarar consertado sem nova prova |
| `fffiloni/LatentSync` | Rodando, vídeo + áudio, reserva declarada de 180s | Candidato de lipsync; áudio é cortado a 8s e vídeo a 10s; não gera atuação corporal |
| `victor/LongCat-Video-Avatar-1.5` | Rodando, imagem + áudio; reserva 240s em `xlarge` | Reserva equivalente a 480s excede os 300s gratuitos; não é rota gratuita pronta |
| `Lightricks/LTX-2-3` | Rodando, imagem/prompt; sem parâmetro de áudio próprio nesse endpoint | Candidato de ação; não preserva por essa interface o WAV de ator fornecido |
| `FarmerlineML/infinitetalk` | Erro de build | Indisponível |
| `apexstudio/infinitetalk` | Página estática | Não é inferência utilizável |

Código consultado: [LongCat fixado](https://huggingface.co/spaces/victor/LongCat-Video-Avatar-1.5/blob/daeb7c18bdfd051b5f94a2e88287a50ccf2988e3/app.py) e [LatentSync fixado](https://huggingface.co/spaces/fffiloni/LatentSync/blob/058d1fbd5e450d527510907a4094b8826cc206a5/app.py). Os forks LongCat adicionais encontrados estavam pausados ou em erro. O LongCat inspecionado usa 8 passos, INT8 e LoRA de destilação; isso altera a técnica frente ao take aprovado.

Um Space próprio permite controlar versão e limites, mas exige medir tempo/memória reais. Não diminuir a duração declarada sem demonstrar que o job cabe nela. Demo pública e cota diária não constituem garantia de serviço para clientes.

## 5. Kaggle e Colab: funções diferentes

[Kaggle](https://www.kaggle.com/docs/notebooks) documenta P100 ou duas T4, sessões CPU/GPU de até 12h e filas de disponibilidade. O [CLI oficial](https://github.com/Kaggle/kaggle-cli) permite executar e consultar notebooks em lote. Conferir cota e elegibilidade na conta; não prometer a cifra popular de 30h semanais como franquia atual garantida.

Duas T4 de 16 GB não formam automaticamente uma GPU de 32 GB. O worker atual pede adaptação de offload/sharding e compatibilidade de kernels; notebooks de lipsync menores são candidatos mais simples. Rodar jobs limitados de avaliação primeiro. Não há prova de que essa cota autorize operar um backend permanente de geração para todos os clientes.

A [FAQ do Colab](https://research.google.com/colaboratory/faq.html) restringe, no uso gratuito, controle remoto e interação que contorne o notebook para gerar conteúdo por interface web. Recursos são variáveis. É alternativa manual de laboratório, não servidor automático por túnel para o Studio.

## 6. Métodos que reduzem a dependência de uma geração cara

### Ação corporal e boca em etapas

1. Gerar uma atuação corporal própria, com plano, gesto e enquadramento definidos.
2. Guardar o vídeo com hash, personagem, roupa, cenário, direção, duração e licença.
3. Aplicar áudio do ator e modelo de boca sobre essa atuação.
4. Revisar rosto/expressão e só então interpolar/finalizar o vídeo.

[MuseTalk](https://github.com/TMElyralab/MuseTalk) trabalha numa região facial de 256×256, não cria gestos, e pode perder detalhe de boca/pele. Código MIT; permissões dos demais pesos e assets também precisam ser conferidas. [LatentSync](https://github.com/bytedance/LatentSync) usa vídeo e áudio; os autores informam 8 GB para 1.5 e 18 GB para 1.6. Não identificar automaticamente o Space público como a versão 1.6.

**Inferência de engenharia:** reaproveitar uma atuação compatível pode economizar regeneração do corpo e cenário. A economia, naturalidade e fidelidade em frutas humanizadas ainda precisam de benchmark. Reutilizar não significa repetir o mesmo gesto em todas as cenas. Boca, oclusão, bigode e identidade precisam de avaliação quadro a quadro.

### Modelos de fala e corpo alternativos

[InfiniteTalk](https://github.com/MeiGen-AI/InfiniteTalk) combina imagem/vídeo com áudio, possui opções de menor VRAM e licença Apache 2.0. [LongCat-Video-Avatar 1.5](https://github.com/meituan-longcat/LongCat-Video) oferece animação condicionada ao áudio, continuação e licença MIT. São candidatos fortes para atuação, não GPUs gratuitas por si mesmos. Distilação, quantização e caches podem acelerar, mas exigem comparação artística; não prometer rapidez sem perda de qualidade.

### Modelos e sites que não entram como reserva gratuita automática

| Opção | Motivo para não contar como capacidade disponível |
| --- | --- |
| LTX-2.3 | A [licença](https://huggingface.co/Lightricks/LTX-2.3/blob/main/LICENSE) contém restrição a serviços concorrentes; SaaS requer esclarecimento. A [API](https://docs.ltx.io/pricing) é tarifada, separada da demo |
| Pika | A [tabela atual](https://pika.art/pricing) não sustenta uma reserva recorrente gratuita comercial/API |
| PixVerse / Runway | Crédito do aplicativo não é necessariamente crédito da API: [PixVerse](https://docs.platform.pixverse.ai/subscribe-api-plans-882969m0), [Runway](https://help.runwayml.com/hc/en-us/articles/15124877443219-How-do-credits-work) |
| fal / Replicate | [fal](https://fal.ai/pricing) e [Replicate](https://replicate.com/docs/topics/billing) cobram inferência; não foi comprovada franquia gratuita recorrente apropriada |
| Runpod startup | [Crédito condicionado ao programa](https://www.runpod.io/startup-program), não benefício mensal universal |
| Wav2Lip original | [Licença de uso não comercial](https://github.com/Rudrabha/Wav2Lip), inadequada como base do produto universal |
| Pollinations | [Pollen](https://github.com/pollinations/pollinations/blob/main/enter.pollinations.ai/POLLEN_FAQ.md) depende de saldo/recompensas/modelo; não foi comprovada franquia permanente gratuita para nossa fala |

## 7. Como integrar sem recriar o que já existe

Isto já existe em `packages/core/src/stories/video-routing.ts`: seleção por tipo de tomada, capacidade, qualidade, cota, validade da consulta, reserva e grupo de cota. Isto já existe em `apps/local-renderer/src/free-video-provider.ts`: avaliação de três serviços públicos. Isto já existe em `scripts/render-free-story-shot.mts`: checkpoint, bloqueio e retomada. Ampliar essas peças; não criar outro roteador global nem confundir pesquisa com capacidade habilitada.

A adaptação proposta mantém:

- **Cotas por conta/provedor e unidade:** segundos de vídeo não viram minutos de GPU nem dólares; Spaces do mesmo grupo compartilham saldo.
- **Escolha por tarefa:** diálogo requer voz condicionada; ação/reação não comprova lipsync. O provedor precisa passar o contrato do master, não apenas produzir um arquivo.
- **Qualidade demonstrada:** guardar versões dos pesos, parâmetros, PNG/WAV e resultado de avaliação. Testes com dois personagens, gesto, emoção e oclusão; reavaliar após mudança de versão.
- **Um envio por tomada:** após aceitação ou resposta incerta, reconciliar o mesmo job. O fallback atual só permite recusa antes de aceitação; não ignorá-lo para gastar em paralelo.
- **Desembolso zero:** verificar bloqueio externo e saldo antes de reservar; não ativar pós-pago ou recarga para completar um vídeo.
- **Fila transparente:** se todas as rotas aprovadas estiverem indisponíveis, informar a espera. Não entregar automaticamente câmera sobre foto no lugar da animação escolhida.
- **Cliente no navegador:** trabalho remoto, conta conectada quando necessário e revisão no Studio; computador potente e API exposta ao cliente não são requisitos. [OAuth Hugging Face](https://huggingface.co/docs/hub/spaces-oauth) é uma possibilidade de conexão a avaliar.

O limite local de duas submissões por grupo/dia UTC do avaliador é proteção interna; não corresponde ao reset externo ZeroGPU. `animated_available` continua falso em produção: ainda falta rota de fala gratuita estável e aprovada.

## 8. Ordem de testes original — substituída pelo ADR-066

1. **Contas e cotas:** verificar WaveSpeed, Alibaba Singapore com Free Quota Only e Lightning sem cartão. Não enviar imagens/voz até demonstrar saldo elegível e ausência de cobrança. Dependência externa real: cadastro/eligibilidade/credencial.
2. **Mesmo modelo em outro serviço:** uma fala curta Wan2.2 S2V na WaveSpeed; em Lightning, verificar primeiro se existe GPU de memória suficiente para o worker fixado. Sem retake automático.
3. **API com cota de segundos:** uma tomada Alibaba 720p com imagem e voz próprias; avaliar lipsync antes de classificá-la como diálogo.
4. **Recorrência:** vídeo corporal já licenciado + LatentSync; posteriormente comparar MuseTalk/InfiniteTalk em notebook ou Space elegível. Não consumir duas etapas na mesma cota sem somar suas reservas.
5. **LongCat:** somente após conseguir execução que caiba na cota e na memória; o endpoint ativo de 240s/xlarge não satisfaz a conta gratuita.
6. **Promover por prova:** revisar início/fim, todos os frames, anatomia, continuidade, emoção e boca; medir transporte/decode, áudio, duração, resolução efetiva e frames nativos versus interpolados. Um resultado aprovado permite a próxima avaliação; não prova disponibilidade contínua.

Medir tempo de fila, inicialização, inferência, finalização, crédito total e taxa de tomadas aprovadas. Estimar capacidade por **custo de segundo aprovado**, incluindo retakes e overhead; não mostrar ao usuário número de episódios antes dessas medições. O padrão de 60 FPS continua sendo entrega, não evidência de 60 poses nativas por segundo.

## Evidência e limites da entrega

Metadados e schemas estão nos arquivos locais ignorados `output/provider-research-2026-10-08/space-endpoints.json` e `second-space-inspection.json`, com revisões e `inference_submitted: false`. Código público foi lido em revisões fixadas. As páginas Lightning/Kaggle tiveram conteúdo oficial indexado disponível mesmo quando a abertura direta foi incompleta.

Nenhum resultado visual novo, cota privada, tempo de geração ou qualidade equivalente foi medido nesta rodada. Não houve alteração do pipeline, de estados do banco, do Studio, de contas ou do saldo Modal. Esta entrega registra o plano de avaliação; não anuncia integração concluída.
