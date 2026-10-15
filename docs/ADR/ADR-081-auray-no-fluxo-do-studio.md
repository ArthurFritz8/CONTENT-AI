# ADR-081 — Auray no fluxo de capítulos do Studio

Data: 15/10/2026. Status: integração de painel, roteiro, admissão e retomada implementada. Usa o executor do ADR-080, com ativação independente do Modal.

## Comportamento para o usuário

Na galeria, escolher um exemplo Auray seleciona a fonte e a intenção de usar vozes nativas. Isso ainda não autoriza geração. Depois de criar a proposta ou salvar uma nova versão de preferências, **Configurar Auray** apresenta o exemplo privado, suas limitações, as referências do elenco e a direção vocal de cada personagem. Imagens já cadastradas podem ser reutilizadas. São necessários dois aceites: conferir a amostra e aceitar vozes geradas pelo motor, que podem variar. O servidor também exige esses aceites; habilitar o botão no navegador não contorna a validação.

O servidor confere os bytes e o hash do exemplo autorizado e de cada imagem. Calcula o perfil completo, com API/modelo fixados, sem aceitar hashes ou caminhos fornecidos pelo navegador. O banco verifica fonte, estilo, exemplo revisado, elenco, política de variantes e revisão atual. O perfil é imutável. Um estilo sem exemplo Auray revisado permanece indisponível; não se usa uma amostra 3D para prometer anime ou desenho 2D.

**Gerar capítulo · 15 créditos Auray** cria somente o capítulo escolhido. O roteirista gratuito prepara três falas curtas, mantém a bíblia e os resumos aprovados e salva o rascunho uma vez. O pipeline despacha o worker com o identificador desse episódio. O worker lê o plano congelado, consulta a conta real e exige orçamento integral de 15 créditos no plano Free recorrente e no teto da chave. Somente depois reserva a carteira física e começa as tomadas. Conta, preço ou contrato diferentes fecham o envio. A variável e a carteira de geração Modal não são habilitadas por esse fluxo.

O painel acompanha as três tomadas e mostra **Retomar acompanhamento**. A retomada consulta os mesmos trabalhos, sem criar outras identidades. **Encerrar tentativa** impede novos envios; trabalhos aceitos continuam sujeitos à cobrança. Uma cobrança incerta mantém a reserva. Jobs liquidados são conciliados antes de liberar a carteira, e o comprovante de encerramento fica privado. Uma recusa definitiva conhecida pelo SDK, sem aceitação e sem cobrança observada, pode ser conciliada como zero; um simples 404 de envio incerto não recebe essa exceção. Depois do encerramento conciliado, gerar outra tentativa é uma ação explícita, identificada novamente com o custo de 15 créditos. A tentativa anterior preserva seus jobs e comprovante.

Um vídeo pronto continua disponível para revisão mesmo se a consulta de faturamento falhar temporariamente; a reserva financeira permanece. O workflow agendado recolhe somente pendências financeiras de resultados já montados e encerramentos solicitados. Não cria propostas ou capítulos e não gera novas tomadas nessa recuperação. Respeita a trava de conta compartilhada com o monitor. A consulta de saldo/testes existente continua somente de leitura.

## Retomada, cotas e privacidade

Os prazos de consulta dos jobs e `Retry-After` são persistidos para uma reinicialização não antecipar a próxima consulta. O worker não reduz uma instrução de espera longa para cinco minutos. O despacho normal tem uma janela que evita ações duplicadas; o usuário pode pedir retomada, respeitando o limite de solicitações. Processos encerrados ou antigos não usam a concessão nova.

A carteira mostra créditos, reservas e quantos capítulos mínimos o orçamento consultado comporta. Esse número é estimativa de orçamento, sem margem para refazer cenas ou garantia artística. Não soma dólares Modal com créditos Auray. Saldo vencido ou consulta falha não libera capacidade. Cada capítulo novo passa pela inspeção real, mesmo quando o painel exibe uma estimativa positiva. O saldo anterior é invalidado quando pode haver uma nova cobrança.

Tabelas de preparação, estado, conta e provas financeiras não ficam acessíveis a usuários anônimos ou autenticados diretamente. Rotas do painel conferem sessão, membro e origem. O navegador não recebe a chave Auray nem a chave de serviço. O worker usa os secrets já configurados no Actions; o servidor do painel não precisa receber a chave Auray. Vídeos e referências continuam privados; as prévias são autorizadas por workspace/episódio. Finalização produz `rendered`, seguido da revisão existente. Não concede aprovação de continuidade nem publica em redes sociais.

## Verificação

Testes do banco percorrem cadastro real das referências no contrato de Storage, exemplo privado, perfil com aceite, bloqueio antes de ativação, capítulo com perfil congelado, rascunho, despacho único, reserva, cancelamento, cobrança atrasada e tentativa nova somente após conciliação. Verificam também isolamento, fonte Modal separada e ausência de jobs GPU Modal. As suítes anteriores de estilos e padrões continuam válidas.

O navegador usa as rotas reais de normalização, leitura por hash e finalização com um backend isolado, que rejeita toda saída para provedores. A amostra desse teste contém bytes opacos: verifica transporte/consentimento, não qualidade artística. O teste passa pelos aceites obrigatórios, rejeição de chamada sem aceite no servidor, geração do capítulo, progresso, retomada, encerramento e tela móvel sem overflow. Testes do roteirista e do pipeline simulam os serviços; não usam chaves reais. Testes do executor verificam admissão integral, conta/contrato, retomada, espera persistida e disponibilidade do filme durante falha de faturamento. A montagem FFmpeg com mídia existente já foi validada no ADR-080.

Esta entrega não cria outro vídeo de teste nem usa créditos de vídeo. A conexão é ativada somente depois da migração, das funções, do workflow e do painel estarem implantados e verificados. A primeira nova geração depende do botão do usuário e de um padrão confirmado, com orçamento vigente. A conta consultada antes da implantação tinha 30 créditos gratuitos; isso comportava até dois capítulos mínimos, se não houvesse outros usos ou falhas.

Verificação local: 48 migrações, 22 arquivos de testes SQL, 145 testes core, 83 do executor/renderer, 20 do painel, 90 de funções do servidor e sete cenários de navegador passaram. A migração `20261015020000` foi aplicada transacionalmente com o gate nativo ainda desativado; `generate-script`, `orchestrator` e `studio-story` foram implantadas. O workflow pode ser iniciado sem episódio para consultar somente a lista privada de recuperações, permitindo conferir a conexão com o banco sem criar qualquer geração.
