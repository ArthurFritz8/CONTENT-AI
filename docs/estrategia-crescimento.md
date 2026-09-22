# Crescimento orgânico — gadgets, TikTok e YouTube Shorts

Plano inicial de 22/09/2026. A política operacional fica em `system_config.growth_strategy`; os horários abaixo são hipóteses de teste em `America/Sao_Paulo`, não picos comprovados do público. O objetivo é formar audiência e confiança com conteúdo útil, dentro das quotas gratuitas.

## Conteúdo e monetização por plataforma

| Destino | Conteúdo compartilhado | Encerramento | Link |
|---|---|---|---|
| TikTok | Problema, gadget, demonstração e limitação | Comentário ou salvar; sem venda | Nenhum nesta fase |
| YouTube Shorts | Mesmo corpo editorial | Conversão e disclosure se houver link validado; caso contrário engajamento | Produto correto no perfil do canal |

Amazon Best Sellers é sinal para escolher candidatos, não prova de qualidade, estoque, comissão ou disponibilidade no Brasil. Antes de validar a pauta, confirmar identidade do produto, fontes, direitos dos visuais e, se comercial, o link especial no programa de afiliados. Não fingir teste pessoal nem mostrar stock como se fosse o produto real. Publicidade, patrocínio ou benefício recebido exige divulgação adequada: não usar a versão orgânica para ocultar uma relação comercial.

Cada descoberta continua `source='trend_discovery'`, sem link. No painel, abrir **Editar**, conferir a pesquisa e clicar **Salvar e validar pauta**. Isso registra `validated_at` e libera a pauta para produção quando o pipeline estiver ativo. Salvar sem link libera conteúdo editorial, não confirma afiliação. Candidatos antigos sem validação ficam retidos. Pautas cadastradas manualmente pelo operador já representam uma decisão editorial.

O pipeline gera dois encerramentos reais: narração e legendas específicas, com o restante do vídeo compartilhado. No painel e na ficha do Telegram, **TikTok orgânico** identifica o arquivo correto. Revisar os dois CTAs antes de aprovar. Vídeos anteriores ao ADR-037 não recebem uma nova versão automaticamente.

No YouTube, URLs em descrições/comentários de Shorts não são clicáveis; links no perfil são. O operador deve inserir e testar o produto no perfil antes de usar o CTA. Guardar o URL na descrição ajuda na transparência, mas não configura o perfil automaticamente. [Ajuda oficial](https://support.google.com/youtube/answer/13748639?hl=pt-BR).

## Calendário inicial

Produzir cinco episódios por semana, um por dia útil, publicando cada versão uma vez no destino correspondente. Isso significa cinco posts semanais em cada canal, não dez produções independentes. Reduzir o ritmo se as quotas, a pesquisa ou a revisão não comportarem a cadência. Não ativar cobranças para cumpri-la.

| Dia | Formato | Abertura em até 2 segundos | Demonstração |
|---|---|---|---|
| Segunda | Problema-solução | Mostrar um incômodo concreto | Como o gadget ajuda e onde não ajuda |
| Terça | Curiosidade útil | Mostrar a função inesperada | Uso real sustentado por evidência |
| Quarta | Comparação | Qual opção atende a este uso? | Dois produtos pesquisados; diferenças verificáveis |
| Quinta | Lista | Três usos deste gadget | Três usos comprovados; três produtos somente com pesquisa de todos |
| Sexta | Vale a pena? | Para quem este gadget faz sentido? | Benefício, limitação e pergunta da audiência |
| Sábado/domingo | Revisão e pesquisa | Sem obrigação de postar | Medir resultados e preparar a próxima semana |

Esses formatos são hipóteses editoriais. Não há garantia de viralização. “Você não vai acreditar” só deve aparecer se a demonstração sustentar a curiosidade; preferir um fato concreto. Abrir com o produto/resultado observável, evitar introdução de marca longa e promessas de preço ou desempenho não verificadas.

Testar YouTube às **12h30 ou 18h30** e TikTok às **19h30 ou 21h00**. Alternar os horários em dias comparáveis ao longo de duas semanas e avaliar a mediana de resultados após sete dias de cada post. Mudar uma variável de cada vez: primeiro abertura/formato, depois horário. Substituir as hipóteses pelos horários reais de atividade do público quando os painéis tiverem dados suficientes. As opções são configuráveis em `growth_strategy.calendar`.

## Publicação e agendamento manual

O `pg_cron` dispara etapas de produção, não reserva horários públicos por plataforma. O upload automatizado atual continua sendo o piloto **horizontal e privado** do YouTube; não implementa `publishAt` nem envio automático de Shorts. `growth_strategy.calendar` é referência operacional, não um agendador ativo.

1. Validar a pauta no painel e conferir as duas versões produzidas no Telegram. A aprovação não publica imediatamente.
2. Para Shorts, baixar a versão vertical YouTube. Enviar pelo YouTube Studio, conferir direitos, divulgação comercial/sintética, título, duração e perfil com o produto correto. Escolher **Programar**, data, horário e fuso. [Passos oficiais](https://support.google.com/youtube/answer/1270709?hl=pt-BR).
3. No TikTok, baixar **TikTok orgânico**, conferir áudio, legendas e descrição de engajamento. Usar o agendamento do TikTok Studio se disponível para a conta; caso contrário, publicar manualmente no horário escolhido. [TikTok Studio](https://support.tiktok.com/en/using-tiktok/creating-videos/tiktok-studio).
4. Registrar o URL público e o horário real na planilha operacional. Publicações manuais ainda não são reconciliadas automaticamente com `publishes`; não simular sucesso no banco.

A duração final vem do áudio, não da estimativa do roteiro. O fechamento comercial pode ser mais longo. Conferir a classificação/duração aceita pela plataforma ao enviar; o nome do arquivo não garante que será classificado como Short.

## Engajamento e medição

Reservar uma janela diária para responder dúvidas reais, agradecer relatos úteis e transformar perguntas recorrentes em pautas. Não comprar seguidores, automatizar comentários em massa, prometer prêmios por interação ou republicar dezenas de variações quase idênticas.

Coletar os dados manualmente nos Studios, após 24 horas e sete dias de cada publicação; revisar semanalmente. Usar CSV/planilha local com:

`episode_id, plataforma, url_publica, data_hora_fuso, formato, hook, cta, duracao_s, views_24h, views_7d, views_engajadas, tempo_medio_s, percentual_medio_assistido, conclusao_pct, curtidas, comentarios, compartilhamentos, salvamentos, seguidores_inicio, seguidores_fim, cliques_afiliados, pedidos, comissao, observacoes`

Deixar campos indisponíveis vazios. Não preencher zero quando o painel não fornece a métrica. Não atribuir todo aumento de seguidores do canal a um único vídeo. Cliques/pedidos/comissões vêm dos relatórios do programa afiliado; sem identificador válido por campanha, analisar por período, sem alegar atribuição exata por vídeo.

| Indicador | Uso |
|---|---|
| Views em 7 dias e views engajadas | Comparar medianas de formatos dentro da mesma plataforma |
| Tempo médio e percentual assistido | Identificar quedas e comparar vídeos de duração semelhante |
| Conclusão, compartilhamentos, salvamentos | Medir utilidade e vontade de rever quando disponíveis |
| Comentários úteis por mil views | Perguntas e intenção real; separar spam |
| Saldo semanal de seguidores/inscritos | Acompanhar crescimento real do canal |
| Cliques, pedidos e comissão confirmada | Avaliar monetização no YouTube sem confundir views com receita |

**Correção técnica:** YouTube Data API fornece contadores de vídeos e canais, incluindo views e inscritos; retenção/tempo assistido pertencem ao YouTube Analytics API ou Studio. Não implementar uma chamada Data API como se ela entregasse retenção. Uma coleta futura precisaria OAuth/escopos, quotas e identidade do canal. Agora a medição é manual, sem novo serviço pago nem `collect-analytics`. O estado `analyze` sozinho não coleta métricas. [Vídeos](https://developers.google.com/youtube/v3/docs/videos#statistics), [canais](https://developers.google.com/youtube/v3/docs/channels#statistics), [métricas de Analytics](https://developers.google.com/youtube/analytics/metrics).

## Marcos de 30, 60 e 90 dias

| Marco | Entrega e critério de decisão |
|---|---|
| 30 dias | Buscar cerca de 20 episódios revisados, se quotas permitirem; registrar sete dias de dados dos posts elegíveis; formar a linha de base por formato. Selecionar dois formatos pela retenção e interações úteis, sem depender de um único outlier. |
| 60 dias | Comparar as últimas quatro semanas com a linha de base; manter os formatos com melhora sustentada de retenção e compartilhamentos/salvamentos. Testar uma nova abertura por semana. Verificar cliques e pedidos reais no programa afiliado. |
| 90 dias | Comparar saldo de seguidores, retenção mediana, cadência sustentável e receita confirmada. Ampliar somente formatos que melhoraram e couberam no orçamento; caso contrário, ajustar nicho/demonstração antes de aumentar volume. |

1.000 seguidores é uma meta de elegibilidade, não promessa de alcance em 90 dias. Os números de cadência e checkpoints são metas operacionais configuráveis, não projeção de audiência ou receita.

## Ao alcançar 1.000 seguidores no TikTok

Conferir no aplicativo os requisitos atuais, idade, identidade/CPF, situação da conta e disponibilidade do TikTok Shop para criadores no Brasil. A política consultada lista o mínimo de seguidores, mas atingir o número sozinho não concede acesso nem equivale à aprovação de desenvolvedor no Partner Center. [Política oficial de elegibilidade](https://seller-br.tiktok.com/university/essay?knowledge_id=1396756526679824).

Só após a conta estar elegível e o produto/vínculo afiliado ser validado, planejar uma nova decisão para CTA comercial TikTok. A configuração de meta não desbloqueia vendas automaticamente; nesta versão o TikTok permanece estritamente orgânico. Começar com poucos produtos relevantes, manter conteúdo útil e registrar a divulgação comercial exigida. Não retomar a API do Partner Center como pré-requisito da estratégia de crescimento.
