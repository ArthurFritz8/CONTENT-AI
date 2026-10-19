# ADR-089 - Avaliacao LTX Sync com quota compartilhada

Data: 19/10/2026. Estado: adaptador de avaliacao implementado; primeira chamada
terminou sem video e nao homologa a fonte.

## Objetivo

Avaliar uma alternativa gratuita com imagem e voz proprias antes de inclui-la
no rodizio de fontes. Rodizio nao multiplica a quota de uma mesma conta nem
autoriza troca de personagem, voz, estilo ou motor de uma novela existente.

## Contexto

Auray foi deixada de lado por orientacao do titular; CNAPS permanece na recusa
original. A pesquisa encontrou `linoyts/LTX-2-3-sync` em ZeroGPU e com API publica
Gradio. Diferente do Space oficial de audio nativo, essa variante aceita WAV
externo. A disponibilidade da API nao prova qualidade nem sucesso de inferencia.

A licenca dos pesos LTX-2.3 consultada e a Community License de 05/01/2026,
publicada no repositorio do modelo. Ela tem condicoes de uso, divulgacao de IA,
limiar de receita e restricao a produtos concorrentes. Esta entrega e avaliacao
privada de personagem ficticio proprio, nao disponibilizacao de uma API/SaaS a
terceiros. A integracao comercial continua sujeita a revisao da versao aplicavel.

## Solucao

O transporte existente recebe o perfil `hf-ltx23-sync`, fixado na revisao
`43260a4dedca79a01fd27adc48314f1c36f51770`. Exige conta HF Free autenticada,
hardware ZeroGPU e ordem publica de parametros conferida antes do envio.
Recusa plano nao confirmado ou Pro, para nao depender de creditos pagos.

Compartilha `quota.json` e o lock da conta HF com os outros Spaces ZeroGPU.
O limite local de duas tentativas por dia nao e a quota externa: nao calcula
videos disponiveis nem renova a franquia do provedor ao alternar o Space.
Reservas, estado e identificador permanecem duraveis; resultados incertos ou
falhos nao autorizam reenviar nem buscar outro fornecedor automaticamente.

O CLI exige `--provider=hf-ltx23-sync --allow-ltx-audition` para um novo teste.
Os vetos de FlashHead, MuseTalk e S2V anteriores permanecem. Sao permitidas apenas
previas, ate cinco segundos, 24 FPS e 576x1024. Nao ha alteracao do pipeline,
banco, carteiras, galeria ou revisao editorial de episodios.

O plano `docs/stories/ltx-sync-dialogue-audition.json` reutiliza o PNG aprovado
da Malu e o WAV original PCM16 mono/16kHz de 3,25 segundos, com hashes conferidos.
Nao gera outra voz, nao fornece video de movimento, nao reescreve o prompt,
nao randomiza a seed e nao interpola, estica ou completa quadros faltantes.

## Resultado real

Conta Free e contrato foram confirmados antes da unica chamada de geracao.
O envio foi aceito em 19/10/2026. A primeira leitura nao correspondeu ao formato
esperado; a retomada do MESMO identificador confirmou `generation_failed`.
Nao foi recebido video para assistir, medir ou aprovar. Nao atribuir a causa
a quota, idioma, licenca ou hardware sem evidencia adicional do processamento.

O checkpoint em `output/free-video-jobs/8d02396adc08e6785e11bc8aced412ca77d08372353d178f006e82cd8204f3c2/`
permanece bloqueado. Nao limpar estado, trocar seed/Space ou repetir a geracao
para contornar esse resultado. Nenhuma chamada Auray, Modal, Puter ou CNAPS foi
feita como fallback. Nao houve publicacao nem consumo de creditos comprados.
O consumo efetivo de GPU da tentativa nao e exposto pela resposta consultada.

## Prevencao

Testes offline cobrem hardware/revisao alterados, conta paga ou ausente,
parametros exatos, imagem e WAV, origem de downloads, SSE fragmentado, saida
nula como falha, bloqueio de master e ausencia de rede sem opt-in. O parser
aceita as duas representacoes Gradio de arquivo sem aceitar URLs externas.
Retomada consulta somente o evento aceito. Os executores produtivos permanecem
inalterados; uma avaliacao falha nao aparece como exemplo aprovado.

Fontes: [Space](https://huggingface.co/spaces/linoyts/LTX-2-3-sync),
[modelo e licenca](https://huggingface.co/Lightricks/LTX-2.3),
[quota ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu).