# ADR-099 - Validacao de capitulo HQ e runtime TTS

Data: 20/10/2026. Estado: validacao ponta a ponta autorizada; publicacao nao autorizada.

## Objetivo

Produzir uma historia HQ nova de um capitulo, separada da novela 3D, com vozes
explicitamente escolhidas e revisao humana antes de qualquer publicacao.

## Contexto

O adaptador de voz local, com edge-tts 7.2.8 instalado, falhou com HTTP 403 no
handshake antes de receber audio. Nao houve geracao de video nessa falha. O
workflow de assets usava a mesma versao e precisava ser validado antes do teste.

O release oficial 7.3.1, publicado no PyPI em 13/10/2026, inclui atualizacoes do
protocolo e correcao de parsing da data do servidor. Foi testado isoladamente,
com hash do wheel verificado, sem modificar a instalacao global. As mesmas
vozes Francisca e Antonio produziram audio com sucesso usando o adaptador
existente. Isso comprova o teste observado, nao disponibilidade futura garantida.

## Solucao

Atualizar somente o pin edge-tts do workflow `assets.yml` de 7.2.8 para 7.3.1.
Nao trocar voz, provedor, endpoint proprio ou desabilitar TLS. Outros fluxos
de perfil congelado e geracao nativa nao mudam nesta entrega.

Foram criadas duas amostras em `output/hq-full-chapter-validation/voices/`.
O usuario confirmou explicitamente "Usar Francisca e Antonio": Francisca para
Lia e Antonio para Bento. As vozes sao sinteticas, sem clonagem. A historia HQ
usa um novo elenco/contexto; nenhuma referencia ou voz do 3D e substituida.

O capitulo deve seguir os mesmos contratos e operacoes do painel: proposta,
escolha HQ/local, aceite de voz, pauta, pesquisa ficcional, roteiro, assets,
render e revisao. Nao criar reserva Puter, nao mudar flags de automacao ou
aprovar/publicar o video automaticamente. Usar cota gratuita e limites existentes.

## Prevencao

- Falha 403 reproduzida no runtime anterior; nenhuma troca silenciosa de motor.
- Versao e artefato conferidos no PyPI oficial; teste isolado com as duas vozes.
- Confirmacao humana das amostras antes de iniciar o capitulo.
- CI e verificacoes do workflow antes de qualquer dispatch de assets.
- Respostas e logs nao devem expor tokens ou parametros privados do WebSocket.
- Midias e checkpoints permanecem fora do Git.

## Fontes

- https://github.com/rany2/edge-tts/releases/tag/7.3.1
- https://github.com/rany2/edge-tts/releases/tag/7.3.0
- https://pypi.org/project/edge-tts/7.3.1/

## Limites

O Edge TTS depende de servico online e pode ficar indisponivel. Um teste de voz
ou video renderizado nao e aprovacao artistica nem autorizacao de publicacao.
Falha no fluxo deve preservar o trabalho e ser reportada; nao substituir HQ por
3D, voz por outro motor, nem consumir creditos de video como recuperacao.

## Roteiro Durante a Validacao

A primeira geracao de roteiro foi recusada antes dos assets: o listener da
reacao era o proprio falante ou nao estava em on_stage. A validacao nao foi
afrouxada. O prompt recebeu exemplos exatos com IDs do elenco real e a regra
de listener/reaction nulos em cenas com um unico personagem. Testes mantem
a recusa de reacao a si mesmo e de personagem ausente. O episodio reprovado
e seus eventos permanecem auditaveis; nao e uma tentativa de video incerta.