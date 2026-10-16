# ADR-085 — Prévia Puter aprovada na galeria privada

Data: 16/10/2026. Status: aceito.

O usuário aprovou o primeiro teste Puter da Malu com “ficou bom!”. O arquivo de cinco segundos já existe e sua referência é a mesma usada no piloto aprovado. A galeria deve permitir assistir a essa amostra e identificar o provedor, sem confundir revisão de uma amostra com disponibilidade de um motor de capítulos.

`storyStyleSampleSchema` admite a origem `puter`; seus rótulos ficam em `storySampleSources`. As escolhas de produção em `storySources` e `storyPresentationSchema` permanecem as existentes. A prévia Puter apresenta o player privado e uma indicação de que a criação de capítulos está em preparação. Não tem botão para planejar com uma fonte ainda indisponível.

A migração `20261016040000_puter_reviewed_preview.sql` amplia somente o registro de exemplos para admitir Puter. Mantém o contrato de 16 campos, imutabilidade, idempotência, limite de tamanho, permissões de serviço e isolamento de workspace. Não altera configuração, carteira, permissões de capítulos, apresentação ou perfis da novela existente. Migrações anteriores não são modificadas.

O manifesto acrescenta a amostra `b9eaae6b-657c-5757-b869-1500979a7d51`, com áudio, 720×1280, 30 FPS de entrega e `native_fps: null`. O importador existente verifica hash, tamanho, duração, áudio e decode antes de registrar e enviar os bytes originais ao bucket privado. O token Puter permanece apenas na configuração local ignorada.

A aprovação é editorial e limitada à amostra. A conferência automática de identidade/sincronização continua não comprovada; a transcrição auxiliar divergente é preservada no relatório original. Não há novo teste, inferência, reserva ou publicação. Ver a prévia consome apenas a transferência normal do armazenamento do Studio, sem créditos de geração Puter.

Validação: tipos e build do painel, suítes core/painel, SQL da galeria/perfis nativos e verificação estrutural. Teste de navegador confirma que Puter aparece na galeria, não aparece no seletor de produção e não modifica a fonte escolhida. Após deploy, conferir o hash da mídia privada e o estado inalterado da novela original.

Pendente: adaptador durável de capítulos Puter, monitoramento de saldo, orçamento conservador e perfil próprio para continuidade/vozes. A galeria não resolve esses requisitos nem soma saldos de provedores.
