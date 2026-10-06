# Modal — teste controlado de render

Este procedimento valida a infraestrutura do ADR-047. Não habilita animação no Studio, não cria episódio e não modifica fila, revisões ou publicações. O renderer de produção permanece independente deste experimento.

## Conta e credenciais

A conta do operador confirmou Starter com US$ 30/mês de compute, limite de utilização de US$ 30 e limite de gastos de US$ 0 por captura do painel em 05/10/2026. Os créditos adicionais solicitados não foram aprovados nem entram no planejamento.

Guardar `MODAL_TOKEN_ID` e `MODAL_TOKEN_SECRET` somente em `.env.cloud`, já ignorado pelo Git. O script importa exclusivamente essas duas variáveis; não transmite o arquivo de ambiente nem as credenciais do banco. Não é necessário criar um perfil global com `modal token set`.

O token foi autenticado no workspace `arthurfritz8`. Não repetir o teste após trocar a conta sem verificar novamente identidade, crédito elegível e limites no painel. Não remover o limite de gastos para contornar uma falha.

## Executar

Dependência local testada: Python 3.13 e Modal SDK 1.6.1. Não é necessário Blender local para executar o render remoto; este teste exige o `.blend` e o áudio próprios produzidos no experimento anterior.

```powershell
python -m pip install modal==1.6.1
python scripts/modal-render-probe.py --run
```

O parâmetro `--run` é obrigatório. Uma execução solicita uma GPU L4 ou A10 conforme disponibilidade, um único contêiner, sem contêineres permanentemente ativos, sem retry automático e sem volumes persistentes. CPU é limitada a 2 cores e memória a 4 GiB. O worker tem timeout de 180 s; preparação da imagem e espera por capacidade ocorrem antes do processamento. O limite de gastos do provedor é a proteção contra desembolso, enquanto timeout e tamanho do teste limitam consumo do crédito.

Somente o `.blend` próprio (até 25 MiB) e `mix.wav` (até 2 MiB) são enviados como dados. Scripts embutidos do Blender não são executados. Blender é fixado em 4.5.14, mesma versão da cena. O worker usa CUDA e falha se não detectar GPU; não troca silenciosamente para CPU. A rede do worker e o acesso dele à API Modal são bloqueados.

O resultado é transmitido em blocos inline de 128 KiB. O cliente verifica nome, sequência, tamanho (máximo 10 MiB por arquivo) e SHA-256 antes de gravar. Essa estratégia evita a chamada interna `BlobCreate` que falhou com 401 na primeira tentativa de devolver todos os arquivos juntos sob `restrict_modal_access=True`. O isolamento não é removido para contornar essa falha. O SDK não permite configurar retries em funções geradoras.

Não transformar este script de pesquisa em receptor de arquivos Blender de clientes sem isolamento e validação adicionais. Um arquivo de cena continua sendo um formato complexo, mesmo com execução automática desabilitada.

## Resultado

O diretório local ignorado `output/modal-render-probe/` recebe:

- `cloud-sample.mp4`: 24 quadros / 24 fps, 1 s, 540 × 960, áudio reaproveitado, H.264/AAC.
- `preview-1.png`, `preview-170.png`, `preview-330.png`, `preview-420.png`: quatro tomadas da cena própria.
- `qa.json`: dispositivos GPU, tempos por quadro e do worker, tempo total do cliente, SHA-256 da cena, dimensões, codecs e decodificação integral.

Essa resolução e duração pertencem exclusivamente ao experimento. O mínimo de 60 s do contrato de episódios não muda. O resultado é renderizado em Cycles, enquanto a amostra local anterior utilizou EEVEE; diferenças de iluminação e velocidade não são uma comparação controlada entre hosts.

O custo efetivamente contabilizado deve ser consultado em Uso e faturamento da Modal; tempo por quadro não é uma fatura. Não converter a amostra curta em um número prometido de novelas por mês. Preparação, CPU/memória, inicialização, tentativas futuras e cenas humanizadas precisam entrar na medição.

## Próxima etapa de produção

Depois do teste, desenvolver e validar uma cena humanizada representativa. A integração exige suporte real a clipes, executor durável, reserva de compute, callbacks idempotentes, progresso real no Studio, isolamento por workspace e reutilização de QA/revisão. O navegador será somente a interface; o usuário final não precisa configurar tokens da Modal.

Não usar Shared Endpoints pagos como se fossem cobertos por créditos de compute. A captura do painel informa que armazenamento em volumes pode continuar gerando cobranças após o limite de gastos; este experimento não provisiona volumes.

Fontes oficiais: [início e autenticação](https://modal.com/docs/guide/getting-started), [exemplo Blender](https://modal.com/docs/examples/blender_video), [limites](https://modal.com/docs/guide/budgets), [preços e créditos](https://modal.com/pricing).

## Validação de 05/10/2026

O teste corrigido completou na NVIDIA A10 com Blender 4.5.14 LTS. Worker: 113,53 s; execução do cliente: 140,194 s. Arquivo de 109.358 bytes, duração 1 s, 540 × 960, 24 fps, H.264/AAC. Integridade, 24 quadros distintos, decodificação integral no worker e localmente passaram. Quatro tomadas foram inspecionadas visualmente. Relatório local: `output/modal-render-probe/qa.json`; decisão e limitações: [ADR-048](ADR/ADR-048-prova-render-modal.md).

Isso conclui a prova de infraestrutura e transporte; não conclui integração no Studio, QA de episódio publicável, sincronização fonética ou direção artística humanizada. A consulta ao consumo contabilizado na Modal continua pendente.

## Amostra humanizada de 06/10/2026

O experimento seguinte usa Wan2.2-TI2V-5B com a imagem humanizada aprovada, sem a cena Blender anterior:

```powershell
python scripts/modal-wan-probe.py --run
```

Uma L40S, 4 cores, 24 GiB de RAM, no máximo um contêiner, prazo de 900 s, sem retry automático nem volume. Usa os mesmos dois tokens em `.env.cloud`. A imagem de contêiner contém os pesos públicos fixados por revisão, e o worker roda sem rede. Não habilita geração no Studio.

Resultado: `output/humanized-motion-probe/malu-laranjito-motion-v1.mp4`, 2,042 s, 49 quadros / 24 fps, 704 × 1248, silencioso. O relatório `qa.json` registra hash, tempos e QA. Worker medido: 144,287 s; cliente: 174,254 s; pico de memória CUDA alocada: 24,890 GiB. Essa execução direta foi validada na L40S, não em uma GPU de 24 GB. A listagem autenticada confirmou app parado e zero tarefas.

Antes do arquivo entregável houve uma falha de dependências e duas inferências sem exportação. O exportador agora usa FFmpeg, solicita quadros PIL explicitamente e passa por teste preliminar. Todas as tentativas contam para o consumo de compute; não prometer que a franquia produz uma quantidade mensal fixa. Os resultados e limites estão no [ADR-049](ADR/ADR-049-teste-movimento-imagem-aprovada.md).

O renderer recebeu suporte real a clipes de cena no [ADR-050](ADR/ADR-050-render-de-clipes-por-cena.md), com 30 testes e TypeScript passando. Faltam produtor integrado, referências automatizadas, jobs duráveis e reserva de orçamento para habilitar a animação no painel. O usuário final continuará usando apenas o navegador.

## Capítulo local com várias tomadas

O [ADR-051](ADR/ADR-051-piloto-humanizado-multiplas-tomadas.md) amplia o teste para um capítulo isolado, após aprovação da aparência em movimento. O roteiro é versionado; os dois closes estão em `output/humanized-story-pilot/references/`. A ferramenta de imagens da sessão criou esses closes; não existe chamada dessa ferramenta pela aplicação.

Pré-requisitos locais medidos: FFmpeg/ffprobe no PATH, dependências Node do repositório, Python com Modal 1.6.1, edge-tts 7.2.8 e NumPy 2.2.6. Preservar os três PNGs aprovados e o arquivo de proveniência: são artefatos locais ignorados pelo Git e não podem ser reconstruídos com o mesmo hash apenas repetindo o prompt.

```powershell
python scripts/prepare-story-pilot.py
python scripts/score-story-pilot.py
python scripts/render-story-pilot.py --run --shots 01
# Conferir a primeira tomada e depois gerar as restantes; a íntegra do checkpoint é verificada.
python scripts/render-story-pilot.py --run
node --experimental-strip-types scripts/assemble-story-pilot.mts
python scripts/audit-story-pilot.py
# Depois da montagem final, medir níveis de áudio e silêncio do diálogo:
python scripts/audit-story-pilot.py --final
```

O modo `--available` do assembler confere e monta só as tomadas já recebidas, sem produzir um final incompleto. A geração usa H100 pela opção do caller; o worker padrão permanece L40S. O mesmo modelo fica em memória entre entradas, um contêiner ativo, idle máximo 30 s, app encerrado ao terminar. O worker ainda tem rede/API bloqueadas e não recebe segredos do banco. Cada chamada é limitada a 241 quadros e 900 s; a sessão não inicia uma chamada se seu possível timeout/startup passar de 7.200 s. Não reiniciar uma sessão sem conferir novamente crédito/limites após um bloqueio do provedor.

O resultado não demonstra boca sincronizada. Diálogo em duas vozes, legibilidade de legendas e continuidade visual serão avaliados no capítulo; isso não é a habilitação do modo animado para clientes. Não existe inserção no banco, consumo de pauta ou publicação nesses comandos.

O audit registra quadros decodificados/distintos e início/meio/fim de cada tomada. Quadros distintos descartam um arquivo inteiramente estático; não comprovam atuação natural ou ausência de defeitos visuais. O assembler verifica hash, cobertura medida da fala, legendas e o QA final. `preview-script.json` organiza sete blocos editoriais locais; não é um episódio com assets pronto para submissão ao renderer de produção.

Resultado de 06/10: 19 tomadas geradas; capítulo final de 88,552 s passou no QA audiovisual e decode integral. O assembler removeu apenas caudas silenciosas medidas, preservando palavras/pausas internas, e recalculou a trilha original. Relatórios: `episode-qa.json`, `audio-qa.json`, `editing-cuts.json`, `shot-audit.json` e `modal-final-state.json`. Apps encerrados com zero tarefas. A escuta completa e aprovação artística do operador permanecem pendentes; não houve publicação.

O operador posteriormente reprovou boca/fala e fluidez. O [ADR-052](ADR/ADR-052-fala-condicionada-e-interpolacao-de-quadros.md) testa uma única fala usando áudio como entrada real da animação, com uma versão nativa e outra interpolada por RIFE. Não repetir TI2V esperando que adicionar áudio depois sincronize a boca.

```powershell
python scripts/modal-speech-motion-probe.py --prepare
python scripts/test_story_motion_contract.py
python scripts/modal-speech-motion-probe.py --build-only
python scripts/modal-speech-motion-probe.py --run
python scripts/audit-speech-motion-probe.py
```

Reutiliza o close aprovado e a fala 07 do piloto, verificando integridade antes de criar o app. Wan S2V requer GPU de 80 GB: esta amostra usa H100, até 1.800 s, 64 GiB de RAM, sem retries/volumes. Instalação/pesos/imports em CPU; inferência sem rede. Uma chamada, não um lote de capítulo. Ao atingir limites/erro do provedor, parar e conferir consumo, sem revezamento automático de contas. Os resultados ficam em `output/audio-driven-motion-probe/`; `qa.json` não presume validação fonética pelo simples fato de receber áudio.

## Conversa de duas vozes

Após aprovação da amostra curta, o [ADR-053](ADR/ADR-053-conversa-humanizada-com-audio-condicionado.md) amplia o teste para quatro tomadas. Reutiliza a fala 07 aprovada e gera somente 06, 08 e 09 com áudio condicionado. Precisa dos mesmos PNGs/áudios locais preservados e do resultado do ADR-052.

```powershell
python scripts/render-story-conversation.py --prepare
python scripts/test_story_motion_contract.py
python scripts/render-story-conversation.py --run --shot 06
# Após conferir a primeira tomada e o app estar parado:
python scripts/render-story-conversation.py --remaining-parallel
node --experimental-strip-types scripts/assemble-story-conversation.mts
python scripts/audit-story-conversation.py
```

O probe compartilhado agora limita cada chamada a 2.100 s. Três novas chamadas, 7.200 s de sessão com reserva, sem retry automático. Checkpoints íntegros são reaproveitados; falha anterior ou arquivo sem checkpoint bloqueiam nova inferência até inspeção. O QA verifica áudio, decode e quadros; não certifica fonemas. Artes/vozes permanecem próprias ou geradas com a proveniência existente. Saídas em `output/audio-driven-conversation/`, sem banco, publicação ou habilitação automática no Studio. Não é um episódio de produção de 60 s.

Resultado de 06/10: conversa de 17,200 s / 60 fps / 1.032 quadros, 704 × 1280. Quatro tomadas, duas vozes, legendas pontuadas por frase, master −15,9 LUFS / peak −1,8 dBFS. Origem de áudio/vídeo zero, timestamps contínuos e áudio sem atraso medido; correlação 0,994924 após normalização. Dez testes locais passaram. Três apps parados/zero tarefas. Worker novo agregado 5.364,549 s, estimativa US$ 6,928 de compute, excluindo build/startup/idle e sem consulta à fatura/saldo. Arquivo: `output/audio-driven-conversation/malu-laranjito-conversa.mp4`; QA e revisão do operador separados.
