# Auditoria após o primeiro piloto — 14/09/2026

## Resultado e evidência

O projeto tem um MVP funcional para uso pessoal supervisionado. Ainda não é um pipeline completo de operação contínua. Foram inspecionados o renderer, QA editorial, evidências de pesquisa, dossiê Telegram, orquestrador, configuração cloud, workflows, preflight e documentação.

- CI anterior verde em `f290efe`; upload privado concluído no run `34875414664` e nova execução bem-sucedida no run `34875510423`.
- Piloto `c0b93c2a-e31a-4b55-81d8-38b4b231917f`: estado `review`, render 100%, voz Piper. Essa permanência em review é parte do contrato do piloto privado.
- FFprobe remoto mediu o horizontal: H.264 1920×1080, AAC, 33,999 segundos, 2.927.760 bytes. É uma medição técnica; esta auditoria não substitui a avaliação visual/sonora feita pelo operador.
- Configuração consultada: geração pausada, publicação automática desligada, aprovação humana exigida e limite de um episódio diário. A rodada não altera esses controles.

## Quatro eixos

| Eixo | O que funciona | Lacunas / ação |
|---|---|---|
| Arquitetura | Core compartilhado, estados auditáveis, checkpoints, evidências e aprovação vinculada à versão; renderer único local/Actions. | Monitor de trabalhos travados, retenção e analytics ainda não implementados. Orquestrador avança etapas, mas não resolve sozinho toda indisponibilidade persistente. |
| Custo | Sem novo serviço nesta entrega; quotas, limite diário e geração de imagens desabilitada preservados. | Medir tempo/bytes por episódio, ocupação e egress reais. Nova decodificação consome tempo de runner. Não confundir limites internos com garantia permanente do plano gratuito. |
| Segurança | Gate humano, autorização dos workers, segregação de secrets e ledger de upload permanecem. | Bucket público significa vídeos acessíveis a quem tiver URL, mesmo se upload YouTube é privado. Se houver conteúdo confidencial, desenhar URLs assinadas e adaptar snapshot/revisão sem quebrar hashes. Scanner de padrões não substitui gestão de credenciais. |
| Implementação | Piloto completo com revisão e upload privado. QA audiovisual e dossiê melhorado implementados nesta rodada (ADR-025). | Painel web é só um package vazio; TikTok continua manual; publicação pública/Shorts e coleta de analytics não estão concluídas. |

## Melhorias por prioridade

| Prioridade | Melhoria | Critério de conclusão |
|---|---|---|
| P0 — entregue no código | QA dos finais antes de concluir render | Dois formatos íntegros; arquivo sem áudio bloqueado no teste FFmpeg; métricas anexadas à próxima revisão. |
| P1 — parcialmente entregue | Revisão de fontes e alegações | Dossiê agora mostra trechos/provedor e explica limites da confiança. Próxima etapa: selecionar fontes primárias e revisar afirmações sobre sono, saúde e desempenho; vínculo literal a uma URL não verifica o fato. |
| P1 | Ritmo e fidelidade do roteiro visual | Renderer hoje aplica zoom crescente a todas as cenas e concatena com cortes, ignorando `ken_burns` e `transition` declarados. Implementar opções reais com atualização da revisão dos checkpoints e amostras visuais comparativas; calibrar texto para duração desejada. |
| P1 | Operação recuperável | Detectar jobs travados, progresso obsoleto, reservas expiradas e pressão no Storage. Reconciliar Actions antes de repetir; limpeza pela API Storage preservando aprovados e uploads pendentes. |
| P2 | Métricas após publicação | Consultar pelo ID existente; upsert por janela; falha de coleta nunca dispara novo upload. |
| P2 | Identidade editorial e formatos | Definir padrão de capa, abertura, voz, legendas e CTA; roteiro próprio para curto/longo. Imagens stock não devem ser apresentadas como prova do produto específico. |
| P3 | Painel web | Implementar quando Telegram e relatórios deixarem de atender ao uso pessoal; não adicionar infraestrutura apenas por aparência. |

## Verificação e limites

ADR-025 possui testes de metadados, regressão do dossiê e integração FFmpeg com falha induzida. Typecheck e suíte Node passaram localmente. CI deve validar também Deno, SQL/concorrência e Piper no commit enviado. Não foi produzido nem publicado outro vídeo nesta auditoria. O episódio aprovado permanece intacto.

`node scripts/preflight.mjs --production` deve continuar identificando `heartbeat` e `collect-analytics` ausentes. Não relaxar esse critério para declarar o projeto completo. A pesquisa semântica e a qualidade visual continuam exigindo revisão humana.
