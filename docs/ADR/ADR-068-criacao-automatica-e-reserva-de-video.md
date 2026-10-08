# ADR-068 — Criação automática e base de produção de novelas

Data: 08/10/2026. Estado: primeira etapa implementada e validada localmente. Sem deploy, publicação ou nova inferência de vídeo nesta entrega. Plano completo: [novelas animadas, revisão 2](../plano-novelas-animadas-2026-10-08.md).

## Comportamento entregue

O formulário oferece criação com ideia ou criação automática. O automático aceita premissa vazia e pede ao roteirista título, sinopse, universo, conflito, elenco com aparência/objetivo/papel, relações, arco dos capítulos e desfecho. As novas propostas exigem esses campos; bíblias antigas permanecem legíveis. A criação manual mantém o mínimo de 30 caracteres. Uma proposta não inicia imagens, fala ou animação.

O handler de `studio-story` é importável para testes e mantém autenticação service-only, membership, limites, idempotência e até duas tentativas de texto. O painel apresenta universo, relações e final planejado em detalhes. O contador existente identifica corretamente capacidade de roteiros; não promete animação a partir de chamadas de texto.

O contrato de identidade audiovisual guarda referências, vozes versionadas, estilo, orientação, resolução e FPS de saída. Seu hash canônico não depende do nome da infraestrutura. Para uma tomada de qualidade aprovada, o roteador exige identidade da série e aprovação que corresponda à série, perfil, configuração de execução e tipo de tomada. Uma atualização da configuração invalida a aprovação anterior para fins de seleção. Prévia experimental sem perfil mantém o contrato anterior.

O planejador calcula capacidade conservadora de capítulos completos e segundos novos animados, usando cotações em unidades da própria carteira. Carteiras compartilhadas não são duplicadas; fontes incompatíveis, dados vencidos, cotações pagas/ambíguas e capítulos parcialmente financiáveis não aumentam a capacidade. A sequência para no primeiro capítulo que não cabe. O resultado é uma proposta, não uma reserva nem garantia de capacidade máxima ótima.

## Persistência e recuperação

A migration `20261008000000_story_video_production.sql` adiciona carteiras com acesso por workspace, perfil imutável por série, compatibilidades com evidências, pedidos e tarefas persistentes. Carteiras nascem desabilitadas; a migration não cadastra um provedor aprovado nem saldo fictício.

`studio_reserve_video` valida o episódio/roteiro, trava as carteiras em ordem estável e reserva o plano inteiro em uma transação. O identificador do pedido impede duplicação. Reservas usam a mesma carteira entre workspaces. O worker revalida disponibilidade e compatibilidade ao tomar uma tarefa.

Uma tarefa em envio, aceita ou incerta não volta automaticamente à fila de submissão. A reserva permanece mesmo se o vídeo terminar; só uma conciliação explícita de cobrança incluída no saldo a libera. Rejeição significa não aceite confirmado, e não pode liberar um trabalho com identificador externo conhecido. Callbacks de aceite repetidos após conclusão são idempotentes. RPCs de produção e tabelas não ficam acessíveis diretamente ao navegador; RLS é obrigatório.

A API de histórias consulta o resumo de carteiras e perfis autorizado pelo workspace. O painel oferece detalhes de saldo, reserva, disponibilidade e renovação quando houver snapshots reais. Instalações sem a nova migration continuam exibindo ausência de integração. Quantidade de segundos/capítulos permanece desconhecida até haver plano e cotações reais; não se grava capacidade calculada de um teste como saldo de produção.

## Validação executada

- Core: typecheck e 132 testes passaram, incluindo sete cenários novos de concepção, identidade e capacidade.
- Edge: 69 testes existentes passaram; os dois novos testes do handler passaram separadamente. Uma proposta automática completa é salva uma vez, sem chamadas de assets; uma proposta incompleta é recusada após duas tentativas limitadas. Typecheck do entrypoint passou.
- Renderer: typecheck e 45 testes passaram, incluindo FFmpeg real.
- Painel: typecheck, build de produção, nove testes e seis verificações de navegador passaram.
- QA temporário do formulário: Playwright confirmou criação automática sem texto, apenas um POST de proposta, nenhum envio de geração de vídeo e ausência de overflow a 390 px. Captura inspecionada em `.audit-tmp/story-auto-mobile.png`; dados eram fixtures, não saldos reais. Página e teste temporários removidos; build final não os inclui.
- PostgreSQL 18 isolado: migrations aplicadas, verificação, testes de histórias e ciclo de reserva passaram. Doze clientes simultâneos disputaram 30 unidades: exatamente três reservas de 10 foram aceitas; as demais não deixaram reservas parciais. Os testes SQL e concorrentes estão incluídos no CI.
- Verificação de diff e padrões de segredos sem achados. Credenciais não foram versionadas.

Consulta apenas de leitura ao Modal retornou `metered_cost=26.10206004` e `billed_cost=0` no ciclo consultado. Contra a franquia base previamente documentada de US$30, há aproximadamente US$3,90 de margem conservadora. Isso não confirma sozinho créditos adicionais, limites atuais ou saldo aplicável de uma carteira; não foi publicado como snapshot de produção. Nenhuma inferência foi executada.

## O que continua pendente

Esta entrega não conecta o worker Modal ao botão de capítulo animado. Ainda faltam extração do engine genérico, execução assíncrona, transporte restrito, persistência de referências/clipes, consulta/conciliador real das carteiras, cotações medidas por modelo, duração curta, áudio/FPS por perfil, planejamento por tomada, correção por cena, continuidade estruturada e temporadas além do limite atual. A segunda fonte continua candidata, sem nova aprovação de qualidade.

Não disponibilizar controle animado apenas porque a migration foi aplicada. A próxima entrega deve fechar um fluxo completo pelo Studio com inputs reais, retomada, custo registrado e verificação audiovisual. Mudanças externas exigem concluir preparação e validação antes de ativar; esta etapa deixou a execução atual ilustrada em funcionamento.
