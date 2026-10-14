# ADR-077 — Saldo e retomada Auray no Studio

Data: 14/10/2026. Status: implementado; implantação e verificação operacional registradas no relatório de integração.

O usuário aprovou a sequência entre personagens e autorizou integrar a fonte ao Studio. O executor local já tinha checkpoints duráveis, mas o painel não conhecia o saldo nem os trabalhos. A mudança de roupa no bruto masculino permanece observada, e a fonte não recebe autorização de produção por causa da aprovação geral de uma amostra.

## Decisão

Reutilizar `studio_video_wallets` e o controle de acesso por workspace. Uma conta física tem uma carteira identificada por hash, compartilhando a franquia em vez de duplicá-la por novela ou chave. A carteira Auray permanece desativada por trigger; não há compatibilidade de produção criada. Créditos ficam separados de dólares Modal, sem total artificial de capítulos.

O painel apresenta a última consulta, franquia/período, bloqueios e uma comparação de orçamento em tomadas de cinco segundos. Essa comparação usa o menor valor entre saldo Free e limite restante da chave, apenas por cinco minutos e dentro do mês vigente. Não representa qualidade, novas tentativas, duração final de montagem ou capítulos completos. Uma consulta que falha invalida a comparação e preserva o valor histórico. Uma carteira mista, paga, promocional ou não verificável informa capacidade desconhecida. Saldo zero continua zero.

`studio_video_balance_request` autoriza membro/carteira antes de escolher entre os workflows Modal e Auray. Há cooldown de dois minutos por carteira física e lease de quinze minutos no worker Auray. Um callback antigo não pode encerrar a lease atual. A conexão da chave é um secret do Actions, nunca um campo devolvido ao navegador.

Trabalhos Auray já enviados são importados pelo operador a partir de checkpoints locais verificados. Cada identificador externo é imutável e pertence a um workspace. A recuperação usa somente GETs no serviço: consulta o mesmo identificador, espera cobrança liquidada, recolhe o vídeo e valida hash, duração, proporção, quadros e decodificação integral. Upload privado não sobrescreve bytes existentes; resposta incerta é reconciliada por hash. Arquivos prontos não são baixados novamente da Auray. Uma retomada continua possível com saldo zero ou após troca de mês. Trocar a conta interrompe a sincronização.

O workflow faz a consulta por botão e a cada trinta minutos; o agendador do GitHub pode atrasar. Uma falha de download é retomada na próxima consulta, sem chamar o endpoint de geração. Não há retry de uma submissão, compra, recarga ou fallback. Os vídeos ficam no bucket privado e só são entregues por uma rota autenticada que revalida membro, workspace e bytes. Sem URLs assinadas ou identificadores da conta no overview. Downloads de assets podem consumir a franquia de tráfego, não créditos de geração.

## Limite desta entrega

É a integração operacional de saldo, histórico e recuperação dos testes. Ainda não cria novos capítulos Auray pelo Studio. O contrato da novela continua exigindo vozes versionadas, execução aprovada e orçamento do capítulo inteiro. A geração nativa Auray não recebe nosso WAV nem garante uma identidade vocal permanente. Resolver continuidade visual/vocal e implementar o adaptador de capítulos são etapas de produção separadas. Nenhuma avaliação nova é disparada por importação, consulta ou aprovação registrada.

## Verificação

Testes cobrem carteira esgotada, chave mais restrita que o saldo, conta diferente, resposta interrompida, reaproveitamento do mesmo job, mídia modificada, lease concorrente, callback antigo, autorização de workspace, registro idempotente e bloqueio de habilitação. O teste de mídia usa FFmpeg real; testes de API usam respostas controladas e não geram vídeo.
