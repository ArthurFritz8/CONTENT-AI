# ADR-043 — Pautas por perfil editorial e assistência Fia

Data: 2026-09-29. Status: implementado.

## O — Objetivo

Gerar sugestões concretas para vários temas e guiar o cliente sem exigir conhecimento de API, preservando revisão humana e cotas gratuitas.

## C — Contexto

O fluxo antigo já usa Tavily, Gemini, helpers de orçamento, fila e máquina de estados. Seu prompt era orientado a produtos. Uma simples lista de categorias na interface não tornaria o pipeline universal. Busca recente não prova popularidade, vendas ou potencial de viralização. Free models não oferecem capacidade ilimitada nem disponibilidade garantida.

## S — Solução

- Perfil tipado em `packages/core/src/editorial/profile.ts`: gadgets, geek, novelas/séries, educação financeira, casa, games e ciência. Recorte livre e janela de 7/30 dias; regras próprias sobre spoilers, anúncios, evidência científica, direitos de imagem e ausência de promessa financeira. Perfil é copiado da pesquisa salva para a ideia e o episódio; o navegador não pode trocar essa evidência por outra.
- Tavily basic com filtro de data e Gemini extraem até três assuntos individuais, com gancho, abordagem, motivo editorial, limitação e citação literal da fonte encontrada. URLs e trechos não sustentados são descartados; evidência insuficiente resulta em lista vazia. Data da fonte pode faltar e aparece como desconhecida, sem data inventada. O sinal se chama `recent_source`, não ranking de viralidade. Conferência semântica final continua humana.
- Cache por perfil/workspace por 24 horas, três pesquisas diárias por conta e orçamento global antes de cada chamada. Pesquisa diária opcional usa o mesmo serviço, adiciona sugestões sem gerar vídeos e deduplica assunto/fonte. Salvar e gerar são decisões separadas. `product_url` e `product_image_url` permanecem nulos. Campos legados `selected_product`/`selected_hook` representam o assunto concreto para preservar compatibilidade; o perfil governa a interpretação editorial.
- Fia é a ajuda flutuante, com guia local contextual sempre disponível. IA reutiliza Gemini e o budget guard, limitada a dez consultas diárias por conta. A IA recebe somente pergunta e guia, sem ferramentas de escrita, credenciais ou poder para aprovar/publicar. Falha/cota volta ao guia. Primeira entrega suporta texto; anexos de imagem não são anunciados como disponíveis.
- OpenRouter foi considerado como alternativa, mas não acrescentado como dependência: o provedor já configurado atende ao suporte e evita novo segredo/processador de dados. Não há seleção automática de modelo pago quando a cota gratuita acaba.

## P — Prevenção

Tests verificam rejeição de fonte/trecho inventados, deduplicação, perfis e cotas. Pesquisa não equivale a validação de direitos da imagem, afiliação ou veracidade de todas as inferências do modelo. Não garantir viralização. Contexto externo é dado, nunca instrução de sistema. Produção preserva o mínimo de 60s e o renderer de imagens. Nenhuma descoberta consome candidatos anteriores automaticamente.

Fontes: [Tavily Search e filtros de data](https://docs.tavily.com/documentation/api-reference/endpoint/search), [limites gratuitos OpenRouter](https://openrouter.ai/docs/api_reference/limits).
