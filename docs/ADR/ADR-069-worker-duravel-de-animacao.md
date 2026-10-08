# ADR-069 — Motor genérico e worker durável de animação

Data: 08/10/2026. Estado: código implementado e validado localmente; **sem deploy, ativação de carteira ou inferência de GPU**. Complementa [ADR-068](ADR-068-criacao-automatica-e-reserva-de-video.md) e a revisão 2 do [plano de novelas](../plano-novelas-animadas-2026-10-08.md).

## Entrega

O motor Wan S2V + RIFE saiu do script de audição para `scripts/story_video_engine.py`. Mantém os mesmos pesos/revisões, sampler, 40 etapas, primeira imagem, áudio condicionado, 16 FPS nativos e interpolação neural para 60 FPS. O script antigo delega a computação ao motor compartilhado e conserva suas restrições de personagens/gestos e referências aprovadas. Os testes não viraram um serviço com personagens fixos.

A camada de pesos/build fica antes das camadas de direção e validação na imagem. Assim, uma mudança no fluxo de inputs não exige invalidar novamente o download de todos os pesos; o cache depende da disponibilidade do Modal. Isso não remove o tempo de carregar o modelo na GPU nem foi medido remotamente nesta etapa.

O contrato genérico verifica PNG real, hash, dimensões, PCM mono/16 kHz, truncamento e cobertura antes de importar bibliotecas de GPU. A primeira implantação preparada aceita somente diálogo vertical com 64 frames e fala de até 3,9375 segundos. Não habilita ação, reação, outro hardware, 80 frames ou resolução superior só porque o roteador genérico aceita esses casos.

`modal-story-worker.py` define duas funções: GPU isolada de rede/recursos Modal, recebendo apenas imagem, áudio e direção; e transporte em CPU, recebendo permissões temporárias para uma tarefa e três objetos privados. Ambas escalam a zero. O transporte consome o stream limitado, verifica manifests/hashes, decodifica MP4 e mede resolução, frames e duração de áudio antes do upload. RIFE cria frames intermediários; 60 FPS de saída não são 60 frames nativos gerados por segundo.

O fingerprint da execução inclui fontes normalizadas do engine, contrato, imagem e recursos. O runner e a implantação precisam concordar; uma mudança exige nova aprovação de compatibilidade para a série. Perfis incompletos, referência não cadastrada, identidade alterada, fala maior que a tomada ou formato incompatível são recusados antes do claim.

## Fila, transporte e retomada

`run-story-video-worker.py` conecta tarefas já reservadas no banco à função `deliver.spawn()`. O workflow `story-video.yml` permite submeter/consultar uma tarefa durável e mantém concorrência por ID. **Ele nasce desativado**: exige runner autorizado e `CONTENT_AI_VIDEO_DISPATCH_ENABLED=true`. Não cria saldos, homologações ou planos de produção.

O banco registra o hash de uma capacidade aleatória, vinculada ao lease, tarefa, destino privado e validade. O callback `studio-video-worker` autentica essa capacidade; desativa JWT do gateway somente para esse endpoint, valida tamanho/schema e mantém todas as tabelas/RPCs inacessíveis ao navegador. A credencial service-role permanece no runner/Edge e não é enviada ao Modal. Uploads assinados são sem sobrescrita; destinos derivados pelo servidor impedem que a tarefa escolha outro workspace.

Inputs, configuração de execução, vínculo da tarefa e valor reservado ficam imutáveis no banco; não podem mudar entre preflight, claim e início remoto. Atualizações de estado/cobrança permanecem separadas desse contrato.

Antes de chamar GPU, o relay solicita `begin_video_worker`: o banco revalida saldo/compatibilidade/roteiro e registra um único início. Se o processo CPU for repetido, ele não inicia outra chamada GPU. Falha ambígua de `spawn` conserva a reserva. O callback pode registrar o ID externo antes que o runner receba a resposta; o aceite posterior é idempotente. Uma resposta incerta tardia não apaga o ID já conhecido nem substitui um aceite confirmado.

Na conclusão, o Edge baixa **ambos** os arquivos privados e verifica seus tamanhos/hashes. Só então `complete_video_worker` marca o clipe concluído e persiste relatório. A reserva continua até a cobrança ser conciliada. O relatório exige revisão humana e não afirma que o lipsync foi aprovado. A conclusão do clipe não promove o episódio a assets, não aprova nem publica.

A retomada consulta o mesmo FunctionCall ou recupera receipt/MP4 já armazenados, verificando contrato, checksums e decodificação. Uma recuperação tardia usa a RPC somente pelo service-role; o callback público não pode desativar a expiração da capacidade. Se faltam dados para confirmar o resultado, o job fica para conciliação, sem nova inferência automática.

Há um limite importante: a trava de início evita repetir a **submissão da GPU pelo relay**, mas não oferece garantia de execução exatamente uma vez dentro da infraestrutura Modal. Reinícios/preempções e a recuperação de uma tentativa que falhou exigem tratamento de custo do provedor; não se libera orçamento por timeout nem se promete teto financeiro apenas pelo timeout da função. A documentação diferencia [spawn e consulta durável](https://modal.com/docs/guide/function-invocation-methods), [falhas da infraestrutura](https://modal.com/docs/guide/functions) e [timeout por tentativa](https://modal.com/docs/guide/timeouts). A API de FunctionCall retém resultados por [até sete dias](https://modal.com/docs/guide/job-queue); os objetos privados do Studio preservam a recuperação além desse prazo, enquanto disponíveis.

## Verificação

- 15 testes novos de worker offline, incluindo FFmpeg real com arquivos sintéticos: contrato genérico, import das definições Modal, truncamento, desvio de qualidade, stream corrupto, destinos, conclusão, falha de transporte, retomada, falta de saldo e incerteza de spawn. Nenhum teste usa token ou GPU. As imagens/vídeos sintéticos servem para transporte, não para homologação visual.
- 27 testes existentes de movimento/reuso passaram após a extração; referências e contratos dos testes aprovados foram preservados.
- Typecheck de todos os entrypoints Edge e 78 testes Edge passaram, incluindo sete novos de capacidade restrita, expiração, body limitado, armazenamento corrompido e tentativa de recuperação privilegiada pelo callback público.
- PostgreSQL 18 isolado: todas as migrations, seed, verificação, histórias, reservas e ciclo do worker passaram. Doze clientes simultâneos mantiveram as três reservas previstas na carteira compartilhada. Outros doze concorrentes disputaram o mesmo início: um recebeu `started`, onze `already_started`.
- Typecheck do renderer passou. A montagem existente não foi alterada nesta etapa.

## Pendências da integração completa

Este worker ainda não está implantado no Modal/Supabase e o workflow não foi publicado/ativado. Importar/validar definições não testa rede, build de imagem ou execução remota. O fluxo do painel permanece explicitamente ilustrado; não há promessa de animação ao clicar nele.

Faltam planejamento/áudio por tomada, cadastro e persistência do elenco aprovado, montagem curta com FPS do perfil, promoção segura de assets, correção por cena, observador/conciliação real de carteira, orçamento de CPU/build/transferência e infraestrutura, progresso no painel e ativação do caminho completo. A migração de identidade para outra fonte continua sujeita à aprovação audiovisual da série. A segunda fonte permanece pendente.

Não foi debitado nenhum crédito de vídeo nesta etapa. O saldo conservador anotado na ADR-068 continua sendo uma consulta histórica; não foi transformado em carteira produtiva habilitada.
