# ADR-057 — Reuso limitado de modelo sem reduzir parâmetros de qualidade

Data: 2026-10-07. Status: implementado e preparado localmente; benchmark GPU pendente do saldo atual. Fora da produção.

## O — Objetivo

Continuar a investigação de tempo/custo solicitada pelo operador. Reaproveitar o modelo entre duas tomadas para medir a economia de carregamento, mantendo as entradas artísticas, áudio condicionado, resolução, sampler, 40 passos e interpolação existentes. Não prometer ganho nem equivalência visual antes de medir.

## C — Contexto

Isto já existe em `scripts/modal-speech-motion-probe.py`: pesos fixados na imagem, FlashAttention, streaming com hash, áudio/pose próprios, sem retry e proteção de chamadas concluídas. Isto já existe em `scripts/render-story-conversation.py`: reaproveitamento de tomadas concluídas, checkpoint, leitura restrita das duas credenciais Modal e escrita atômica de JSON. Não recriar esses mecanismos.

O worker reinstancia `WanS2V` por chamada e libera o objeto antes do RIFE. No ADR-056, carregamento consumiu 72,715 s; geração/preprocessamento/decode, 1.320,382 s; cliente, 1.433,742 s. Cache de carregamento trata uma fração pequena do tempo. Paralelização não garante menor custo. Não reduzir passos, qualidade, movimento ou resolução para alegar aceleração sem perda.

O upstream fixado cria ruído e scheduler locais por geração, com seed explícita; transfere o modelo de ruído para CPU após o loop. Isso permite investigar reuso, mas não prova ausência de estado residual, consumo de memória aceitável ou determinismo da GPU. Pesos retidos durante o RIFE aumentam a memória ocupada em relação ao caminho anterior. Não promover o experimento com base apenas em testes CPU.

Última configuração informada: Starter com US$ 30 de créditos, usage cap US$ 30 e spend cap US$ 0. Saldo/fatura atual não consultados. A sessão não possui navegador conectado ao Modal. Pergunta ao operador solicita apenas o consumo atual para calcular saldo; não solicita permissão repetida. Não aumentar limites, alterar faturamento nem aguardar aprovação acadêmica para preparar o código.

## S — Solução

Extrair o corpo existente para `generate_speech`; `speak` continua com o mesmo contrato e timeout de 2.100 s, carregando/liberando o modelo por tomada. `GENERATION_SETTINGS` concentra exatamente os parâmetros já usados e é registrado no relatório. `receive_stream` reutiliza o receptor existente e fortalece validação de relatório duplicado, chunks vazios e checksum de ambos os arquivos antes de escrever qualquer um.

Adicionar `speak_reuse_benchmark`, somente experimental: uma chamada geradora, duas tomadas idênticas de 64 quadros, H100/4 CPU/64 GiB, um contêiner, zero contêineres quentes e timeout total de 4.200 s. `ModelSession` carrega uma vez, permite apenas dois usos e libera a referência em `finally`, inclusive quando a inferência falha ou a iteração é cancelada. Não é um endpoint público nem um serviço quente. As duas solicitações completas são validadas antes do carregamento; uma terceira tomada, campos extras ou diferenças artísticas são rejeitados. Sem reload ou retry automático.

Registrar fingerprint de todos os quadros RGB nativos antes do encoder, configuração de geração, estado de reuso, pico de memória GPU alocada da geração e pico RSS acumulado do processo no lote (Linux). O pico RSS não é uma medição isolada por tomada. Tempo por tomada mantém o escopo histórico; tempo do lote inclui streaming/liberação e exclui boot/build/idle. Comparar primeira carga versus segunda, reportando também os tempos totais. Hash diferente impede alegar equivalência; hash igual não dispensa revisão de atuação/boca/mãos. Comparação não prova que toda a geração acelerou.

CLI `scripts/benchmark-story-model-reuse.py` prepara um manifesto imutável a partir do gesto estável aprovado por hash, sem criar imagem, nova TTS, episódio ou registro no banco. A primeira e a segunda tomadas usam a mesma imagem, WAV, pose, prompt, seed e pesos. Isto é um benchmark técnico de reuso, não outra decisão de gesto. A prévia ampliada do ADR-056 continua aguardando revisão humana separada.

`--run` exige saldo atual informado em `--available-credit-usd`. Reservar estimativa de execução máxima de US$ 5,424216 (4.200 × US$ 0,00129148/s) mais US$ 1 de margem: US$ 6,424216 disponíveis. A margem não garante teto da fatura e o saldo informado não é verificação via API. A restrição do provedor continua sendo necessária. O custo medido anterior sugere duas tomadas perto de US$ 3,6 de worker, mas isso não é cotação nem orçamento definitivo. Não alocar GPU com saldo desconhecido/insuficiente. Depois de falha, lock ou saída parcial, inspecionar app/evidência; nunca remover automaticamente nem reiniciar. Resultado concluído é auditado sem nova chamada.

Persistir cada tomada completa por checksum/decode antes do checkpoint, e fazer o QA de áudio/timestamps/quadros existente nas duas versões. Saída em `output/model-reuse-benchmark/`, ignorada pelo Git. Nenhuma alteração de schema, estado, Gemini, `job_events`, renderer de produção, Studio, Telegram ou publicação; esses mecanismos pertencem à produção, este continua sendo um experimento isolado.

## P — Prova

Onze novos testes offline: uma carga compartilhada, bloqueio de terceiro uso, falha terminal de construção, validação do lote inteiro, saldo ausente/insuficiente/não finito, plano alterado, lock/falha/parcial sem credenciais ou app, encerramento de sessão após falha de inferência, checkpoint concluído sem chamada, ordem/marcador de transporte, divergência dos parâmetros, corrupção e transporte/decode real dos vídeos anteriores. Dezesseis testes anteriores continuam passando. Total: 27 testes locais; compilação Python e `git diff --check` verificados.

Manifesto preparado localmente. Primeira versão de preparação arquivada como `plan-preparation-v1.json` antes de adicionar os parâmetros completos ao manifesto; nenhuma chamada Modal foi iniciada nessa preparação. Não há novo vídeo, saldo consultado, tempo economizado medido, CI remota ou integração em produção nesta rodada. Resultado da GPU e revisão humana permanecem pendentes; não apresentar testes locais como evidência desses resultados.

Fontes primárias: [Wan S2V fixado](https://github.com/Wan-Video/Wan2.2/blob/1ea34ff48f87168174e12956e200b1d908b1c5ff/wan/speech2video.py), [preços Modal](https://modal.com/pricing), [ciclo de vida dos contêineres](https://modal.com/docs/guide/lifecycle-functions).
