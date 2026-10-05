# ADR-048 — Prova isolada de render na Modal

Data: 2026-10-05. Status: prova técnica concluída; integração de produção pendente.

## O — Objetivo

Validar a rota remota do [ADR-047](ADR-047-producao-nuvem-e-computador-opcional.md) com a cena própria do experimento 3D, antes de implementar dispatch de episódios. Não condicionar a execução futura ao hardware do cliente nem alterar a direção artística do ADR-046.

## C — Contexto

O operador criou a conta Starter, comprovou no painel US$ 30 de crédito mensal de compute, limite de utilização de US$ 30 e limite de gastos de US$ 0. A autenticação confirmou o workspace `arthurfritz8`. Créditos extras solicitados continuam sem confirmação e não são considerados disponíveis.

O código atual não contém executor Modal. O renderer de episódios continua baseado em imagens e zoompan. A cena do teste é propriedade do sistema, com personagens geométricos básicos; não representa a qualidade humanizada exigida pelo operador.

A primeira execução sofreu espera real por capacidade L4. Os 27 quadros e a montagem completaram, mas o resultado combinado falhou com `AuthError 401` no `BlobCreate` interno do runtime, sob restrição de acesso à API Modal. A versão inicial do exemplo oficial (bpy 4.5.0) também emitiu aviso ao ler a cena salva em 4.5.14. Esses problemas exigiram correção; não se classificou a primeira tentativa como prova concluída.

## S — Solução

Criar `scripts/modal-render-probe.py` como experimento explicitamente opt-in, sem acesso ao banco, episódios ou publicação. Receber apenas o `.blend` próprio e áudio existente, com limites de tamanho, e devolver um MP4 curto, quatro imagens e relatório de tempos/QA.

Usar Blender 4.5.14, CUDA e uma única GPU, com preferência L4 e A10 como alternativa de disponibilidade. Manter máximo de um contêiner, CPU limitada a 2 cores, memória a 4 GiB, timeout de execução de 180 s, nenhum contêiner permanentemente ativo, nenhuma repetição automática e nenhum volume persistente. A escolha de GPU não muda os personagens, o roteiro ou o engine.

Manter `restrict_modal_access=True`, `block_network=True`, contêiner de uso único e scripts embutidos da cena desativados. Transmitir resultados inline em blocos de 128 KiB, sem a chamada interna de upload de grandes blobs. Validar manifestos, nomes permitidos, sequência, tamanho e SHA-256 antes de gravar localmente. Funções geradoras do SDK não aceitam configuração de retry.

As credenciais administrativas ficam somente no `.env.cloud` ignorado pelo Git; não criar perfil global, não injetar segredos do banco no worker e não transmitir o arquivo de ambiente. O procedimento está em [Modal — operador](../modal-operator.md).

### Resultado medido

Execução `ap-Y74GvZiIp2p05FnJ3UPns2`: Blender 4.5.14 LTS / Cycles / CUDA em NVIDIA A10; 24 quadros consecutivos e 3 quadros adicionais de outras tomadas. MP4 de 1 s, 540 × 960, 24 fps, H.264/AAC, 109.358 bytes. Worker: 113,53 s; cliente incluindo preparação/transporte: 140,194 s. Os 24 quadros decodificados são distintos. As quatro imagens foram recebidas e inspecionadas: personagens, cenário e tomadas existem, com o estilo geométrico anterior, ainda abaixo do alvo humanizado.

Manifestos, sequência, tamanho e SHA-256 passaram. Decodificação completa passou tanto no worker quanto localmente. O retorno em blocos funcionou mantendo as restrições da função. O custo faturado e o saldo restante não foram consultados; não confundir esses tempos com medição de consumo contabilizado. Não foi feita comparação controlada de desempenho com o computador local.

## P — Prevenção e validação

- Não inferir capacidade de novelas Full HD a partir de um trecho de 1 s / 540 × 960 / 16 amostras. O contrato de 60 s permanece intacto.
- Não inferir melhora artística a partir de disponibilidade de GPU. Figurino, cabelo, rig, atuação e cenário do ADR-046 ainda precisam de desenvolvimento.
- Não afirmar equivalência entre a amostra local EEVEE e o teste remoto Cycles; uma comparação de hosts deve congelar versões, engine, qualidade e demais parâmetros.
- Não classificar logs de quadros como aprovação do transporte, montagem ou QA; exigir arquivos recebidos íntegros, codecs/duração/resolução conferidos, decodificação completa e inspeção visual.
- Não tratar timeout de processamento como limite de espera por capacidade ou de construção da imagem. A produção exigirá supervisão durável, prazo total, cancelamento e progresso real.
- Não remover os bloqueios de gastos/acesso para contornar falhas. Medir consumo contabilizado no painel; tempo do worker não mede toda a cobrança.
- Não usar o crédito compartilhado como promessa de US$ 30 para cada cliente. Integrar reserva global e por workspace antes de liberar produção.
- Não aceitar `.blend` arbitrário de clientes com base na segurança limitada deste experimento. Necessário executor isolado e pacote controlado pelo sistema.
- Não alterar a fila, consumir candidato, gerar episódio, enviar revisão ou publicar durante esta prova.

Fontes: [exemplo Blender da Modal](https://modal.com/docs/examples/blender_video), [limites](https://modal.com/docs/guide/budgets), [funções restritas](https://modal.com/docs/guide/restricted-access), [API de App](https://modal.com/docs/sdk/py/latest/App).
