# ADR-079 — Padrões visuais ligados à execução de cada capítulo

Data: 14/10/2026. Status: implementado; disponibilidade das fontes continua independente da confirmação de um padrão.

## Problema e comportamento

A galeria salvava preferências por capítulo, mas o roteirista, a preparação de fala e o worker ainda procuravam um único perfil por novela. Uma novela com mais de um padrão poderia falhar na consulta ou usar a aparência errada ao retomar um capítulo. O perfil deve ser escolhido no início do capítulo e permanecer estável em todas as etapas, inclusive depois de novas preferências serem salvas.

`studio_story_patterns` associa versão de preferências e estilo a um perfil imutável de referências e vozes. Uma novela pode ter vários perfis, identificados pelo hash do conteúdo. `studio_chapter_productions` congela o perfil no capítulo enfileirado. O resolvedor `studio_story_episode_profile` usa essa associação; não procura o perfil mais recente. Capítulos ilustrados escolhidos explicitamente retornam sem perfil animado, mesmo se a novela possuir outros padrões. Identidades anteriores permanecem marcadas como legadas e continuam resolvendo seus capítulos antigos.

Roteirista, preparação e montagem usam o perfil congelado. O worker filtra também pelo hash do job antes de verificar imagem e WAV. Salvar um rascunho ou reservar GPU com outro perfil é rejeitado. Uma fonte Modal fixada rejeita um plano que tente usar outro fornecedor. A reserva completa, os checkpoints de áudio, os contratos de quadros e a recuperação de jobs existentes permanecem em vigor.

## Configuração para o usuário

Nas fontes automática/Modal, estilos 3D, desenho 2D, anime e realista podem cadastrar e confirmar imagens e amostras de voz para a versão de preferências escolhida. O preparo usa o adaptador de vídeo condicionado por áudio já existente, com referências do estilo; não introduz um renderizador próprio de desenho/anime. Cada estilo continua precisando de validação de execução e orçamento. HQ e a geração de capítulos Auray não recebem uma implementação fictícia por compartilharem o catálogo.

O usuário pode preparar o próximo padrão depois de concluir e aprovar o capítulo atual. Uma confirmação repetida do mesmo perfil é idempotente; tentar substituir o perfil já fixado falha. A política de preservar vozes compara as amostras e os parâmetros com o último capítulo animado, ou com o padrão inicial quando ainda não há capítulo. Outra versão de voz exige que a política permita variantes e que as novas amostras sejam conferidas explicitamente. O conjunto atual continua limitado às vozes Edge cadastradas, sem clonagem ou substituição por fala nativa Auray.

A voz anteriormente aprovada vem pré-selecionada. Quando há mais de uma amostra do personagem, o usuário pode selecionar e ouvir cada uma; confirmar outra amostra continua sujeito à política da novela. A migração incremental `20261014040000` acrescenta essa seleção ao view, sem reescrever a migração `20261014030000` já aplicada.

Imagens e vozes existentes podem ser reutilizadas. Novos uploads mantêm limites, hash, isolamento por workspace e bytes imutáveis. A geração de amostras de voz reaproveita as prontas, mesmo ao preparar um padrão após capítulos anteriores. A confirmação não concede compatibilidade à fonte e não cria jobs GPU. Preferências alteradas em outra aba e capítulos em andamento impedem salvar o padrão errado.

O painel conserva a tela de criação ao atualizar a mesma lista. Antes, uma atualização desmontava o formulário e retornava ao tipo de conteúdo inicial. A leitura de RPC também aceita HTTP 204 para funções `void`; um upload concluído não passa a ser exibido como falha por ausência de JSON.

## Verificação e limites

Banco novo com todas as migrações e suítes: três capítulos 3D → anime → ilustrado, perfis independentes, continuidade da bíblia, voz preservada, idempotência, fonte fixada, tentativa de trocar perfil durante reserva e privacidade. Testes de áudio com FFmpeg real retomam apenas as falas ausentes. O teste do worker apresenta dois perfis da mesma novela e exige o correto. O teste autenticado do navegador percorre imagens reais normalizadas, amostras PCM locais, resposta 204, confirmação do padrão e atualização da tela, sem saída para serviços de geração.

Não foram gerados vídeos nem gastos créditos nesta entrega. Preparo animado e carteiras de produção permanecem desativados na implantação inicial. A integração completa de capítulos Auray, a homologação das fontes com padrões novos, o renderizador próprio 2D/HQ e as fontes adicionais de imagens são etapas restantes. Aprovar referências ou escolher um estilo não comprova estabilidade artística do motor em um capítulo completo.

As duas migrações foram aplicadas transacionalmente no servidor e seus hashes conferidos contra o histórico remoto. `generate-script` foi implantada com o resolvedor por capítulo. As verificações estruturais completas passaram no banco remoto: dois exemplos privados preservados, nenhum padrão criado artificialmente, nenhuma carteira habilitada e nenhum job GPU. Recibos locais privados em `.audit-tmp/story-patterns-schema-deployment.json`, `.audit-tmp/story-pattern-voice-selection-schema-deployment.json` e `.audit-tmp/story-patterns-live-verification.json`.
