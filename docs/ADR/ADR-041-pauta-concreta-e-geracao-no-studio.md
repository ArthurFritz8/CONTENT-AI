# ADR-041 — Produto concreto e geração visível no Studio

Data: 2026-09-28. Status: implementado no código.

## O — Objetivo

Impedir que um título genérico de lista vire vídeo por um clique de “salvar” e permitir que o operador escolha um produto real, inicie a geração pelo Studio e acompanhe a revisão até o Telegram.

## C — Contexto

O `discover-trends` gerava candidatos a partir de títulos editoriais amplos. A edição no painel marcava `validated_at` mesmo sem escolher um produto. Assim, com o pipeline ativo, `consume_next_idea` podia iniciar um episódio sobre “tendências de 2026” em vez de um gadget. O Studio já tinha lista de episódios, etapas e eventos; recriar uma segunda máquina de estados seria redundante. O Telegram já entrega a ficha apenas quando o episódio chega a `review`. A fila também ficava parada por candidatos antigos apesar de haver sinais novos.

## S — Solução

1. Candidato editorial permanece pista de pesquisa. Uma consulta explícita usa Tavily e Gemini com as reservas de quota gratuitas existentes para propor até três produtos individuais, cada um com gancho visual, problema, limitação, motivo editorial e URL exata de uma fonte retornada. O resultado só é exibido quando o nome do produto está sustentado pelo trecho da fonte. Ausência de evidência resulta em nenhuma recomendação, nunca em produto inventado.
2. O operador escolhe um dos produtos no detalhe da pauta. A escolha reescreve o briefing para **um único produto**, com contexto e limitação; não cria episódio nem link afiliado. A ação **Gerar vídeo** é separada, atômica e idempotente, respeita pipeline ativado, um trabalho em andamento e limite diário. A função `consume_idea_unchecked` reutiliza a mesma montagem de episódio e compliance para o agendador e o botão.
3. A condição de consumo para `trend_discovery` exige produto, gancho, fonte, validação e `generation_requested_at`. A migração remove a validação acidental dos candidatos antigos ainda pendentes. Pautas manuais continuam elegíveis como antes. A seleção não equivale a afiliação nem a aprovação de publicação.
4. O Studio lista as gerações recentes da fila com estado real do episódio, progresso e estado da entrega no Telegram. A lista é atualizada periodicamente. A revisão humana e os consentimentos de publicação permanecem no Telegram.
5. A descoberta rejeita títulos editoriais claramente genéricos e itens de baixo apelo visual, tenta a próxima fonte quando necessário e limita a fila recente a 72 horas, mantendo teto absoluto de 20 candidatos pendentes para evitar acúmulo ilimitado.

## P — Prevenção

- Não prometer viralidade, vendas, disponibilidade no Brasil ou link de afiliado. “Por que agora” é hipótese editorial ancorada no trecho, e a aprovação final exige conferência humana.
- Pautas antigas já consumidas não são reescritas; vídeos em andamento continuam sujeitos à revisão Telegram. Candidatos genéricos pendentes ficam visíveis para reanálise, mas não podem ser consumidos.
- Ações usam sessão administrativa, origem exata, payload restrito, revisão otimista, ledger de idempotência e lock da cota diária; uma corrida com o agendador não pode criar dois episódios da mesma pauta ou exceder o teto.
- Se pesquisa ou quota gratuita falhar, a pauta permanece pendente. Nenhuma mídia é publicada por escolher um produto ou clicar em gerar.
