# ADR-070 — Planejamento vinculado e montagem de capítulos animados

Data: 08/10/2026. Estado: implementado e testado localmente, **sem implantação ou geração remota**. Complementa [ADR-069](ADR-069-worker-duravel-de-animacao.md).

## Comportamento implementado

O formato inicial de produção tem 5–8 tomadas verticais de diálogo, 704×1280, 64 frames nativos a 16 FPS e 237 frames de saída a 60 FPS por tomada. Um capítulo tem 19,75–31,60 segundos. O aumento de FPS vem da interpolação do motor; não significa 60 poses nativas por segundo. A fala deve caber nos 3,9375 segundos de cobertura nativa.

`planAnimatedChapter` compila um roteiro curto somente com referência cadastrada para quem fala, voz versionada correspondente ao perfil, SHA do PCM e duração medida. Não estima a duração da fala por quantidade de palavras. Cada cena recebe o vínculo persistente da tomada. `shotsFromAnimatedScript` reconstrói exatamente as submissões; orçamento e reserva devem usar esses inputs, não um texto livre do navegador.

A extensão do schema é exclusiva de `fiction.animation`: conserva o mínimo de 60 segundos e as cenas de pelo menos 5 segundos dos vídeos factuais e ilustrados. Não aceita imagem como substituição de tomada, movimento Ken Burns, pausas artificiais ou CTA alternativo que exigiria outro áudio. A última tomada pode encerrar a história/pergunta; não adiciona uma fala de narrador fora do orçamento. A revisão editorial fica versionada em 1.3.0 e continua aplicando os demais controles e revisão humana.

A reserva exige todas as tomadas do capítulo e confere as identidades antes de reter unidades. O runner compara ainda o áudio PCM real com o tempo declarado e a voz/referência do personagem antes do claim ou alocação de GPU. O transporte existente continua verificando os arquivos completos.

`mount_animated_chapter` promove o episódio de script para assets somente depois de todas as tarefas concluírem com os mesmos inputs, execução, perfil, roteiro e relatório. Persiste cinco a oito clipes e seus PCM originais no bucket privado. Uma falha/resultado incerto pede conciliação; não aciona ilustrações ou outra fonte. Mount repetido não duplica assets.

O tick do pipeline aguarda os clipes e faz o mount; a montagem usa o workflow CPU `render.yml` existente. O novo caminho do renderer faz hash de cada MP4 e PCM, mede resolução, FPS, frames e áudio e concatena os cortes usando o PCM original. Completa apenas o áudio com silêncio até o fim da tomada; não repete fala, não estica áudio, não congela/reproduz vídeo em loop. As legendas são incorporadas em uma única passagem H.264 CRF 18. Essa codificação tem perda, embora evite uma segunda passagem e mantenha os quadros; não equivale a uma exportação sem perda.

Legendas usam alinhamento proporcional na ausência de boundaries; não se promete alinhamento palavra a palavra perfeito. A saída recebe contagem integral de frames, verificação da duração audiovisual e decode completo. Lipsync e qualidade artística continuam sujeitos à revisão humana.

A montagem tem lease exclusivo de CPU e rejeita um resultado se o roteiro mudar durante a execução. Uma nova montagem reutiliza os mesmos clipes e não chama GPU. O estado final é rendered; o fluxo normal solicita revisão, sem aprovar/publicar automaticamente nem liberar reservas de cobrança pendente. O primeiro formato exporta apenas vertical, sem inventar uma segunda orientação.

O painel exibe o progresso real de tomadas quando houver registros. Segundos planejados do capítulo não são apresentados como saldo de produção futura. Séries com perfil animado ficam bloqueadas na criação ilustrada: next/retry e o roteirista convencional não podem degradar silenciosamente a identidade. Esse bloqueio é temporário até a ligação do planejador ao preparo automático de fala e orçamento.

## Verificação

- Core: planejamento, duração curta isolada, identidade/hash, voz ou referência divergentes, falta/excesso de áudio e impossibilidade de preencher com imagens.
- FFmpeg real: capítulo sintético de 19,75 s e 1.185 frames a 60 FPS; alternância de tons confirma áudio correto em cada corte e silêncio no restante da tomada. Arquivo ausente/alterado e PCM corrompido são recusados. Isso testa a montagem e transporte, não qualidade artística de inferência.
- PostgreSQL isolado: migrations, reservas anteriores e ciclo do worker, mount completo/idempotente, reserva parcial recusada, lease concorrente, conclusão com FPS errado, edição durante montagem, autorização e progresso por workspace.
- Typechecks de core/renderer/Edge, build e testes do painel; regressões de publicação/revisão e dos modos existentes.
- Nenhuma chamada de GPU, build Modal, débito de créditos, publicação ou envio externo nesta etapa.

## Ainda necessário para produção pelo painel

O planejador é chamado por código e recebe PCM preparado; o botão do usuário ainda não prepara automaticamente referências, áudio, orçamento e submissões. Não há cadastro visual do perfil, correção por cena, observador confiável do saldo Modal, estimativa produtiva efetiva, dispatcher do capítulo completo, implantação das migrations/workers ou segunda fonte homologada. As tabelas/workflows não criam capacidade por si mesmos. A GPU permanece desativada até o saldo, orçamento e padrão serem confirmados.

Aplicar as três migrations de vídeo de 08/10 antes das versões novas do roteirista/assets/pipeline: a ausência da tabela de perfis gera erro explícito, em vez de produzir ilustrações para uma série cujo padrão não pôde ser consultado. Implantar não foi realizado nesta etapa.
