# ADR-095 - Piloto Puter somente planejamento

Data: 20/10/2026. Estado: preparacao de roteiro; geracao nao autorizada.

## Objetivo

Preparar e enfileirar o capitulo 1 de uma novela Puter existente, com tres cenas,
referencias e escolhas aprovadas, sem gerar midia nem reservar creditos.

## Contexto

A novela "A passagem escondida - teste Puter" ja tem perfil 3D e aceite de vozes
nativas variaveis registrados. As duas referencias existentes foram verificadas
por hash. O contrato permite variacoes de voz; nao certifica identidade vocal.

Porem a flag global Puter ja estava habilitada. Uma preparacao comum em research
poderia entrar na recuperacao e executar. Vetamos criar esse registro sem uma
trava por capitulo; desligar a flag global afetaria trabalhos nao relacionados.

## Solucao

`planning_only` nasce falso para preservar preparacoes existentes. Para um piloto
marcado como planejamento, scheduler e recuperacao o excluem, entrada do worker
o recusa, claim nao revela credencial e guard recusa reserva/submissao. Nao existe
rota publica ou acao no painel para remover essa trava.

`studio_puter_pilot_prepare` e restrita ao servidor, verifica membro, perfil e
versao aprovados, duracao, elenco, falas, capitulo inicial, disponibilidade e
limite diario. Cria pauta consumida, episodio, bindings, preparacao bloqueada e
entrada de fila na mesma transacao. Repeticao com o mesmo request e payload
retorna o mesmo episodio; payload alterado nao e uma nova tentativa.

O helper narrativo legado e reutilizado somente para registrar o primeiro arco:
nao gera ilustracao e a fonte continua explicitamente vinculada ao perfil Puter.
A pauta preserva episodio e consumed_at. Fingerprint usa o mesmo core do worker.

O comando `scripts/prepare-puter-planning-pilot.mts` faz previa por padrao. Le o
plano versionado, confere fonte, vozes, perfil e bytes das referencias privadas.
Usa `prepareNativeDraft` e `nativeFingerprint`, mantendo seeds derivadas das
referencias. `--apply` cria somente o piloto bloqueado e confere que nao existem
runs/jobs. Nunca chama APIs de geracao, saldo, worker ou GitHub dispatch.

A fila exibe as tres falas e "Somente planejamento - execucao bloqueada". O
piloto nao aumenta a estimativa de capitulos executaveis; continua com orcamento
separado e conservador. Nenhum prompt privado ou caminho de midia e exposto.

## Prevencao

Suite SQL prova criacao, replay sem duplicar, ausencia de jobs e holds, exclusao
do scheduler/recuperacao e recusa de entrada, claim e guard. O fluxo legado e
retestado com preparacoes normais. Testes do painel conferem dialogos, capacidade
zero e ausencia de comandos de geracao, incluindo screenshot mobile.
Verificacoes estruturais vetam exposicao dos wrappers anteriores e da RPC.

## Limites

O capitulo continua ocupando uma preparacao e os limites editoriais normais.
Cancelar sua entrada remove a espera, nao autoriza execucao nem desmarca a trava.
Preparar nao gera audio, imagem, video nem publicacao. Consulta separada de saldo
usa a inspecao existente, sem enviar imagens ou solicitar videos. Auray,
LTX e CNAPS permanecem intocados. Preparar nao autoriza consumir creditos; piloto
completo, homologacao artistica e qualquer liberacao de execucao sao outra etapa.

## Correcao do Contexto Editorial

A primeira conferencia real identificou fingerprint divergente: a previa omitia
memoria e orientacoes editoriais que o banco incorpora ao contexto do capitulo.
O comando agora usa o contexto congelado do episodio existente ou inclui a versao
editorial ao preparar o primeiro. Tambem preserva as falas exatas ja orientadas.
Recalcula e confere o fingerprint salvo antes de declarar a preparacao concluida.

`studio_puter_pilot_revise` permite corrigir somente um piloto planning_only do
mesmo ator, ainda em research, sem run/job e com CAS da fila. Atualiza roteiro e
fingerprints da preparacao/fila atomicamente, mantendo todas as travas. Replay
identico nao duplica nem incrementa revisao. Nao e uma retomada de geracao.