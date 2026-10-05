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
