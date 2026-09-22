# ADR-037 — Estratégia de crescimento orgânico por plataforma

## Objetivo

Crescer com gadgets úteis, compartilhando pesquisa e corpo do vídeo, com encerramento orgânico no TikTok e conversão no YouTube somente quando existir link afiliado validado.

## Contexto

ADR-034/035 já alimentam candidatos com Amazon como sinal primário; ADR-036 separa links por destino. Alterar apenas a descrição não muda o áudio comercial compartilhado. Baixa prioridade também não impedia o consumidor da fila de produzir candidatos ainda não validados.

A [política de criadores TikTok Shop Brasil](https://seller-br.tiktok.com/university/essay?knowledge_id=1396756526679824) lista ao menos 1.000 seguidores e requisitos adicionais de elegibilidade; a conta de criador individual não deve ser confundida com aprovação de desenvolvedor no Partner Center. O operador quer TikTok orgânico nesta fase e YouTube com programa afiliado validado. Não se presume aprovação em nenhum programa.

O publicador existente faz upload horizontal privado. Não há agendamento público de Shorts/TikTok ou coleta de analytics implementada. Retenção exige Studio/Analytics API, não apenas YouTube Data API.

## Solução

1. Centralizar templates de CTA, disclosure, expressões comerciais bloqueadas, briefings, calendário e metas de acompanhamento em `system_config.growth_strategy`. A migration insere defaults sem sobrescrever configuração existente. Política ausente mantém compatibilidade legada; política inválida interrompe nova geração antes de gastar quota. `enabled` deve ser `true`: `false` falha fechado, não reativa silenciosamente vendas no TikTok.
2. Acrescentar `script_json.platform_ctas` opcional. Novos roteiros usam corpo e visuais editoriais compartilhados; o sistema define os dois encerramentos. YouTube só recebe conversão/disclosure quando há link `youtube` validado; TikTok sempre recebe engajamento e não ganha link/disclosure de afiliado. Conteúdo realmente patrocinado exige divulgação adequada e não deve ser mascarado por esta variante orgânica.
3. Produzir um slot adicional de áudio/legendas para CTA TikTok, com a mesma engine TTS do episódio. O renderer reutiliza o corpo vertical e concatena o encerramento específico. Preserva saídas legadas e registra `render_outputs.platforms.youtube/tiktok`, incluindo QA técnico. Há um pequeno custo adicional de quota gratuita/tempo de runner; todos os budget guards continuam ativos.
4. Incluir CTA no hash editorial e saídas no snapshot de revisão. QA bloqueia frases comerciais/URLs no corpo, visuais e metadados TikTok; revisão exige o arquivo orgânico com relatório técnico válido. Painel e Telegram apresentam os dois CTAs/arquivos. A conferência humana continua necessária para alegações, sinônimos comerciais, direitos, estética e relação com o produto real.
5. Adicionar `idea_queue.validated_at`: o consumidor ignora `trend_discovery` sem validação. A edição autenticada no painel registra validação, revisão e auditoria existentes; a origem permanece para deduplicação. Salvar sem links valida apenas a pauta editorial. Pautas manuais continuam compatíveis; candidatos antigos precisam de validação explícita.
6. Documentar calendário inicial de cinco episódios/semana, duas versões por episódio, horários como hipóteses e agendamento manual em [estratégia de crescimento](../estrategia-crescimento.md). Não ativar produção/publicação nem criar cron de publicação. A configuração de calendário é referência, não execução.
7. Medir manualmente no Studio e relatórios afiliados; marcos de 30/60/90 dias, sem implementar coleta complexa. A meta de seguidores não habilita monetização automaticamente. A transição comercial TikTok exige elegibilidade verificada e novo ADR.

## Prevenção

- Não inventar produtos para completar listas: três produtos exigem três pesquisas; caso contrário, usar usos sustentados pela pesquisa disponível.
- Não comprar seguidores, inflar métricas, copiar mídia sem licença ou publicar spam. Sem scraping, serviços pagos obrigatórios ou retomada do Partner Center.
- Não inferir afiliação de um ranking: fonte descoberta continua candidato, sem `product_url` ou `affiliate_links` automático.
- Mudança de CTA invalida hash/revisão. Áudio orgânico ausente não pode reutilizar por engano o comercial. Falha de QA não conclui render.
- Casos legados preservados. Nenhum episódio aprovado anteriormente é reescrito; regeneração exige nova revisão.
- Testes cobrem geração com/sem link, vazamento comercial, hash e revisão, áudio/legendas adicionais, render FFmpeg real com durações distintas, retomada, consumo SQL de candidatos e regressões existentes.

O caminho de upload YouTube comercial continua conservador: episódio legado ou com apenas link TikTok não ganha link YouTube por fallback. Shorts públicos permanecem operação manual conforme o documento.
