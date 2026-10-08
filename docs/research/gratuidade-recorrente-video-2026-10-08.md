# Produção automática com gratuidade recorrente

Atualização: o token HF foi configurado e uma nova tomada FlashHead foi produzida e auditada no mesmo dia. Consulte [ADR-067](../ADR/ADR-067-close-gratuito-flashhead-com-hls-e-voz-original.md) e [capacidade gratuita verificável](capacidade-gratuita-novelas-2026-10-08.md). As frases abaixo sobre token ausente e geração ainda não realizada descrevem o estado anterior a esse teste.

Data: 08/10/2026. Decisão explícita do operador: aceitar apenas serviço gratuito ou franquia gratuita renovável. Benefícios de entrada, mesmo com saldo, não compensam e ficam fora. Este documento substitui as prioridades de cadastro/teste do levantamento anterior.

## Seleção vigente

| Rota | Benefício oficial | Classificação e uso atual |
| --- | --- | --- |
| Modal Functions Starter | US$30 de compute por mês | Recorrente; execução de fala já demonstrada, com bloqueio de desembolso. Shared Endpoints não são essa franquia |
| Hugging Face ZeroGPU | Cinco minutos/dia por conta gratuita | Recorrente; I2V demonstrado em prévia. MuseTalk/LatentSync ainda precisam demonstrar fala com o elenco. Endpoints compartilham cota |
| Hugging Face Inference Providers roteado | US$0,10/mês para usuário gratuito, sujeito a mudança | Recorrente, mas pequeno; não há rota de nosso diálogo com custo total e qualidade demonstrados nessa reserva |
| Kaggle GPU | GPU gratuita sujeita a disponibilidade e cota | Candidato para execução em lote; adequação ao modelo e ao uso do projeto ainda pendente. Não habilitado |

Fontes: [Modal](https://modal.com/pricing), [ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu), [Inference Providers](https://huggingface.co/docs/inference-providers/en/pricing), [Kaggle](https://www.kaggle.com/docs/notebooks), [API de notebooks](https://github.com/Kaggle/kaggle-cli).

O crédito mensal do Inference Providers é diferente dos minutos ZeroGPU. Roteamento HF por fal/Replicate/outro provedor usa a mesma carteira mensal HF, não cria crédito por empresa. Usar uma chave própria do provedor perde a aplicação dos créditos HF e muda quem cobra. Saldo, preço do modelo e ausência de cobrança precisam ser verificados antes de qualquer reserva; não foi criada integração ou comprado crédito.

WaveSpeed e Alibaba saem por oferecerem o benefício inicial pesquisado. Lightning sai por não ter reposição gratuita garantida nas condições documentadas atuais. Não pedir suas chaves ao operador como etapa desta seleção. Colab fica fora da produção automática pelas restrições do plano gratuito. Modelo aberto é candidato de implementação, não uma franquia adicional.

## O que uma chave resolve — e o que depende de avaliação

Uma conexão inicial deve permitir ao sistema consultar capacidade, selecionar a rota, preparar entradas, executar, acompanhar, salvar o resultado, aplicar QA e encaminhar para revisão. O cliente usa o navegador; não instala GPU, mantém notebook aberto ou envia comandos a cada vídeo.

Não existe ainda prova de que uma chave habilita produção de capítulos com a qualidade aprovada em todas essas rotas. A cota é por conta do serviço, não por cliente do nosso Studio. Uma chave não aumenta memória, não corrige falhas de modelo e não garante direito de uso de qualquer demo de terceiros.

Dependências externas admissíveis: criação/verificação de conta, autorização inicial e disponibilidade de recurso elegível. Operação repetitiva deve ser automática após integração demonstrada. No ZeroGPU, a franquia reinicia 24h após o primeiro uso; hospedar Space próprio exige conta elegível, e-mail verificado e idade mínima documentada. Nada disso é solicitado a cada vídeo.

Nesta rodada foi conferida somente a presença da variável `HF_TOKEN` em `.env.cloud`: ela não está configurada. Nenhum valor secreto foi registrado. O próximo pré-requisito de autenticação é configurar essa variável com um token da conta Hugging Face autorizada, com permissões necessárias para os Spaces escolhidos. Não usar uma chave de outro provedor para presumir mais cota HF. [Tokens](https://huggingface.co/docs/hub/security-tokens), [API de Spaces](https://huggingface.co/docs/hub/spaces-api-endpoints).

## Regra implementada nesta rodada

Isto já existe em `packages/core/src/stories/video-routing.ts`: escolha por qualidade, tipo de tomada, saldo, reserva, validade e grupo de cota. Foi acrescentada a classificação obrigatória `free_tier`, sem novo roteador:

- `recurring`: franquia gratuita renovável, com evidência.
- `permanent`: serviço de uso gratuito comprovado; não significa garantia de existir para sempre.
- `trial`: crédito inicial ou teste temporário, recusado com `non_recurring_offer`.
- `unknown`: gratuidade não demonstrada, recusada com `unverified_free_access`.

Ausência do campo em um snapshot antigo também é recusada, impedindo que saldo em cache seja interpretado como benefício permanente. `cash_cost=0` continua obrigatório; o novo campo não autoriza pós-pago, saldo desconhecido de créditos ou cota esgotada.

I2V e MuseTalk ZeroGPU são classificados como recorrentes. S2V patrocinado, hospedado em CPU e dependente de backend do proprietário, fica como desconhecido: endpoint ativo não comprova gratuidade renovável. Novos envios pelo avaliador ficam bloqueados; recuperação de trabalhos já aceitos e cache continuam possíveis. Não alterar locks, reservas ou fingerprints para forçar nova tentativa.

## Caminho de integração ainda necessário

1. Autenticar a conta HF no ambiente autorizado e verificar a capacidade real, sem gerar vídeo nesta etapa.
2. Avaliar uma fala curta com imagem, voz e atuação próprias em uma rota de lipsync elegível; guardar os mesmos parâmetros e conferir todos os frames. O I2V atual é uma prévia, não uma substituição de qualidade do master.
3. Se aprovado, integrar o adaptador ao contrato de tomadas e à fila. Implementar consulta/reserva da capacidade e retomada do mesmo job; não deduzir contagem de vídeos de uma cota desconhecida.
4. Demonstrar disponibilidade e fluxo remoto antes de habilitar capítulos animados no Studio. Kaggle exige avaliação separada de kernels, GPU/memória, cota e adequação de uso antes de ser alternativa automática.
5. Quando todas as rotas gratuitas compatíveis estiverem esgotadas, informar espera no painel e retomar somente com capacidade novamente confirmada. Não comprar crédito nem degradar o estilo silenciosamente.

O encadeamento acima é plano, não uma funcionalidade em produção já validada. Toda publicação continua sujeita à aprovação humana anteriormente estabelecida.

## Validação efetiva

125 testes do core e 41 do renderer passaram, incluindo recusa de créditos introdutórios com saldo disponível, metadados ausentes/desconhecidos, preservação do bloqueio de cobrança e S2V patrocinado bloqueado antes da geração. Os dois typechecks passaram. Os testes de renderer incluem composição FFmpeg real, sem GPU remota.

Nenhuma nova chamada de geração, consumo Modal, cadastro, episódio, alteração de banco, Telegram, publicação, deploy ou CI remoto nesta rodada. A política foi implementada localmente; os novos serviços de geração não foram habilitados.
