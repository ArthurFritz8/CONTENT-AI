# ADR-035 — Amazon como fonte primária para Shorts e monetização manual

## Objetivo

Priorizar produtos com sinal de demanda da Amazon na criação de YouTube Shorts e preparar uma rota de monetização compatível com pessoa física, sem transformar tendências agregadas em links afiliados não verificados.

## Contexto

- O operador decidiu definitivamente não abrir ou usar CNPJ para o projeto. O OAuth e os escopos de parceiro do TikTok Shop deixam de ser um gargalo a resolver e ficam arquivados.
- A API autenticada do Trends MCP aceita `Amazon Best Sellers Top Rated`, mas rejeitou `TikTok Shop Hot Products`, `TikTok Shop` e `TikTok Shop Products`. `TikTok Trending Searches` funciona, porém entrega tendências sociais, não catálogo ou vínculo afiliado. Não existe outro feed gratuito de TikTok Shop utilizável nessa API hoje.
- O retorno Amazon atualmente contém ranking e título, sem ASIN, URL, preço, imagem ou confirmação de que o item está disponível na Amazon.com.br. Portanto, ele serve como sinal editorial de demanda, não como catálogo comercial.
- O Programa de Associados Amazon.com.br admite pessoa física e aceita CPF nos dados de pagamento. O YouTube é um tipo de site social aceito, sujeito à análise da conta, às vendas qualificadas e às políticas do programa.
- O SiteStripe cria links especiais com o identificador de associado. A Product Advertising API exige conta aprovada e credenciais próprias, portanto não resolve a etapa inicial do projeto.
- URLs inseridas na descrição e nos comentários de Shorts não são clicáveis. O CTA comercial deve apontar para um destino clicável permitido, como o link do perfil do canal, e identificar claramente a relação de afiliado.

## Solução

1. Configurar `trend_sources.primary="trends_mcp"`. A cascata passa a ser Trends MCP/Amazon → SocialCrawl BR → Tavily/Hacker News.
2. Criar briefings específicos para Shorts verticais de até 60 segundos com: hook visual e verbal nos primeiros dois segundos, problema real, demonstração do produto, benefícios verificáveis e CTA curto.
3. Manter todos os resultados como `source='trend_discovery'`, prioridade 500 e revisão humana obrigatória. Não preencher `product_url` ou `product_image_url` durante a descoberta.
4. Para monetização, o operador deve localizar o mesmo item na Amazon.com.br, confirmar ASIN, disponibilidade no Brasil e elegibilidade no Programa de Associados, gerar o link especial no SiteStripe e colá-lo no painel. O link validado ativa o tratamento comercial e o disclosure já definidos nos ADR-026/028.
5. Usar CTA editorial antes da validação. Depois dela, apontar para o link do perfil do canal ou outro destino clicável permitido e informar que a compra pode gerar comissão.
6. Manter `amazon_associates.enabled=false` e `associate_tag=null` até a conta ser aprovada e o primeiro link SiteStripe ser validado. Adiar a Product Advertising API até existirem acesso e necessidade reais.
7. Encerrar as tentativas de automatizar TikTok Shop pelas fontes gratuitas atuais. SocialCrawl pode continuar como sinal opcional, nunca como prova de afiliação, comissão ou autorização.

## Prevenção

- Não inferir ASIN a partir do título e não montar link determinístico sem ASIN e tag de associado validados.
- Não copiar preço, desconto, avaliação, estoque, imagem ou alegação comercial recebida de agregadores. O roteiro usa pesquisa atual e materiais autorizados.
- Não executar scraping da Amazon ou do TikTok. Trends MCP e SocialCrawl permanecem integrações removíveis e limitadas a sinais editoriais.
- Testes comprovam a ordem da cascata, a presença da estrutura de Shorts no briefing e a ausência de campos comerciais antes da validação humana.
- Conteúdo deve ser original, com demonstração e análise próprias; produção repetitiva ou reaproveitada não é aceita como estratégia editorial.
- Uma futura automação de links exige conta Amazon aprovada, credenciais oficiais quando aplicáveis, política de disclosure revisada e novo ADR.
