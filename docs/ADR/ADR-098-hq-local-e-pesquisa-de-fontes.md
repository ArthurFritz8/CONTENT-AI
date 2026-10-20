# ADR-098 - HQ local e pesquisa de fontes gratuitas

Data: 20/10/2026. Estado: fluxo HQ local implementado; amostra tecnica para revisao.

## Objetivo

Oferecer um formato local de quadros, camera, narracao e legendas separado da
animacao 3D, e pesquisar acesso gratuito recorrente utilizavel pelo projeto.

## Contexto

O renderer ja usa FFmpeg para cortes, movimento de camera, audio e legendas.
O fluxo ilustrado ja gera arte propria e usa as vozes ilustradas do Studio.
Recriar esses motores ou trocar silenciosamente uma novela Puter seria errado.
O orçamento Puter e limitado; rodizio sem outra fonte homologada nao o aumenta.

## Solucao

HQ exige escolha explicita `motion_comic` + `local` + `preserve`. O contexto do
capitulo congela `local_comic=true` e o roteiro identifica a composicao. SQL,
schema e handlers conferem o vinculo. Nenhum perfil animado existente pode ser
convertido em HQ: o operador deve criar outra proposta nesse caso.

A producao usa o renderer existente com movimentos de camera e cortes. A arte
propria recebe moldura, numero de quadro e balao com texto escapado. Roteiro,
legendas e falas sao preservados; nao existe atuacao corporal ou lipsync.
As novas propostas exigem aceite explicito das vozes ilustradas Francisca e
Antonio. Sao as vozes do fluxo Edge existente, nao clonagem nem promessa de
preservar voz nativa Puter. O TTS depende dessa integracao online; a montagem
e a arte sao locais. Nenhuma cota de video Puter/HF e consumida pelo HQ.

`render-local-comic-preview.mts` produz uma demonstracao inteiramente offline
com dois quadros e camera, reutilizando audio e primeiro frame do arquivo
aprovado de Laranjito. Confere hash, origem local e metadados, decodifica a saida
e guarda manifesto/checkpoint. Nao sintetiza outra fala nem acessa provedores.
E uma composicao HQ sobre imagem aprovada, nao redesenho 2D do personagem.

A amostra tem source=local e review_scope=technical_only. Pode ser vista na
galeria privada, mas nao fica aprovada automaticamente nem altera a novela
3D. Referencias, vozes e roteiro existentes continuam preservados.

## Pesquisa

O relatorio `docs/research/fontes-gratuitas-20261020.md` registra fontes oficiais,
limites, privacidade e diferencas entre site/API. Cloudflare e candidato real
para imagens; Pollinations Classic oferece imagens limitadas e publicas por URL.
A2E nao inclui API no Free; Vidnoz/EaseMate nao demonstraram API gratuita recorrente.
HF Inference Providers Free nao tem creditos; ZeroGPU e outro produto com quota
compartilhada por conta. Nao foi comprovada segunda API pronta para novelas
nativas com voz/identidade nesse padrao. Nao houve cadastro, upgrade ou geracao
externa na pesquisa, nem retomada LTX/CNAPS/Auray.

## Prevencao

Testes de core conferem escolha explicita, ausencia de fallback, marcacao HQ e
escape de texto. SQL verifica admissao, binding congelado, replay, ausencia de
reserva externa e preservacao dos contratos anteriores. Playwright verifica
fonte local e aceite de voz antes de propor, sem chamadas reais a provedores.
CI valida o compositor e handlers. Previas sao verificadas por hash, FFprobe e
decodificacao; nenhuma aprovacao artistica e inferida desses testes tecnicos.

## Limites

Esta entrega disponibiliza o fluxo HQ ilustrado e uma amostra de composicao, nao
um motor de desenho corporal 2D, geracao de novas poses ou lipsync. Imagens novas
por API continuam sujeitas a fonte, quota, licenca e revisao. Publicacao e
continuidade entre capitulos seguem as aprovacoes existentes. A escolha HQ nao
libera o piloto Puter bloqueado e nao altera configuracoes de automacao.